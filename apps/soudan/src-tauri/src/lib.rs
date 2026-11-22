// Soudan: legal consultation memo. The UI, the memo template and the draft run in the WebView;
// this host exposes its version and one Android-only share-sheet command. It has no network,
// filesystem, installer or shell commands. The memo leaves the app only through the OS share
// sheet the user picks, after governor review (approvedOperations) and the per-operation consent
// dialog in the page (AWAI-3236, scope ADR 0001 D9 / owner decision O1).
#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({"schema":"awai.shell.host.v1", "agendaProjection":false})
}
#[cfg(target_os = "android")]
struct AndroidShare(tauri::plugin::PluginHandle<tauri::DynRuntime>);
/// The plugin's own refusal code when it is a plain lower-case code; anything else stays generic,
/// so no native detail reaches the page.
#[cfg(target_os = "android")]
fn refusal(e: tauri::plugin::mobile::PluginInvokeError) -> String {
    if let tauri::plugin::mobile::PluginInvokeError::InvokeRejected(r) = e {
        if let Some(m) = r.message {
            if !m.is_empty() && m.len() <= 60 && m.bytes().all(|b| b.is_ascii_lowercase() || b == b'-') {
                return m;
            }
        }
    }
    "native-operation-rejected".into()
}
/// Hand memo text to the OS share sheet (ACTION_SEND chooser). The text is bounded plain text;
/// anything else is refused. Completing the share inside the chosen app is outside this app.
#[tauri::command]
async fn soudan_share(app: tauri::AppHandle, text: String) -> Result<serde_json::Value, String> {
    // The broker already bounds the payload to 65536 UTF-16 units; UTF-8 can
    // expand that to at most three bytes per unit, so anything larger never
    // came through the consent gate.
    if text.is_empty() || text.len() > 196608 {
        return Err("invalid-text".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        return app
            .state::<AndroidShare>()
            .0
            .run_mobile_plugin_async("share", serde_json::json!({"text": text}))
            .await
            .map_err(refusal);
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, text);
        Err("android-only".into())
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .plugin(
            tauri::plugin::Builder::<tauri::DynRuntime, ()>::new("soudan-share")
                .setup(|_app, _api| {
                    #[cfg(target_os = "android")]
                    {
                        use tauri::Manager;
                        let handle = _api.register_android_plugin("network.itonami.soudan", "SharePlugin")?;
                        _app.manage(AndroidShare(handle));
                    }
                    Ok(())
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![awai_host_info, soudan_share])
        .run(tauri::generate_context!())
        .expect("Soudan initialization failed");
}
