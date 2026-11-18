// Horei: offline law browser. The UI, data and search run in the WebView. This host exposes its
// version and an app-private Awai FS block store for verified law full texts (awai_fs.rs).
// It has no network, installer or shell commands: the WebView fetches through the consent broker.
mod awai_fs;
use tauri::{ipc::{InvokeBody, Request, Response}, AppHandle, Manager};

#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({"schema":"awai.shell.host.v1", "agendaProjection":false, "awaiFs":"awai.fs.blocks.v1"})
}
fn store(app: &AppHandle) -> Result<awai_fs::Store, String> {
    Ok(awai_fs::Store::new(app.path().app_data_dir().map_err(|_| "io: app-data-dir".to_string())?.join("awai-fs")))
}
// Returns the block's bytes, or an empty body when it is absent (a law text is never empty).
#[tauri::command]
fn awai_fs_get(app: AppHandle, cid: String) -> Result<Response, String> {
    Ok(Response::new(store(&app)?.get(&cid).map_err(|e| e.to_string())?.unwrap_or_default()))
}
// Raw body = block bytes; header x-awai-cid names the CID they must hash to.
#[tauri::command]
fn awai_fs_put(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let cid = request.headers().get("x-awai-cid").and_then(|v| v.to_str().ok()).ok_or("invalid-cid")?.to_string();
    let InvokeBody::Raw(bytes) = request.body() else { return Err("raw-body-required".into()) };
    store(&app)?.put(&cid, bytes).map_err(|e| e.to_string())
}
#[tauri::command]
fn awai_fs_delete(app: AppHandle, cid: String) -> Result<(), String> {
    store(&app)?.delete(&cid).map_err(|e| e.to_string())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .invoke_handler(tauri::generate_handler![awai_host_info, awai_fs_get, awai_fs_put, awai_fs_delete])
        .run(tauri::generate_context!())
        .expect("Horei initialization failed");
}
