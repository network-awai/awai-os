fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["awai_host_info", "awai_fs_get", "awai_fs_put"]),
    )).expect("Data Contributions build");
}
