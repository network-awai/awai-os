// Soudan: legal consultation memo. The UI, the memo template and the draft run in the WebView;
// this host exposes only its version. No network, filesystem, installer, share or shell commands.
#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({"schema":"awai.shell.host.v1", "agendaProjection":false})
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .invoke_handler(tauri::generate_handler![awai_host_info])
        .run(tauri::generate_context!())
        .expect("Soudan initialization failed");
}
