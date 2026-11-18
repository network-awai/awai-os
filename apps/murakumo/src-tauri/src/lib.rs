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
/// Host sink for the canonical broker's host-stream model downloads (AWAI-3307). The page never names
/// a path: Kotlin chooses `models/<catalog id>.download` and the size limit; these commands only
/// append the broker's verified-in-progress bytes and hand the file back to Kotlin, which admits it
/// again by size and SHA-256. Without a successful finish the file is deleted.
#[cfg(target_os="android")]
struct Download{file:std::fs::File,model:String,written:u64,limit:u64}
#[cfg(target_os="android")]
#[derive(Default)]
struct DownloadState(std::sync::Mutex<Option<Download>>);

#[tauri::command]
async fn model_download_begin(app:tauri::AppHandle,model:String)->Result<serde_json::Value,String>{
 #[cfg(target_os="android")]{use tauri::Manager;
  if model.is_empty()||model.len()>64||!model.bytes().all(|b|b.is_ascii_lowercase()||b.is_ascii_digit()||b==b'-'||b==b'.'||b==b'_'){return Err("unknown-model".into());}
  let target=app.state::<AndroidInference>().0.run_mobile_plugin_async::<serde_json::Value>("operation",serde_json::json!({"action":"download-begin","model":model})).await.map_err(refusal)?;
  let path=target["path"].as_str().ok_or("model-download-rejected")?.to_string();let limit=target["bytes"].as_u64().ok_or("model-download-rejected")?;
  let file=std::fs::File::create(&path).map_err(|_|"model-store-failed")?;
  let state=app.state::<DownloadState>();let mut slot=state.0.lock().map_err(|_|"busy")?;
  if slot.is_some(){return Err("busy".into());}
  *slot=Some(Download{file,model,written:0,limit});return Ok(serde_json::json!({"started":true,"bytes":limit}));}
 #[cfg(not(target_os="android"))]{let _=(app,model);Err("android-only".into())}
}
#[tauri::command]
// Android's WebView cannot read IPC request bodies, so Tauri sends every call as JSON through postMessage
// (a Uint8Array would become a number array). Chunks therefore arrive as base64, at most 8 MiB decoded.
fn model_download_write(app:tauri::AppHandle,chunk:String)->Result<u64,String>{
 #[cfg(target_os="android")]{use tauri::Manager;use std::io::Write;use base64::Engine;
  if chunk.len()>8*1024*1024/3*4+4{return Err("chunk-too-large".into());}
  let bytes=base64::engine::general_purpose::STANDARD.decode(chunk.as_bytes()).map_err(|_|"invalid-chunk")?;let bytes=&bytes[..];
  let state=app.state::<DownloadState>();let mut slot=state.0.lock().map_err(|_|"busy")?;
  let d=slot.as_mut().ok_or("no-download")?;
  if d.written+bytes.len() as u64>d.limit{return Err("byte-budget".into());}
  d.file.write_all(bytes).map_err(|_|"model-store-failed")?;d.written+=bytes.len() as u64;return Ok(d.written);}
 #[cfg(not(target_os="android"))]{let _=(app,chunk);Err("android-only".into())}
}
#[tauri::command]
async fn model_download_finish(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 #[cfg(target_os="android")]{use tauri::Manager;
  let d={let state=app.state::<DownloadState>();let mut slot=state.0.lock().map_err(|_|"busy")?;slot.take().ok_or("no-download")?};
  d.file.sync_all().map_err(|_|"model-store-failed")?;let model=d.model.clone();drop(d);
  return app.state::<AndroidInference>().0.run_mobile_plugin_async("operation",serde_json::json!({"action":"download-finish","model":model})).await.map_err(refusal);}
 #[cfg(not(target_os="android"))]{let _=app;Err("android-only".into())}
}
#[tauri::command]
async fn model_download_abort(app:tauri::AppHandle)->Result<serde_json::Value,String>{
 #[cfg(target_os="android")]{use tauri::Manager;
  let d={let state=app.state::<DownloadState>();let mut slot=state.0.lock().map_err(|_|"busy")?;slot.take()};
  let Some(d)=d else {return Ok(serde_json::json!({"aborted":false}))};let model=d.model.clone();drop(d);
  return app.state::<AndroidInference>().0.run_mobile_plugin_async("operation",serde_json::json!({"action":"download-abort","model":model})).await.map_err(refusal);}
 #[cfg(not(target_os="android"))]{let _=app;Err("android-only".into())}
}
#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default())
 .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-inference").setup(|_app,_api|{
  #[cfg(target_os="android")]{use tauri::Manager;let handle=_api.register_android_plugin("network.awai.murakumo","InferencePlugin")?;_app.manage(AndroidInference(handle));}Ok(())}).build())
 .setup(|_app|{#[cfg(target_os="android")]{use tauri::Manager;_app.manage(DownloadState::default());}Ok(())})
 .invoke_handler(tauri::generate_handler![inference_operation,model_download_begin,model_download_write,model_download_finish,model_download_abort]).run(tauri::generate_context!()).expect("Murakumo initialization failed");}
