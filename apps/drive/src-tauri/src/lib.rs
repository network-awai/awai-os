#[cfg(target_os="android")]
struct AndroidDrive(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[tauri::command]
fn awai_host_info()->serde_json::Value { serde_json::json!({"schema":"awai.shell.host.v1","driveLocal":cfg!(target_os="android"),"sync":false}) }
#[tauri::command]
async fn drive_call(_app:tauri::AppHandle, request:serde_json::Value)->Result<serde_json::Value,String>{
 if serde_json::to_vec(&request).map_err(|_|"invalid-request")?.len()>131072{return Err("request-limit".into())}
 let op=request.get("op").and_then(|v|v.as_str()).ok_or("invalid-operation")?;
 if !["list","mkdir","createText","pick","open","vaultStatus","vaultSession","vaultRecord","vaultInventory","vaultRead","vaultCommit","vaultEvict","vaultRestoreBegin","vaultRestoreWrite","vaultRestorePublish"].contains(&op){return Err("unsupported-operation".into())}
 #[cfg(target_os="android")]{use tauri::Manager;return _app.state::<AndroidDrive>().0.run_mobile_plugin_async("execute",serde_json::json!({"payload":request.to_string()})).await.map_err(|e| { let message=e.to_string(); ["unsynced-data","recovery-required","restore-mismatch","sync-size-limit","file-busy","file-exists","invalid-name","invalid-path","storage-full","file-too-large","import-cancelled","source-size-changed","local-provider-required"].iter().find(|code|message.contains(**code)).unwrap_or(&"drive-operation-failed").to_string() });}
 #[cfg(not(target_os="android"))] Err("android-adapter-required".into())
}
#[cfg_attr(mobile,tauri::mobile_entry_point)]
pub fn run(){tauri::Builder::default().runtime(tauri_runtime_wry::Wry::default())
 .plugin(tauri::plugin::Builder::<tauri::DynRuntime,()>::new("awai-drive").setup(|_app,_api|{
 #[cfg(target_os="android")]{use tauri::Manager;let h=_api.register_android_plugin("network.awai.drive","DrivePlugin")?;_app.manage(AndroidDrive(h));}Ok(())}).build())
 .invoke_handler(tauri::generate_handler![awai_host_info,drive_call]).run(tauri::generate_context!()).expect("Drive initialization failed");}
