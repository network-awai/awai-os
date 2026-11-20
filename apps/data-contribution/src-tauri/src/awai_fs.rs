// Awai FS block store (Horei AWAI-3324 design; here for contributed bytes and rights statements, AWAI-3209): app-private, content-addressed, verified.
// A block is stored at <root>/blocks/<cid>, where cid is CIDv1 raw sha2-256 in base32 ("bafkrei…").
// Every put and every get recomputes the SHA-256 of the bytes and compares it with the CID.
// A put whose bytes do not hash to the CID writes nothing. A stored block that no longer hashes to its
// CID is deleted and reported as absent, so a damaged copy is never returned.
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_BLOCK_BYTES: usize = 16 * 1024 * 1024; // the yataverse.com block limit

#[derive(Debug, PartialEq)]
pub enum Error { InvalidCid, Mismatch, TooLarge, Io(String) }
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self { Error::InvalidCid => f.write_str("invalid-cid"), Error::Mismatch => f.write_str("mismatch"),
            Error::TooLarge => f.write_str("too-large"), Error::Io(e) => write!(f, "io: {e}") }
    }
}
fn io(e: std::io::Error) -> Error { Error::Io(e.kind().to_string()) }

/// The 32-byte SHA-256 digest named by a CIDv1 raw sha2-256 CID in base32, or InvalidCid.
pub fn digest_of(cid: &str) -> Result<[u8; 32], Error> {
    let body = cid.strip_prefix('b').ok_or(Error::InvalidCid)?;
    if body.len() != 58 { return Err(Error::InvalidCid); }
    let (mut value, mut bits, mut out) = (0u32, 0u32, Vec::with_capacity(36));
    for c in body.bytes() {
        let v = match c { b'a'..=b'z' => c - b'a', b'2'..=b'7' => c - b'2' + 26, _ => return Err(Error::InvalidCid) } as u32;
        value = (value << 5) | v; bits += 5;
        if bits >= 8 { bits -= 8; out.push((value >> bits) as u8); value &= (1 << bits) - 1; }
    }
    if value != 0 || out.len() != 36 || out[..4] != [0x01, 0x55, 0x12, 0x20] { return Err(Error::InvalidCid); }
    let mut d = [0u8; 32]; d.copy_from_slice(&out[4..]); Ok(d)
}

pub struct Store { root: PathBuf }
impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self { Store { root: root.into() } }
    fn path(&self, cid: &str) -> PathBuf { self.root.join("blocks").join(cid) }
    fn matches(digest: &[u8; 32], bytes: &[u8]) -> bool { Sha256::digest(bytes).as_slice() == digest }

    pub fn get(&self, cid: &str) -> Result<Option<Vec<u8>>, Error> {
        let digest = digest_of(cid)?;
        let path = self.path(cid);
        let bytes = match fs::read(&path) { Ok(b) => b, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(e) => return Err(io(e)) };
        if bytes.len() <= MAX_BLOCK_BYTES && Self::matches(&digest, &bytes) { return Ok(Some(bytes)); }
        fs::remove_file(&path).map_err(io)?;
        Ok(None)
    }

    pub fn put(&self, cid: &str, bytes: &[u8]) -> Result<(), Error> {
        let digest = digest_of(cid)?;
        if bytes.len() > MAX_BLOCK_BYTES { return Err(Error::TooLarge); }
        if !Self::matches(&digest, bytes) { return Err(Error::Mismatch); }
        let dir = self.root.join("blocks");
        fs::create_dir_all(&dir).map_err(io)?;
        let tmp = dir.join(format!(".pending-{cid}-{}", std::process::id()));
        let result = (|| {
            let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(io)?;
            f.write_all(bytes).map_err(io)?;
            f.sync_all().map_err(io)?;
            fs::rename(&tmp, self.path(cid)).map_err(io)?;
            sync_dir(&dir)
        })();
        if result.is_err() { let _ = fs::remove_file(&tmp); }
        result
    }

    pub fn delete(&self, cid: &str) -> Result<(), Error> {
        digest_of(cid)?;
        match fs::remove_file(self.path(cid)) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(io(e)) }
    }
}
fn sync_dir(dir: &Path) -> Result<(), Error> { fs::File::open(dir).and_then(|d| d.sync_all()).map_err(io) }

#[cfg(test)]
mod tests {
    use super::*;
    // A fixed test block; sha256 and the CIDv1 raw sha2-256 computed independently (Python hashlib + base32).
    const CID: &str = "bafkreidxcwd2zia66ixdnbnozgbpz7raclqa4ui54lll2afcz43amiwp3q";
    const SHA: &str = "771587aca01ef22e3685aec982fcfe2012e00e511de2d6bd00a2cf360622cfdc";
    fn store() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("datacontrib-awai-fs-{}-{}", std::process::id(), rand_suffix()));
        (Store::new(&dir), dir)
    }
    fn rand_suffix() -> u128 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos() }
    fn block() -> Vec<u8> { b"awai data contribution test block\n".to_vec() }

    #[test]
    fn cid_names_the_recorded_sha256() {
        let d = digest_of(CID).unwrap();
        assert_eq!(d.iter().map(|b| format!("{b:02x}")).collect::<String>(), SHA);
        for bad in ["", "Bafk", "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG", &CID[..57], &format!("{}v", &CID[..57])] { assert_eq!(digest_of(bad), Err(Error::InvalidCid), "{bad}"); }
        // A dag-pb CIDv1 (codec 0x70) is not a raw block.
        assert_eq!(digest_of("bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"), Err(Error::InvalidCid));
    }
    #[test]
    fn put_then_get_round_trips_and_absent_is_none() {
        let (s, dir) = store();
        assert_eq!(s.get(CID).unwrap(), None);
        s.put(CID, &block()).unwrap();
        assert_eq!(s.get(CID).unwrap(), Some(block()));
        assert!(fs::read_dir(dir.join("blocks")).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with(".pending")));
        s.delete(CID).unwrap(); assert_eq!(s.get(CID).unwrap(), None);
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn put_refuses_bytes_that_do_not_hash_to_the_cid() {
        let (s, dir) = store();
        let mut b = block(); b[10] ^= 1;
        assert_eq!(s.put(CID, &b), Err(Error::Mismatch));
        assert!(!dir.join("blocks").join(CID).exists());
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn a_damaged_stored_block_is_deleted_not_returned() {
        let (s, dir) = store();
        s.put(CID, &block()).unwrap();
        let mut b = block(); b[0] ^= 1; fs::write(dir.join("blocks").join(CID), b).unwrap();
        assert_eq!(s.get(CID).unwrap(), None);
        assert!(!dir.join("blocks").join(CID).exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
