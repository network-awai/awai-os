//! A non-secret, app-private completion marker. Never authenticates an account.
use std::{fs::{self, File, OpenOptions}, io::{self, Write}, path::Path};
const RECORD: &[u8] = b"{\"schema\":\"awai.setup.state.v1\",\"complete\":true}\n";
pub fn read(dir: &Path) -> io::Result<bool> {
    match fs::read(dir.join("setup-v1.json")) {
        Ok(bytes) if bytes == RECORD => Ok(true),
        Ok(_) => Err(io::Error::new(io::ErrorKind::InvalidData, "invalid-setup-record")),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}
pub fn complete(dir: &Path) -> io::Result<()> {
    let _ = read(dir)?; // Refuse unknown data; re-sync even an idempotent completion.
    fs::create_dir_all(dir)?;
    // Serialize competing writers at the command boundary; use a fixed private
    // temp path and truncate a leftover interrupted write. The published record
    // is replaced only after file synchronization, then its directory is synced.
    let temp = dir.join("setup-v1.pending");
    let mut options = OpenOptions::new(); options.write(true).create(true).truncate(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&temp)?;
    file.write_all(RECORD)?;
    file.sync_all()?;
    fs::rename(&temp, dir.join("setup-v1.json"))?;
    File::open(dir)?.sync_all()?;
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn sandbox(name:&str)->std::path::PathBuf {
        let dir=std::env::var_os("AWAI_TEST_OUTPUT").expect("explicit task output required");
        let path=std::path::PathBuf::from(dir).join(format!("{}-{}",name,std::process::id()));
        fs::create_dir_all(&path).unwrap();path
    }
    #[test] fn published_record_survives_reopen_and_is_idempotent(){
        let dir=sandbox("reopen");assert!(!read(&dir).unwrap());complete(&dir).unwrap();
        assert!(read(&dir).unwrap());complete(&dir).unwrap();assert!(read(&dir).unwrap());
    }
    #[test] fn interrupted_temp_never_counts_as_completed(){
        let dir=sandbox("partial");fs::write(dir.join("setup-v1.pending"),b"partial").unwrap();
        assert!(!read(&dir).unwrap());complete(&dir).unwrap();assert!(read(&dir).unwrap());
    }
    #[test] fn unknown_or_corrupt_record_is_preserved_and_refused(){
        let dir=sandbox("corrupt");fs::write(dir.join("setup-v1.json"),b"unknown-version").unwrap();
        assert!(read(&dir).is_err());assert!(complete(&dir).is_err());
        assert_eq!(fs::read(dir.join("setup-v1.json")).unwrap(),b"unknown-version");
    }
    #[test] fn failed_io_never_acknowledges_completion(){
        let dir=sandbox("io");fs::create_dir(dir.join("setup-v1.pending")).unwrap();
        assert!(complete(&dir).is_err());assert!(!read(&dir).unwrap());
    }
}
