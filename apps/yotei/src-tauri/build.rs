fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["awai_host_info", "awai_legacy_agenda", "awai_project_agenda"]),
    )).expect("Yotei build");
}
