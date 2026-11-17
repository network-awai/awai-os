#[cfg(target_os="android")]
struct AndroidInference(tauri::plugin::PluginHandle<tauri::DynRuntime>);
/// The plugin's own refusal code (for example model-import-rejected) when it is a plain
/// lower-case code; anything else stays generic, so no native detail reaches the page.
#[cfg(target_os="android")]
fn refusal(e:tauri::plugin::mobile::PluginInvokeError)->String{
 if let tauri::plugin::mobile::PluginInvokeError::InvokeRejected(r)=e{
  if let Some(m)=r.message{if !m.is_empty()&&m.len()<=60&&m.bytes().all(|b|b.is_ascii_lowercase()||b==b'-'){return m;}}
 }
 "native-operation-rejected".into()
}
#[tauri::command]
async fn inference_operation(app:tauri::AppHandle,request:serde_json::Value)->Result<serde_json::Value,String>{
 if serde_json::to_vec(&request).map_err(|_|"invalid-request")?.len()>32768{return Err("request-limit".into());}
 #[cfg(target_os="android")]{use tauri::Manager;return app.state::<AndroidInference>().0.run_mobile_plugin_async("operation",request).await.map_err(refusal);}
 #[cfg(not(target_os="android"))]{let _=app;Err("android-only".into())}
}
#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default())
 .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-inference").setup(|_app,_api|{
  #[cfg(target_os="android")]{use tauri::Manager;let handle=_api.register_android_plugin("network.awai.murakumo","InferencePlugin")?;_app.manage(AndroidInference(handle));}Ok(())}).build())
 .invoke_handler(tauri::generate_handler![inference_operation]).run(tauri::generate_context!()).expect("Murakumo initialization failed");}
