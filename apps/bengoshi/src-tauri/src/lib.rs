// Bengoshi (network.itonami.bengoshi): thin Tauri v3 host adapter.
// All domain logic, O2/O4/O8/O9/AWAI-3235 invariants, client-side E2EE, and canonical
// kotoba-client-runtime consent live in the WebView JS modules. This host exposes only
// awai_host_info and grants no native filesystem, shell, installer, or arbitrary network authority.

#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({
        "schema": "awai.shell.host.v1",
        "appId": "network.itonami.bengoshi",
        "agendaProjection": false
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .invoke_handler(tauri::generate_handler![awai_host_info])
        .run(tauri::generate_context!())
        .expect("Bengoshi initialization failed");
}
