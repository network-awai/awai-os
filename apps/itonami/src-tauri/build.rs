fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["awai_host_info","awai_local_inference"]),
    )).expect("Itonami build");
}
