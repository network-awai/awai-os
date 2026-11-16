//! Opaque CAR/IPLD transfer adapter. WNFS tree/key semantics remain in CLJC.
use crate::{verify_block, MAX_BLOCK_BYTES};
use anyhow::{anyhow, ensure, Context, Result};
use cid::Cid;
use multihash_codetable::{Code, MultihashDigest};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

const MAX_CAR: u64 = 256 * 1024 * 1024;
const MAX_BLOCKS: usize = 10000;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub schema: String,
    pub roots: Vec<Cid>,
    pub blocks: Vec<Cid>,
}
#[derive(Serialize, Deserialize)]
struct Header {
    roots: Vec<Cid>,
    version: u64,
}

fn frame(reader: &mut impl Read, max: usize) -> Result<Option<Vec<u8>>> {
    let mut length = 0usize;
    for i in 0..10 {
        let mut b = [0];
        match reader.read_exact(&mut b) {
            Err(e) if i == 0 && e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
            other => other?,
        }
        ensure!(i < 5, "CAR frame length overflow");
        length |= usize::from(b[0] & 127) << (7 * i);
        if b[0] & 128 == 0 {
            ensure!(i == 0 || b[0] != 0, "noncanonical CAR length");
            ensure!(length > 0 && length <= max, "CAR frame exceeds limit");
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes)?;
            return Ok(Some(bytes));
        }
    }
    Err(anyhow!("invalid CAR frame"))
}
fn write_frame(writer: &mut impl Write, bytes: &[u8]) -> Result<()> {
    let mut buffer = unsigned_varint::encode::usize_buffer();
    writer.write_all(unsigned_varint::encode::usize(bytes.len(), &mut buffer))?;
    writer.write_all(bytes)?;
    Ok(())
}

pub struct DiskStore {
    root: PathBuf,
}
impl DiskStore {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root.join("blocks"))?;
        ensure!(
            fs::symlink_metadata(root)?.is_dir(),
            "store is not a directory"
        );
        Ok(Self {
            root: root.to_path_buf(),
        })
    }
    pub fn get(&self, cid: &Cid) -> Result<Vec<u8>> {
        let path = self.root.join("blocks").join(cid.to_string());
        ensure!(
            fs::symlink_metadata(&path)?.is_file(),
            "block is not a regular file"
        );
        let mut data = Vec::new();
        fs::File::open(path)?
            .take((MAX_BLOCK_BYTES + 1) as u64)
            .read_to_end(&mut data)?;
        verify_block(cid, &data)?;
        Ok(data)
    }
    pub fn put(&self, cid: &Cid, data: &[u8]) -> Result<()> {
        verify_block(cid, data)?;
        let path = self.root.join("blocks").join(cid.to_string());
        if path.exists() {
            ensure!(self.get(cid)? == data, "existing block differs");
            return Ok(());
        }
        let temp = self
            .root
            .join("blocks")
            .join(format!(".pending-{}", rand_id()));
        let mut opts = fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&temp)?;
        let result = (|| {
            file.write_all(data)?;
            file.sync_all()?;
            match fs::hard_link(&temp, &path) {
                Ok(()) => (),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    ensure!(self.get(cid)? == data, "existing block differs")
                }
                Err(e) => return Err(e.into()),
            }
            sync_dir(&self.root.join("blocks"))?;
            Ok(())
        })();
        let _ = fs::remove_file(temp);
        result
    }
    pub fn snapshot(&self, cid: &Cid) -> Result<Snapshot> {
        ensure!(cid.codec() == 0x71, "snapshot must be DAG-CBOR");
        let bytes = self.get(cid)?;
        let value: Snapshot = serde_ipld_dagcbor::from_slice(&bytes)?;
        ensure!(
            serde_ipld_dagcbor::to_vec(&value)? == bytes,
            "noncanonical snapshot"
        );
        ensure!(
            value.schema == "awai.wnfs.snapshot.v1",
            "unknown snapshot schema"
        );
        ensure!(
            !value.roots.is_empty() && value.roots.len() <= 4 && value.blocks.len() <= MAX_BLOCKS,
            "snapshot limits"
        );
        let sorted: std::collections::BTreeSet<_> =
            value.blocks.iter().map(ToString::to_string).collect();
        ensure!(
            sorted.len() == value.blocks.len(),
            "duplicate snapshot block"
        );
        ensure!(
            value.roots.iter().all(|c| value.blocks.contains(c)),
            "snapshot root absent"
        );
        Ok(value)
    }
    /// Caller supplies an already trusted WNFS root. No root/key discovery.
    pub fn import_car(&self, path: &Path, trusted_root: Cid) -> Result<Cid> {
        ensure!(fs::metadata(path)?.len() <= MAX_CAR, "CAR exceeds 256 MiB");
        let mut reader = fs::File::open(path)?;
        let header: Header = serde_ipld_dagcbor::from_slice(
            &frame(&mut reader, 4096)?.context("missing CAR header")?,
        )?;
        ensure!(
            header.version == 1 && header.roots == [trusted_root],
            "CAR trusted root mismatch"
        );
        let mut blocks = BTreeMap::new();
        let mut total = 0usize;
        while let Some(data) = frame(&mut reader, MAX_BLOCK_BYTES + 128)? {
            ensure!(blocks.len() < MAX_BLOCKS, "too many CAR blocks");
            let mut cursor = std::io::Cursor::new(&data);
            let cid = Cid::read_bytes(&mut cursor)?;
            let bytes = &data[cursor.position() as usize..];
            ensure!(
                blocks.insert(cid.to_string(), cid).is_none(),
                "duplicate CAR block"
            );
            total += bytes.len();
            ensure!(total <= MAX_CAR as usize, "CAR exceeds byte limit");
            self.put(&cid, bytes)?;
        }
        ensure!(
            blocks.contains_key(&trusted_root.to_string()),
            "CAR root block missing"
        );
        let snapshot = Snapshot {
            schema: "awai.wnfs.snapshot.v1".into(),
            roots: header.roots,
            blocks: blocks.into_values().collect(),
        };
        let bytes = serde_ipld_dagcbor::to_vec(&snapshot)?;
        // Large block lists must fail instead of manufacturing an unsupported CID.
        ensure!(
            bytes.len() <= MAX_BLOCK_BYTES,
            "snapshot block list too large"
        );
        let cid = Cid::new_v1(0x71, Code::Sha2_256.digest(&bytes));
        self.put(&cid, &bytes)?;
        Ok(cid)
    }
    pub fn export_car(&self, snapshot: &Cid, output: &Path) -> Result<()> {
        let value = self.snapshot(snapshot)?;
        // Verify the entire set before creating the output. Never clobber a file.
        for cid in &value.blocks {
            self.get(cid)?;
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output)?;
        write_frame(
            &mut file,
            &serde_ipld_dagcbor::to_vec(&Header {
                roots: value.roots,
                version: 1,
            })?,
        )?;
        for cid in value.blocks {
            let mut bytes = cid.to_bytes();
            bytes.extend(self.get(&cid)?);
            write_frame(&mut file, &bytes)?;
        }
        file.sync_all()?;
        Ok(())
    }
}
fn rand_id() -> String {
    libp2p::identity::Keypair::generate_ed25519()
        .public()
        .to_peer_id()
        .to_string()
}
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn opaque_car_roundtrip_and_refusals() -> Result<()> {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.agent-output")
            .join(format!("awai-snapshot-{}", rand_id()));
        fs::create_dir(&root)?;
        let store = DiskStore::open(&root.join("store"))?;
        let bytes = b"opaque WNFS ciphertext fixture";
        let cid = Cid::new_v1(0x55, Code::Blake3_256.digest(bytes));
        let input = root.join("input.car");
        let mut file = fs::File::create(&input)?;
        write_frame(
            &mut file,
            &serde_ipld_dagcbor::to_vec(&Header {
                roots: vec![cid],
                version: 1,
            })?,
        )?;
        let mut block = cid.to_bytes();
        block.extend(bytes);
        write_frame(&mut file, &block)?;
        drop(file);
        let snapshot = store.import_car(&input, cid)?;
        let output = root.join("output.car");
        store.export_car(&snapshot, &output)?;
        assert_eq!(fs::read(&input)?, fs::read(&output)?);
        assert!(store.export_car(&snapshot, &output).is_err());
        let wrong = Cid::new_v1(0x55, Code::Sha2_256.digest(b"wrong"));
        assert!(store.import_car(&input, wrong).is_err());
        fs::write(store.root.join("blocks").join(cid.to_string()), b"tampered")?;
        assert!(store.get(&cid).is_err());
        assert!(store.export_car(&snapshot, &root.join("bad.car")).is_err());
        assert!(!root.join("bad.car").exists());
        fs::remove_dir_all(root)?;
        Ok(())
    }
}
