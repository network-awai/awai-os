//! Shared trusted Tauri carrier. Approval stays in the pinned canonical broker.
use awai_peer_runtime::{operation::Endpoint, provider, snapshot::DiskStore};
use base64::Engine;
use futures::future::{AbortHandle, AbortRegistration, Abortable};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::Manager;
use tokio::sync::oneshot;

#[derive(Default)]
struct Jobs {
    pending: HashMap<String, (AbortHandle, Option<AbortRegistration>)>,
    receives: HashMap<String, Receive>,
    imports: HashMap<String, Upload>,
}
struct Receive {
    stop: Option<oneshot::Sender<()>>,
    snapshot: String,
    until: u64,
    state: String,
}
struct Upload {
    file: fs::File,
    path: PathBuf,
    root: cid_alias::Cid,
    expected: u64,
    written: u64,
}
mod cid_alias {
    pub use awai_peer_runtime::operation::SnapshotCid as Cid;
}
static JOBS: OnceLock<Mutex<Jobs>> = OnceLock::new();
fn jobs() -> &'static Mutex<Jobs> {
    JOBS.get_or_init(Default::default)
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn id() -> String {
    awai_peer_runtime::new_operation_id()
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(err)?.join("p2p"))
}
fn store(app: &tauri::AppHandle) -> Result<DiskStore, String> {
    DiskStore::open(&root(app)?.join("store")).map_err(err)
}
fn identity(app: &tauri::AppHandle) -> Result<awai_peer_runtime::PeerIdentity, String> {
    // Commands and imports may run concurrently; identity publication is serialized.
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().map_err(err)?;
    awai_peer_runtime::load_identity(&root(app)?).map_err(err)
}
#[tauri::command]
fn peer_host_info(app: tauri::AppHandle) -> Result<Value, String> {
    Ok(
        json!({"schema":"awai.shell.peer.v1","peerId":identity(&app)?.public().to_peer_id().to_string(),"snapshotProtocol":provider::PROTOCOL,"maxCarBytes":268435456,"foregroundReceive":cfg!(target_os="android"),"automaticStart":false}),
    )
}
#[tauri::command]
fn awai_host_info() -> Value {
    json!({"schema":"awai.shell.host.v1","agendaProjection":false,"peerHost":"awai.shell.peer.v1"})
}
#[tauri::command]
async fn peer_notification_permission(app: tauri::AppHandle) -> Result<(), String> {
    foreground(&app, "requestNotifications", json!({})).await
}

#[tauri::command]
fn peer_reserve() -> Result<String, String> {
    let mut state = jobs().lock().map_err(err)?;
    if state.pending.len() >= 2 {
        return Err("peer-operation-limit".into());
    }
    let id = id();
    let (handle, registration) = AbortHandle::new_pair();
    state
        .pending
        .insert(id.clone(), (handle, Some(registration)));
    Ok(id)
}
#[tauri::command]
fn peer_info(app: tauri::AppHandle) -> Result<Value, String> {
    peer_host_info(app)
}
#[tauri::command]
fn peer_begin(request_id: String) -> Result<(), String> {
    if request_id.len() != 36
        || !request_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
    {
        return Err("invalid-request-id".into());
    }
    let mut state = jobs().lock().map_err(err)?;
    if state.pending.len() >= 2 || state.pending.contains_key(&request_id) {
        return Err("peer-operation-limit".into());
    }
    let (handle, registration) = AbortHandle::new_pair();
    state
        .pending
        .insert(request_id, (handle, Some(registration)));
    Ok(())
}
#[tauri::command]
async fn peer_execute(
    app: tauri::AppHandle,
    request_id: String,
    endpoint: awai_peer_runtime::PeerEndpoint,
    payload: Value,
) -> Result<Value, String> {
    endpoint.checked().map_err(err)?;
    let registration = jobs()
        .lock()
        .map_err(err)?
        .pending
        .get_mut(&request_id)
        .and_then(|(_, r)| r.take())
        .ok_or("operation-cancelled-or-not-reserved")?;
    let _guard = PendingGuard(request_id);
    let result = Abortable::new(
        awai_peer_runtime::execute(identity(&app)?, endpoint, payload),
        registration,
    )
    .await
    .map_err(|_| "peer-operation-cancelled")?
    .map_err(err)?;
    serde_json::to_value(result).map_err(err)
}
#[tauri::command]
fn peer_cancel(request_id: String) -> Result<(), String> {
    if let Some((handle, _)) = jobs().lock().map_err(err)?.pending.remove(&request_id) {
        handle.abort();
    }
    Ok(())
}
#[tauri::command]
fn peer_sessions() -> Result<Value, String> {
    let state = jobs().lock().map_err(err)?;
    Ok(Value::Array(
        state
            .receives
            .iter()
            .map(|(id, s)| json!({"id":id,"snapshot":s.snapshot,"until":s.until,"state":s.state}))
            .collect(),
    ))
}
pub fn stop_session(session_id: &str) {
    if let Ok(mut state) = jobs().lock() {
        if let Some(session) = state.receives.get_mut(session_id) {
            if let Some(stop) = session.stop.take() {
                let _ = stop.send(());
            }
            session.state = "stopped".into();
        }
    }
}
#[tauri::command]
async fn peer_stop(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    stop_session(&session_id);
    foreground(&app, "endReceive", json!({"sessionId":session_id})).await
}

struct PendingGuard(String);
impl Drop for PendingGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = jobs().lock() {
            state.pending.remove(&self.0);
        }
    }
}
struct ReceiveGuard {
    id: String,
    committed: bool,
}
impl Drop for ReceiveGuard {
    fn drop(&mut self) {
        if !self.committed {
            stop_session(&self.id);
        }
    }
}

#[tauri::command]
async fn peer_snapshot_execute(
    app: tauri::AppHandle,
    request_id: String,
    endpoint: Endpoint,
) -> Result<Value, String> {
    let checked = endpoint.checked().map_err(err)?;
    let registration = jobs()
        .lock()
        .map_err(err)?
        .pending
        .get_mut(&request_id)
        .and_then(|(_, r)| r.take())
        .ok_or("operation-cancelled-or-not-reserved")?;
    let _guard = PendingGuard(request_id);
    let work = async {
        let key = identity(&app)?;
        if endpoint.action == "receive-snapshot" {
            let duration = endpoint
                .scope
                .receive_ms
                .ok_or("missing-receive-duration")?;
            let until = provider::now() + duration.div_ceil(1000);
            let session_id = id();
            let (stop, stopped) = oneshot::channel();
            let (tx, ready) = oneshot::channel();
            let service = provider::Provider::new(
                root(&app)?.join("store"),
                key,
                vec![provider::Grant {
                    allow_read: endpoint.scope.allow_read_back.unwrap_or(false),
                    peer_id: checked.peer.to_string(),
                    snapshot: checked.snapshot.to_string(),
                    max_bytes: endpoint.scope.max_transfer_bytes,
                    expires_at: until,
                }],
            )
            .map_err(err)?;
            {
                let mut state = jobs().lock().map_err(err)?;
                if state.receives.values().any(|s| s.stop.is_some()) {
                    return Err::<Value, String>("receive-session-already-running".into());
                }
                state.receives.retain(|_, s| s.stop.is_some());
                state.receives.insert(
                    session_id.clone(),
                    Receive {
                        stop: Some(stop),
                        snapshot: checked.snapshot.to_string(),
                        until,
                        state: "starting".into(),
                    },
                );
            }
            let mut guard = ReceiveGuard {
                id: session_id.clone(),
                committed: false,
            };
            let task_app = app.clone();
            let task_id = session_id.clone();
            let bind = checked.bind.ok_or("missing-listen-address")?;
            tauri::async_runtime::spawn(async move {
                let result = service.run(bind, tx, stopped).await;
                if let Ok(mut state) = jobs().lock() {
                    if let Some(session) = state.receives.get_mut(&task_id) {
                        session.stop = None;
                        session.state = if result.is_ok() { "stopped" } else { "failed" }.into();
                    }
                }
                let _ = foreground(&task_app, "endReceive", json!({"sessionId":task_id})).await;
            });
            let address = ready.await.map_err(err)?;
            foreground(
                &app,
                "beginReceive",
                json!({"sessionId":session_id,"until":until}),
            )
            .await?;
            if let Ok(mut state) = jobs().lock() {
                if let Some(session) = state.receives.get_mut(&session_id) {
                    if session.stop.is_none() {
                        return Err("receive-session-stopped".into());
                    }
                    session.state = "receiving".into();
                }
            }
            guard.committed = true;
            return Ok(
                json!({"sessionId":session_id,"address":address.to_string(),"snapshot":checked.snapshot.to_string(),"until":until,"state":"receiving"}),
            );
        }
        let store = store(&app)?;
        let address = checked.address.ok_or("peer-address-required")?;
        match endpoint.action.as_str() {
            "sync-push" => {
                let receipt = provider::push_snapshot_bounded(
                    key,
                    &store,
                    address,
                    checked.snapshot,
                    endpoint.scope.max_transfer_bytes,
                )
                .await
                .map_err(err)?;
                let verified = receipt
                    .verify(checked.peer, &checked.snapshot.to_string())
                    .map_err(err)?;
                Ok(
                    json!({"snapshot":checked.snapshot.to_string(),"receipt":verified,"verified":true}),
                )
            }
            "sync-pull" => {
                provider::pull_snapshot_bounded(
                    key,
                    &store,
                    address,
                    checked.snapshot,
                    endpoint.scope.max_transfer_bytes,
                )
                .await
                .map_err(err)?;
                Ok(
                    json!({"snapshot":checked.snapshot.to_string(),"verified":true,"state":"stored"}),
                )
            }
            "pin-query" => {
                let response = provider::exchange(
                    key,
                    address,
                    provider::Request::Query {
                        snapshot: checked.snapshot.to_string(),
                    },
                )
                .await
                .map_err(err)?;
                if !response.ok {
                    return Err("pin-query-refused".into());
                }
                let verified = response
                    .receipt
                    .ok_or("missing-receipt")?
                    .verify(checked.peer, &checked.snapshot.to_string())
                    .map_err(err)?;
                Ok(json!({"receipt":verified,"verified":true}))
            }
            _ => Err("unsupported-peer-operation".into()),
        }
    };
    let result = Abortable::new(
        tokio::time::timeout(Duration::from_millis(endpoint.timeout_ms), work),
        registration,
    )
    .await
    .map_err(|_| "peer-operation-cancelled")?
    .map_err(|_| "peer-operation-deadline")??;
    if serde_json::to_vec(&result).map_err(err)?.len() > endpoint.max_response_bytes {
        return Err("peer-response-budget".into());
    }
    Ok(result)
}

#[tauri::command]
fn peer_import_begin(
    app: tauri::AppHandle,
    trusted_root: String,
    bytes: u64,
) -> Result<String, String> {
    if bytes == 0 || bytes > 268435456 || trusted_root.len() > 128 {
        return Err("snapshot-import-limit".into());
    }
    let root_cid = trusted_root.parse().map_err(err)?;
    let mut state = jobs().lock().map_err(err)?;
    if !state.imports.is_empty() {
        return Err("snapshot-import-busy".into());
    }
    let id = id();
    let directory = root(&app)?.join("imports");
    fs::create_dir_all(&directory).map_err(err)?;
    let path = directory.join(&id);
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(err)?;
    state.imports.insert(
        id.clone(),
        Upload {
            file,
            path,
            root: root_cid,
            expected: bytes,
            written: 0,
        },
    );
    Ok(id)
}
#[tauri::command]
fn peer_import_chunk(import_id: String, offset: u64, data: String) -> Result<(), String> {
    if data.len() > 90000 {
        return Err("import-chunk-limit".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(err)?;
    if bytes.len() > 65536 {
        return Err("import-chunk-limit".into());
    }
    let mut state = jobs().lock().map_err(err)?;
    let upload = state.imports.get_mut(&import_id).ok_or("unknown-import")?;
    if offset != upload.written || bytes.len() as u64 > upload.expected - upload.written {
        return Err("import-offset-or-size".into());
    }
    upload.file.write_all(&bytes).map_err(err)?;
    upload.written += bytes.len() as u64;
    Ok(())
}
#[tauri::command]
fn peer_import_finish(app: tauri::AppHandle, import_id: String) -> Result<Value, String> {
    let upload = jobs()
        .lock()
        .map_err(err)?
        .imports
        .remove(&import_id)
        .ok_or("unknown-import")?;
    if upload.written != upload.expected {
        return Err("incomplete-import-preserved".into());
    }
    upload.file.sync_all().map_err(err)?;
    drop(upload.file);
    let snapshot = store(&app)?
        .import_car(&upload.path, upload.root)
        .map_err(err)?;
    // The original selected file and failed staged imports are never overwritten.
    let _ = fs::remove_file(upload.path);
    Ok(
        json!({"snapshot":snapshot.to_string(),"trustedRoot":upload.root.to_string(),"bytes":upload.written}),
    )
}
#[tauri::command]
fn peer_import_cancel(import_id: String) -> Result<(), String> {
    jobs().lock().map_err(err)?.imports.remove(&import_id);
    Ok(())
}

#[cfg(target_os = "android")]
struct AndroidForeground(tauri::plugin::PluginHandle<tauri::DynRuntime>);
async fn foreground(_app: &tauri::AppHandle, _action: &str, _payload: Value) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let _: Value = _app
            .state::<AndroidForeground>()
            .0
            .run_mobile_plugin_async(_action, _payload)
            .await
            .map_err(err)?;
    }
    Ok(())
}
pub fn android_plugin() -> tauri::plugin::TauriPlugin<tauri::DynRuntime> {
    tauri::plugin::Builder::<tauri::DynRuntime, ()>::new("awai-peer")
        .setup(|_app, _api| {
            _app.manage(DraftLock(Mutex::new(())));
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin("network.awai.shell", "AwaiPeerPlugin")?;
                _app.manage(AndroidForeground(handle));
            }
            Ok(())
        })
        .build()
}
pub fn commands() -> impl Fn(tauri::ipc::Invoke<tauri::DynRuntime>) -> bool + Send + Sync + 'static
{
    tauri::generate_handler![
        awai_host_info,
        peer_notification_permission,
        peer_host_info,
        peer_info,
        peer_begin,
        peer_snapshot_execute,
        read_drafts,
        write_drafts,
        peer_reserve,
        peer_execute,
        peer_cancel,
        peer_sessions,
        peer_stop,
        peer_import_begin,
        peer_import_chunk,
        peer_import_finish,
        peer_import_cancel
    ]
}

#[cfg(target_os = "android")]
pub fn jni_cancel(mut env: jni::JNIEnv, _class: jni::objects::JClass, id: jni::objects::JString) {
    if let Ok(id) = env.get_string(&id) {
        stop_session(id.to_string_lossy().as_ref());
    }
}
#[cfg(target_os = "android")]
pub fn jni_active(
    mut env: jni::JNIEnv,
    _class: jni::objects::JClass,
    id: jni::objects::JString,
) -> jni::sys::jboolean {
    let Ok(id) = env.get_string(&id) else {
        return 0;
    };
    let name = id.to_string_lossy();
    jobs()
        .lock()
        .ok()
        .and_then(|state| state.receives.get(name.as_ref()).map(|s| s.stop.is_some()))
        .unwrap_or(false) as u8
}

struct DraftLock(Mutex<()>);

#[tauri::command]
fn read_drafts(
    app: tauri::AppHandle,
    lock: tauri::State<DraftLock>,
) -> Result<Option<String>, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Draft storage lock unavailable")?;
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("drafts-v1.json");
    match fs::read_to_string(path) {
        Ok(data) => Ok(Some(data)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_drafts(
    app: tauri::AppHandle,
    lock: tauri::State<DraftLock>,
    data: String,
) -> Result<(), String> {
    if data.len() > 10_000_000 {
        return Err("Draft snapshot exceeds 10 MB".into());
    }
    let value: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if value["schema"] != "awai.aozora.drafts.v1" || !value["drafts"].is_array() {
        return Err("Invalid draft snapshot".into());
    }
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Draft storage lock unavailable")?;
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let pending = dir.join("drafts-v1.pending");
    let mut file = fs::File::create(&pending).map_err(|e| e.to_string())?;
    file.write_all(data.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    fs::rename(pending, dir.join("drafts-v1.json")).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    fs::File::open(dir)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
pub use jni;
