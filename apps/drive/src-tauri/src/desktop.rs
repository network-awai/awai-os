//! Bounded macOS app-private file adapter (AWAI-3256).
//!
//! Mirrors the Android `DriveFiles` rules: names are validated and NFC-normalised, paths stay
//! inside one app-private root, symlinks are refused, a folder holds at most 1000 entries, and a
//! saved file is published with an atomic no-clobber link. This is a transport adapter only; it
//! is not an AwaiFS codec, CID or crypto implementation and has no network authority.
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use unicode_normalization::UnicodeNormalization;

pub const MAX_ENTRIES: usize = 1000;
pub const MAX_TEXT: usize = 65536;
pub const RESERVE: u64 = 64 * 1024 * 1024;

pub struct Local {
    root: PathBuf,
}

fn io(e: std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::AlreadyExists => "file-exists".into(),
        std::io::ErrorKind::NotFound => "invalid-path".into(),
        _ => "drive-operation-failed".into(),
    }
}

pub fn name(n: &str) -> Result<String, String> {
    if n.trim().is_empty()
        || n.chars().count() > 160
        || n == "."
        || n == ".."
        || n.starts_with(".pending-")
        || n.chars().any(|c| c == '/' || c == '\\' || (c as u32) < 0x20 || c as u32 == 0x7f)
    {
        return Err("invalid-name".into());
    }
    Ok(n.nfc().collect())
}

fn is_symlink(p: &Path) -> bool {
    fs::symlink_metadata(p).map(|m| m.file_type().is_symlink()).unwrap_or(false)
}

fn sync_dir(p: &Path) -> Result<(), String> {
    fs::File::open(p).and_then(|f| f.sync_all()).map_err(io)
}

#[cfg(unix)]
fn available(p: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let c = CString::new(p.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    Some(s.f_bavail as u64 * s.f_frsize as u64)
}

impl Local {
    pub fn new(base: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&base).map_err(io)?;
        let root = base.canonicalize().map_err(io)?;
        Ok(Local { root })
    }

    /// Resolve a relative, slash-separated path inside the root, refusing anything else.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf, String> {
        if rel.len() > 2048 {
            return Err("invalid-path".into());
        }
        if rel.is_empty() {
            return Ok(self.root.clone());
        }
        let parts: Vec<&str> = rel.split('/').collect();
        if parts.len() > 16 {
            return Err("invalid-path".into());
        }
        let mut f = self.root.clone();
        for p in parts {
            f.push(name(p).map_err(|_| "invalid-path".to_string())?);
            if is_symlink(&f) {
                return Err("invalid-path".into());
            }
        }
        if f.components().any(|c| matches!(c, Component::ParentDir)) || !f.starts_with(&self.root) || f == self.root {
            return Err("invalid-path".into());
        }
        Ok(f)
    }

    pub fn path(&self, f: &Path) -> String {
        f.strip_prefix(&self.root).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
    }

    fn directory(&self, p: &str) -> Result<PathBuf, String> {
        let f = self.resolve(p)?;
        if !f.is_dir() {
            return Err("invalid-path".into());
        }
        Ok(f)
    }

    pub fn list(&self, p: &str) -> Result<Vec<serde_json::Value>, String> {
        let dir = self.directory(p)?;
        let mut rows = Vec::new();
        for entry in fs::read_dir(&dir).map_err(io)? {
            let entry = entry.map_err(io)?;
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if file_name.starts_with(".pending-") {
                continue;
            }
            let meta = fs::symlink_metadata(entry.path()).map_err(io)?;
            if meta.file_type().is_symlink() {
                return Err("invalid-path".into());
            }
            rows.push((meta.is_dir(), file_name, entry.path(), meta.len()));
            if rows.len() > MAX_ENTRIES {
                return Err("entry-limit".into());
            }
        }
        rows.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        Ok(rows
            .into_iter()
            .map(|(directory, name, path, bytes)| {
                serde_json::json!({"name": name, "path": self.path(&path), "directory": directory,
                    "bytes": if directory { 0 } else { bytes }, "local": true, "remoteVerified": false})
            })
            .collect())
    }

    fn child(&self, parent: &str, n: &str) -> Result<(PathBuf, PathBuf), String> {
        let dir = self.directory(parent)?;
        let rel = if parent.is_empty() { name(n)? } else { format!("{}/{}", parent, name(n)?) };
        Ok((dir, self.resolve(&rel)?))
    }

    pub fn mkdir(&self, parent: &str, n: &str) -> Result<(), String> {
        if self.list(parent)?.len() >= MAX_ENTRIES {
            return Err("entry-limit".into());
        }
        let (dir, dest) = self.child(parent, n)?;
        fs::create_dir(&dest).map_err(io)?;
        sync_dir(&dir)
    }

    /// Save a small text note. Written to a pending file, synced, then published with a hard
    /// link, which fails instead of replacing an existing entry.
    pub fn create_text(&self, parent: &str, n: &str, text: &str) -> Result<String, String> {
        let bytes = text.as_bytes();
        if bytes.len() > MAX_TEXT {
            return Err("file-too-large".into());
        }
        if self.list(parent)?.len() >= MAX_ENTRIES {
            return Err("entry-limit".into());
        }
        let (dir, dest) = self.child(parent, n)?;
        if fs::symlink_metadata(&dest).is_ok() {
            return Err("file-exists".into());
        }
        if available(&dir).map_or(false, |free| free < RESERVE + bytes.len() as u64) {
            return Err("storage-full".into());
        }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let tmp = dir.join(format!(".pending-{}-{}.part", std::process::id(), stamp));
        let result = (|| {
            let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(io)?;
            f.write_all(bytes).map_err(io)?;
            f.sync_all().map_err(io)?;
            fs::hard_link(&tmp, &dest).map_err(io)?;
            sync_dir(&dir)
        })();
        let _ = fs::remove_file(&tmp);
        result?;
        Ok(format!("{:x}", Sha256::digest(bytes)))
    }

    pub fn file(&self, rel: &str) -> Result<PathBuf, String> {
        let f = self.resolve(rel)?;
        if !f.is_file() {
            return Err("invalid-path".into());
        }
        Ok(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> Local {
        let d = std::env::temp_dir().join(format!("awai-drive-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        Local::new(d).unwrap()
    }

    #[test]
    fn refuses_bad_names_and_paths() {
        let l = temp();
        for n in ["", " ", ".", "..", "a/b", "a\\b", ".pending-x", "a\u{0}b"] {
            assert_eq!(name(n), Err("invalid-name".to_string()), "{n:?}");
        }
        assert!(name(&"x".repeat(161)).is_err());
        for p in ["../etc", "a/../../b", "/abs", "a//b"] {
            assert_eq!(l.resolve(p), Err("invalid-path".to_string()), "{p}");
        }
        assert!(l.resolve(&vec!["a"; 17].join("/")).is_err());
    }

    #[test]
    fn saves_lists_and_reads_back() {
        let l = temp();
        l.mkdir("", "メモ").unwrap();
        let h = l.create_text("メモ", "note.txt", "hello").unwrap();
        assert_eq!(h, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        let rows = l.list("メモ").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["path"], "メモ/note.txt");
        assert_eq!(fs::read_to_string(l.file("メモ/note.txt").unwrap()).unwrap(), "hello");
        assert_eq!(l.create_text("メモ", "note.txt", "again"), Err("file-exists".to_string()));
        assert_eq!(fs::read_to_string(l.file("メモ/note.txt").unwrap()).unwrap(), "hello");
        assert_eq!(l.mkdir("", "メモ"), Err("file-exists".to_string()));
        assert!(l.list("").unwrap()[0]["directory"].as_bool().unwrap());
    }

    #[test]
    fn refuses_symlinks_large_text_and_files_as_folders() {
        let l = temp();
        std::os::unix::fs::symlink("/etc", l.root.join("link")).unwrap();
        assert_eq!(l.resolve("link"), Err("invalid-path".to_string()));
        assert_eq!(l.list(""), Err("invalid-path".to_string()));
        fs::remove_file(l.root.join("link")).unwrap();
        assert_eq!(l.create_text("", "big", &"x".repeat(MAX_TEXT + 1)), Err("file-too-large".to_string()));
        l.create_text("", "f", "x").unwrap();
        assert_eq!(l.list("f"), Err("invalid-path".to_string()));
        assert_eq!(l.file(""), Err("invalid-path".to_string()));
    }

    #[test]
    fn normalizes_names_to_nfc() {
        let l = temp();
        l.create_text("", "e\u{301}.txt", "x").unwrap();
        assert_eq!(l.list("").unwrap()[0]["name"], "\u{e9}.txt");
    }
}
