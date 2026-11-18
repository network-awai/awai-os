#[cfg(target_os = "android")]
struct AndroidBackup(tauri::plugin::PluginHandle<tauri::DynRuntime>);

#[tauri::command]
async fn save_office_backup(
    _app: tauri::AppHandle,
    name: String,
    snapshot: String,
) -> Result<serde_json::Value, String> {
    if snapshot.is_empty() || snapshot.len() > 35_000 || name.len() > 64 {
        return Err("invalid-backup".into());
    }

    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return _app
            .state::<AndroidBackup>()
            .0
            .run_mobile_plugin_async(
                "save",
                serde_json::json!({ "name": name, "snapshot": snapshot }),
            )
            .await
            .map_err(|_| "backup-write-failed".into());
    }
    #[cfg(not(target_os = "android"))]
    Err("backup-picker-unavailable".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(
            tauri::plugin::Builder::<tauri::DynRuntime, ()>::new("awai-office-backup")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle = _api
                            .register_android_plugin("network.awai.office", "OfficeBackupPlugin")?;
                        _app.manage(AndroidBackup(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![save_office_backup])
        .run(tauri::generate_context!())
        .expect("Office editor initialization failed");
}
