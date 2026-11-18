// Securities Drafts: local drafts and reviews of the account holder's own ISO 20022 sese.023 / semt.002
// messages (AWAI-3158). The UI, the message builder, the L1 checks
// and draft storage run in the WebView; this host exposes only its version.
// No network, custodian connection, signing, filesystem, installer or shell commands.
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
        .expect("Securities Drafts initialization failed");
}
