// Public Funds: on-device view of awai.public-funds/1 records written by the
// awai-public-funds itonami profile (AWAI-3296, network-awai-apex ADR 0046).
// The UI, the record checks and storage run in the WebView; this host exposes only its version.
// No network, publisher fetch, publication, filesystem, installer or shell commands.
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
        .expect("Public Funds initialization failed");
}
