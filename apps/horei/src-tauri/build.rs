fn main() {
    // Android 15+ devices may use 16 KB memory pages: align the native library's
    // LOAD segments to 16 KB (AWAI-3420, AWAI-3393). A build-script link arg applies even
    // when the Tauri CLI sets CARGO_TARGET_<triple>_RUSTFLAGS for Android.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["awai_host_info", "awai_fs_get", "awai_fs_put", "awai_fs_delete"]),
    )).expect("Horei build");
}
