#[cfg(target_os="android")]
struct AndroidInferenceClient(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[tauri::command]
async fn awai_local_inference(app:tauri::AppHandle,request:serde_json::Value)->Result<serde_json::Value,String>{
 if serde_json::to_vec(&request).map_err(|_|"invalid-request")?.len()>32768{return Err("request-limit".into());}
 #[cfg(target_os="android")]{use tauri::Manager;return app.state::<AndroidInferenceClient>().0.run_mobile_plugin_async("operation",request).await.map_err(|_|"local-inference-denied-or-unavailable".into());}
 #[cfg(not(target_os="android"))]{let _=app;Err("android-only".into())}
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
        .invoke_handler(tauri::generate_handler![awai_host_info,awai_local_inference])
        .run(tauri::generate_context!())
        .expect("Itonami initialization failed");
}
