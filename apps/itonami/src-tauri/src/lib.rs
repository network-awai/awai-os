mod setup_state;
static SETUP_WRITE: std::sync::Mutex<()> = std::sync::Mutex::new(());
#[tauri::command]
fn awai_setup_state(app:tauri::AppHandle, action:String)->Result<serde_json::Value,String>{
    use tauri::Manager;
    if action!="read" && action!="complete" {return Err("unsupported-setup-operation".into());}
    let _guard=SETUP_WRITE.lock().map_err(|_|"setup-lock-failed")?;
    let dir=app.path().app_local_data_dir().map_err(|_|"setup-storage-unavailable")?;
    if action=="complete" {setup_state::complete(&dir).map_err(|_|"setup-save-failed")?;}
    let complete=setup_state::read(&dir).map_err(|_|"setup-read-failed")?;
    Ok(serde_json::json!({"schema":"awai.setup.state.v1","complete":complete}))
}
#[cfg(target_os="android")]
struct AndroidInferenceClient(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[cfg(target_os="android")]
struct AndroidAgentTransport(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[cfg(target_os="android")]
struct AndroidSpeech(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[cfg(target_os = "android")]
struct HostAccount(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[cfg(target_os = "android")]
struct AndroidScreenTools(tauri::plugin::PluginHandle<tauri::DynRuntime>);

#[tauri::command]
async fn awai_screen_tools(
    app: tauri::AppHandle,
    action: String,
) -> Result<serde_json::Value, String> {
    if !matches!(action.as_str(), "status" | "record-start" | "record-stop" |
        "home" | "settings" | "recents" | "accessibility-settings" | "open-gaka") {
        return Err("unsupported-screen-operation".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<AndroidScreenTools>()
            .0
            .run_mobile_plugin_async("operation", serde_json::json!({ "action": action }))
            .await
            .map_err(|_| "screen-operation-denied-or-unavailable".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        #[cfg(target_os = "macos")]
        if action == "open-gaka" {
            return tauri::async_runtime::spawn_blocking(|| {
                let opened = std::process::Command::new("/usr/bin/open")
                    .args(["-b", "network.awai.gaka"])
                    .output()
                    .is_ok_and(|result| result.status.success());
                if !opened {
                    return Err("gaka-unavailable".into());
                }
                Ok(serde_json::json!({
                    "schema": "awai.local-app-launch.v1",
                    "packageId": "network.awai.gaka",
                    "opened": true
                }))
            })
            .await
            .map_err(|_| "gaka-unavailable".to_string())?;
        }
        Err("android-only".into())
    }
}

#[tauri::command]
async fn awai_local_speech(app:tauri::AppHandle,request:serde_json::Value)->Result<serde_json::Value,String>{
 if serde_json::to_vec(&request).map_err(|_|"invalid-speech-request")?.len()>4096{return Err("speech-request-limit".into());}
 #[cfg(target_os="android")]{use tauri::Manager;return app.state::<AndroidSpeech>().0.run_mobile_plugin_async("operation",request).await.map_err(|_|"local-speech-denied-or-unavailable".into());}
 #[cfg(not(target_os="android"))]{let _=app;Err("android-only".into())}
}
#[tauri::command]
async fn awai_agent_transport(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 #[cfg(target_os="android")]{use tauri::Manager;return app.state::<AndroidAgentTransport>().0.run_mobile_plugin_async("status",serde_json::json!({})).await.map_err(|_|"agent-transport-unavailable".into());}
 #[cfg(not(target_os="android"))]{let _=app;Ok(serde_json::json!({"schema":"awai.agent-transport-status.v1","mode":"direct","ready":true}))}
}
#[tauri::command]
async fn awai_local_inference(app:tauri::AppHandle,request:serde_json::Value)->Result<serde_json::Value,String>{
 if serde_json::to_vec(&request).map_err(|_|"invalid-request")?.len()>32768{return Err("request-limit".into());}
 #[cfg(target_os="android")]{
  use tauri::{Manager, plugin::mobile::PluginInvokeError};
  let generate = request.get("action").and_then(serde_json::Value::as_str) == Some("generate");
  return app.state::<AndroidInferenceClient>().0.run_mobile_plugin_async("operation",request).await.map_err(|error| {
   match error {
    PluginInvokeError::InvokeRejected(response)
     if generate && response.message.as_deref() == Some("inference-cancelled") => "inference-cancelled".into(),
    _ => "local-inference-denied-or-unavailable".into(),
   }
  });
 }
 #[cfg(not(target_os="android"))]{let _=app;Err("android-only".into())}
}
#[tauri::command]
async fn awai_host_account(app: tauri::AppHandle, nonce: String) -> Result<serde_json::Value, String> {
    if nonce.len() != 36 {
        return Err("invalid-host-account-nonce".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<HostAccount>().0
            .run_mobile_plugin_async("proof", serde_json::json!({ "nonce": nonce }))
            .await
            .map_err(|_| "host-account-unavailable".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("android-only".into())
    }
}
#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({
        "schema": "awai.shell.host.v1",
        "app": "itonami",
        "runtime": "tauri-3.0.0-alpha.6-wry",
        "platform": std::env::consts::OS,
        "nixosServices": false,
        "localInference": false,
        "inferenceHandoff": cfg!(target_os="android"),
        "hostFilesystem": false,
        "externalOperations": "canonical-browser-broker-each-operation"
    })
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-inference-client").setup(|_app,_api|{
 #[cfg(target_os="android")]{use tauri::Manager;let h=_api.register_android_plugin("network.awai.inference","InferenceClientPlugin")?;_app.manage(AndroidInferenceClient(h));}Ok(())}).build())
        .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-agent-transport").setup(|_app,_api|{
 #[cfg(target_os="android")]{use tauri::Manager;let h=_api.register_android_plugin("network.itonami.app","AgentTransportPlugin")?;_app.manage(AndroidAgentTransport(h));}Ok(())}).build())
        .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-speech").setup(|_app,_api|{
 #[cfg(target_os="android")]{use tauri::Manager;let h=_api.register_android_plugin("network.awai.speech","SpeechPlugin")?;_app.manage(AndroidSpeech(h));}Ok(())}).build())
        .plugin(tauri::plugin::Builder::<tauri::DynRuntime, ()>::new("awai-host-account")
            .setup(|app, api| {
                #[cfg(target_os = "android")]
                {
                    use tauri::Manager;
                    let handle = api.register_android_plugin("network.itonami.app", "HostAccountPlugin")?;
                    app.manage(HostAccount(handle));
                }
                #[cfg(not(target_os = "android"))]
                let _ = (app, api);
                Ok(())
            })
            .build())
        .plugin(tauri::plugin::Builder::<tauri::DynRuntime, ()>::new("awai-screen-tools")
            .setup(|app, api| {
                #[cfg(target_os = "android")]
                {
                    use tauri::Manager;
                    let handle = api.register_android_plugin("network.itonami.app", "ScreenToolsPlugin")?;
                    app.manage(AndroidScreenTools(handle));
                }
                #[cfg(not(target_os = "android"))]
                let _ = (app, api);
                Ok(())
            })
            .build())
        .invoke_handler(tauri::generate_handler![awai_host_info,awai_host_account,awai_local_inference,awai_setup_state,awai_agent_transport,awai_local_speech,awai_screen_tools])
        .run(tauri::generate_context!())
        .expect("Itonami initialization failed");
}
