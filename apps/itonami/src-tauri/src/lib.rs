#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({
        "schema": "awai.shell.host.v1",
        "app": "itonami",
        "runtime": "tauri-3.0.0-alpha.6-wry",
        "platform": std::env::consts::OS,
        "nixosServices": false,
        "localInference": false,
        "hostFilesystem": false,
        "externalOperations": "canonical-browser-broker-each-operation"
    })
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .invoke_handler(tauri::generate_handler![awai_host_info])
        .run(tauri::generate_context!())
        .expect("Itonami initialization failed");
}
