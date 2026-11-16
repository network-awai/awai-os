#[cfg(target_os = "android")]
struct AndroidAgenda(tauri::plugin::PluginHandle<tauri::DynRuntime>);
#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({"schema":"awai.shell.host.v1", "agendaProjection":cfg!(target_os="android")})
}
#[tauri::command]
async fn awai_legacy_agenda(_app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let result: serde_json::Value = _app.state::<AndroidAgenda>().0
            .run_mobile_plugin_async("legacyAgenda", serde_json::json!({})).await.map_err(|_| "legacy-read-failed")?;
        return Ok(result.get("events").filter(|v|!v.is_null()).cloned());
    }
    #[cfg(not(target_os = "android"))]
    Ok(None)
}
#[tauri::command]
async fn awai_project_agenda(_app: tauri::AppHandle, events: serde_json::Value) -> Result<(), String> {
    let items = events.as_array().ok_or("invalid-events")?;
    if items.len() > 200 || serde_json::to_vec(&events).map_err(|_|"invalid-events")?.len()>131072 { return Err("event-limit".into()); }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        let _: serde_json::Value = _app.state::<AndroidAgenda>().0.run_mobile_plugin_async(
            "projectAgenda",serde_json::json!({"payload":events.to_string()})
        ).await.map_err(|_|"agenda-projection-failed")?;
    }
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(tauri::plugin::Builder::<tauri::DynRuntime, ()>::new("awai-shell").setup(|_app,_api| {
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle=_api.register_android_plugin("network.awai.shell","AwaiShellPlugin")?;
                _app.manage(AndroidAgenda(handle));
            }
            Ok(())
        }).build())
        .invoke_handler(tauri::generate_handler![awai_host_info, awai_legacy_agenda, awai_project_agenda])
        .run(tauri::generate_context!())
        .expect("Yotei initialization failed");
}
