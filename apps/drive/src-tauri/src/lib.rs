#[cfg(target_os="android")]
struct AndroidDrive(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[cfg(target_os="macos")]
mod desktop;
#[tauri::command]
fn awai_host_info()->serde_json::Value { serde_json::json!({"schema":"awai.shell.host.v1","driveLocal":cfg!(any(target_os="android",target_os="macos")),"sync":false}) }
#[cfg(target_os="macos")]
fn macos_call(local:&desktop::Local, op:&str, request:&serde_json::Value)->Result<serde_json::Value,String>{
 let s=|k:&str|request.get(k).and_then(|v|v.as_str()).map(str::to_owned).ok_or_else(||"invalid-request".to_string());
 match op{
  "list"=>Ok(serde_json::json!({"entries":local.list(&s("parent")?)?})),
  "mkdir"=>{local.mkdir(&s("parent")?,&s("name")?)?;Ok(serde_json::Value::Null)}
  "createText"=>Ok(serde_json::json!({"sha256":local.create_text(&s("parent")?,&s("name")?,&s("text")?)?})),
  // Hand the app-private file to the user's default viewer, like Android's ACTION_VIEW.
  "open"=>{let f=local.file(&s("path")?)?;let ok=std::process::Command::new("/usr/bin/open").arg("--").arg(&f).status().map(|st|st.success()).unwrap_or(false);if ok{Ok(serde_json::Value::Null)}else{Err("drive-operation-failed".into())}}
  "pick"=>Err("import-unavailable".into()),
  // Encrypted sync needs a macOS key custody adapter that does not exist yet; report it as not set up.
  "vaultStatus"=>Ok(serde_json::json!({"initialized":false,"synced":false,"origin":"","evicted":false})),
  _=>Err("android-adapter-required".into()),
 }
}
#[tauri::command]
async fn drive_call(_app:tauri::AppHandle, request:serde_json::Value)->Result<serde_json::Value,String>{
 if serde_json::to_vec(&request).map_err(|_|"invalid-request")?.len()>131072{return Err("request-limit".into())}
 let op=request.get("op").and_then(|v|v.as_str()).ok_or("invalid-operation")?.to_owned();
 if !["list","mkdir","createText","pick","open","vaultStatus","vaultSession","vaultRecord","vaultInventory","vaultRead","vaultCommit","vaultEvict","vaultRestoreBegin","vaultRestoreWrite","vaultRestorePublish"].contains(&op.as_str()){return Err("unsupported-operation".into())}
 #[cfg(target_os="android")]{use tauri::Manager;return _app.state::<AndroidDrive>().0.run_mobile_plugin_async("execute",serde_json::json!({"payload":request.to_string()})).await.map_err(|e| { let message=e.to_string(); ["unsynced-data","recovery-required","restore-mismatch","sync-size-limit","file-busy","file-exists","invalid-name","invalid-path","storage-full","file-too-large","import-cancelled","source-size-changed","local-provider-required"].iter().find(|code|message.contains(**code)).unwrap_or(&"drive-operation-failed").to_string() });}
 #[cfg(target_os="macos")]{use tauri::Manager;let app=_app.clone();return tauri::async_runtime::spawn_blocking(move||{let local=app.state::<desktop::Local>();macos_call(&local,&op,&request)}).await.map_err(|_|"drive-operation-failed".to_string())?;}
 #[cfg(not(any(target_os="android",target_os="macos")))] Err("android-adapter-required".into())
}
#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default())
 .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-drive").setup(|_app,_api|{
 #[cfg(target_os="android")]{use tauri::Manager;let h=_api.register_android_plugin("network.awai.drive","DrivePlugin")?;_app.manage(AndroidDrive(h));}
 #[cfg(target_os="macos")]{use tauri::Manager;let dir=_app.path().app_data_dir()?.join("drive-local-v1");_app.manage(desktop::Local::new(dir).map_err(|e|std::io::Error::other(e))?);}
 Ok(())}).build())
 .invoke_handler(tauri::generate_handler![awai_host_info,drive_call]).run(tauri::generate_context!()).expect("Drive initialization failed");}
