// Data Contributions (AWAI-3209): the participant's contributions, rights declarations, withdrawals and
// test-stage reward results run in the WebView. This host exposes its version and an app-private Awai FS
// block store (awai_fs.rs, shared design with Horei) for the contributed bytes and the rights statement,
// keyed by CIDv1 raw sha2-256. It has no network, installer or shell commands: submission to
// cloud-murakumo-api goes from the WebView through the canonical consent broker, one approval per request.
mod awai_fs;
use tauri::{ipc::{InvokeBody, Request, Response}, AppHandle, Manager};

#[tauri::command]
fn awai_host_info() -> serde_json::Value {
    serde_json::json!({"schema":"awai.shell.host.v1", "agendaProjection":false, "awaiFs":"awai.fs.blocks.v1"})
}
fn store(app: &AppHandle) -> Result<awai_fs::Store, String> {
    Ok(awai_fs::Store::new(app.path().app_data_dir().map_err(|_| "io: app-data-dir".to_string())?.join("awai-fs")))
}
// Returns the block's bytes, or an empty body when it is absent.
#[tauri::command]
fn awai_fs_get(app: AppHandle, cid: String) -> Result<Response, String> {
    Ok(Response::new(store(&app)?.get(&cid).map_err(|e| e.to_string())?.unwrap_or_default()))
}
// Body = block bytes; header x-awai-cid names the CID they must hash to. Desktop WebViews deliver a
// Uint8Array as a raw body; the Android IPC delivers it as a JSON array of bytes (measured on the
// API 35 emulator, AWAI-3209), so both are accepted. Anything else is refused.
#[tauri::command]
fn awai_fs_put(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let cid = request.headers().get("x-awai-cid").and_then(|v| v.to_str().ok()).ok_or("invalid-cid")?.to_string();
    let bytes = body_bytes(request.body())?;
    store(&app)?.put(&cid, &bytes).map_err(|e| e.to_string())
}
fn body_bytes(body: &InvokeBody) -> Result<Vec<u8>, String> {
    match body {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(serde_json::Value::Array(items)) if items.len() <= awai_fs::MAX_BLOCK_BYTES =>
            items.iter().map(|v| v.as_u64().filter(|n| *n <= 255).map(|n| n as u8).ok_or_else(|| "byte-body-required".to_string())).collect(),
        _ => Err("byte-body-required".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn raw_and_json_byte_bodies_are_accepted_others_refused() {
        assert_eq!(body_bytes(&InvokeBody::Raw(vec![1, 2, 255])).unwrap(), vec![1, 2, 255]);
        assert_eq!(body_bytes(&InvokeBody::Json(serde_json::json!([1, 2, 255]))).unwrap(), vec![1, 2, 255]);
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!([256]))).is_err());
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!([-1]))).is_err());
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!({"cid": "x"}))).is_err());
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .invoke_handler(tauri::generate_handler![awai_host_info, awai_fs_get, awai_fs_put])
        .run(tauri::generate_context!())
        .expect("Data Contributions initialization failed");
}
