#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::{atomic::{AtomicBool, Ordering}, Mutex},
};
use tauri::{Emitter, Manager};

struct Worker { child: Child, input: Option<ChildStdin>, output: BufReader<ChildStdout> }
impl Drop for Worker {
    fn drop(&mut self) {
        // EOF lets the .cljc controller stop its owned hypervisors and release its lock.
        // Worker is normally closed only after the UI has stopped every VM.
        drop(self.input.take());
        let _ = self.child.wait();
    }
}
#[derive(Default)]
struct Bridge { worker: Mutex<Option<Worker>>, running: AtomicBool }

fn spawn(app: &tauri::AppHandle) -> Result<Worker, String> {
    let resources = app.path().resource_dir().map_err(|_| "resources-unavailable")?;
    let data = app.path().app_config_dir().map_err(|_| "config-unavailable")?;
    #[cfg(debug_assertions)]
    let data = std::env::var_os("MEIJI_CONFIG_DIR").map(std::path::PathBuf::from).unwrap_or(data);
    std::fs::create_dir_all(&data).map_err(|_| "config-unavailable")?;
    // Release builds never search PATH or accept a frontend-selected executable.
    let bb = if cfg!(windows) { "bb.exe" } else { "bb" };
    let executable = resources.join("bin").join(bb);
    #[cfg(debug_assertions)]
    let executable = std::env::var_os("MEIJI_BB").map(std::path::PathBuf::from).unwrap_or(executable);
    let mut child = Command::new(executable)
        .arg("-cp").arg(resources.join("meiji-src"))
        .arg("-m").arg("meiji.host")
        .arg(data.join("meiji.edn")).arg(data.join("state"))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| "controller-unavailable")?;
    let input = child.stdin.take().ok_or("controller-unavailable")?;
    let output = BufReader::new(child.stdout.take().ok_or("controller-unavailable")?);
    Ok(Worker { child, input: Some(input), output })
}

#[tauri::command]
async fn meiji_request(app: tauri::AppHandle, request: Value, state: tauri::State<'_, Bridge>) -> Result<Value, String> {
    let mut guard = state.worker.lock().map_err(|_| "controller-unavailable")?;
    let bytes = serde_json::to_vec(&request).map_err(|_| "invalid-request")?;
    if bytes.len() > 4096 { return Err("request-too-large".into()); }
    if guard.is_none() { *guard = Some(spawn(&app)?); }
    let worker = guard.as_mut().ok_or("controller-unavailable")?;
    if worker.child.try_wait().map_err(|_| "controller-unavailable")?.is_some() {
        // Do not silently replace a controller after a crash.
        return Err("controller-exited".into());
    }
    if request["op"] == "start" { state.running.store(true, Ordering::Release); }
    let input = worker.input.as_mut().ok_or("controller-disconnected")?;
    input.write_all(&bytes).and_then(|_| input.write_all(b"\n"))
        .and_then(|_| input.flush()).map_err(|_| "controller-disconnected")?;
    let mut line = String::new();
    (&mut worker.output).take(64 * 1024 * 1024).read_line(&mut line).map_err(|_| "controller-disconnected")?;
    let reply: Value = serde_json::from_str(&line).map_err(|_| "invalid-controller-response")?;
    if let Some(vms) = reply.pointer("/ok/vms").and_then(Value::as_array) {
        state.running.store(vms.iter().any(|vm| matches!(vm["state"].as_str(), Some("running" | "stopping"))), Ordering::Release);
    }
    Ok(reply)
}

fn main() {
    tauri::Builder::default()
        .runtime(tauri_runtime_wry::Wry::default())
        .manage(Bridge::default())
        .invoke_handler(tauri::generate_handler![meiji_request])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Bridge>().running.load(Ordering::Acquire) {
                    api.prevent_close();
                    let _ = window.emit("meiji-close-blocked", json!({"reason":"stop-before-exit"}));
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Meiji desktop initialization failed")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<Bridge>().running.load(Ordering::Acquire) {
                    api.prevent_exit();
                    let _ = app.emit("meiji-close-blocked", json!({"reason":"stop-before-exit"}));
                }
            }
        });
}
