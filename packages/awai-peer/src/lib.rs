//! Public-only, explicit-peer libp2p transport. No DNS, HTTP, public discovery,
//! private-key export, app authority verdicts or silent alternate transports.
use anyhow::{anyhow, bail, ensure, Context, Result};
use blockstore::Blockstore;
use cid::{Cid, CidGeneric};
use futures::StreamExt;
use libp2p::{
    connection_limits, identify, identity,
    multiaddr::Protocol,
    ping,
    swarm::{NetworkBehaviour, SwarmEvent},
    Multiaddr, PeerId, Swarm, SwarmBuilder,
};
use multihash_codetable::{Code, MultihashDigest};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

pub const MAX_BLOCK_BYTES: usize = 262144;
pub const BITSWAP: &str = "/ipfs/bitswap/1.2.0";
pub const PING: &str = "/ipfs/ping/1.0.0";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PeerEndpoint {
    pub transport: String,
    #[serde(rename = "peer-id")]
    pub peer_id: String,
    pub addresses: Vec<String>,
    pub protocol: String,
    pub action: String,
    #[serde(rename = "max-request-bytes")]
    pub max_request_bytes: usize,
    #[serde(rename = "max-response-bytes")]
    pub max_response_bytes: usize,
    #[serde(rename = "timeout-ms")]
    pub timeout_ms: u64,
}

impl PeerEndpoint {
    pub fn checked(&self) -> Result<(PeerId, Vec<Multiaddr>)> {
        ensure!(
            self.transport == "libp2p",
            "only libp2p transport is supported"
        );
        ensure!(
            (1..=4).contains(&self.addresses.len()),
            "declare 1–4 peer addresses"
        );
        ensure!(
            (1..=65536).contains(&self.max_request_bytes),
            "request budget out of range"
        );
        ensure!(
            (1..=1048576).contains(&self.max_response_bytes),
            "response budget out of range"
        );
        ensure!(
            (1..=60000).contains(&self.timeout_ms),
            "deadline out of range"
        );
        ensure!(
            (self.action == "connect" && self.protocol == PING)
                || (self.action == "get-block" && self.protocol == BITSWAP),
            "undeclared native protocol/action"
        );
        let peer: PeerId = self.peer_id.parse().context("invalid PeerID")?;
        let mut addresses = Vec::new();
        for text in &self.addresses {
            ensure!(text.len() <= 512, "peer address too long");
            let address: Multiaddr = text.parse().context("invalid multiaddr")?;
            let parts: Vec<_> = address.iter().collect();
            match parts.as_slice() {
                [Protocol::Ip4(ip), Protocol::Udp(port), Protocol::QuicV1, Protocol::P2p(id)]
                | [Protocol::Ip4(ip), Protocol::Tcp(port), Protocol::P2p(id)] => {
                    ensure!(
                        !ip.is_unspecified()
                            && !ip.is_multicast()
                            && !ip.is_broadcast()
                            && *port != 0,
                        "invalid literal-IP destination"
                    );
                    ensure!(*id == peer, "multiaddr PeerID differs from declared PeerID");
                }
                _ => bail!(
                    "only literal IPv4 QUIC or TCP/Noise/Yamux PeerID addresses are supported"
                ),
            }
            ensure!(!addresses.contains(&address), "duplicate peer address");
            addresses.push(address);
        }
        Ok((peer, addresses))
    }
}

pub fn verify_block<const S: usize>(cid: &CidGeneric<S>, data: &[u8]) -> Result<()> {
    ensure!(
        data.len() <= MAX_BLOCK_BYTES,
        "block exceeds 256 KiB native limit"
    );
    ensure!(
        [0x55, 0x70, 0x71].contains(&cid.codec()),
        "unsupported block codec"
    );
    ensure!(
        matches!(cid.hash().code(), 0x12 | 0x1e) && cid.hash().digest().len() == 32,
        "only SHA2-256/BLAKE3-256 CIDs supported"
    );
    ensure!(
        match cid.hash().code() {
            0x12 => Code::Sha2_256.digest(data),
            0x1e => Code::Blake3_256.digest(data),
            _ => unreachable!(),
        }
        .digest()
            == cid.hash().digest(),
        "block CID digest mismatch"
    );
    Ok(())
}

pub fn raw_cid(bytes: &[u8]) -> Result<Cid> {
    ensure!(
        bytes.len() <= MAX_BLOCK_BYTES,
        "block exceeds 256 KiB native limit"
    );
    Ok(Cid::new_v1(0x55, Code::Sha2_256.digest(bytes)))
}

// A request's store is isolated from every other peer. Only explicitly provided
// public blocks can be served; fetching never persists unknown peer bytes.
pub struct PublicStore {
    data: Mutex<HashMap<String, Vec<u8>>>,
    budget: Mutex<usize>,
    read_only: bool,
}
impl PublicStore {
    pub fn empty() -> Self {
        Self {
            data: Mutex::new(HashMap::new()),
            budget: Mutex::new(16 * 1024 * 1024),
            read_only: false,
        }
    }
    pub fn with_block(cid: Cid, bytes: Vec<u8>) -> Result<Self> {
        verify_block(&cid, &bytes)?;
        Ok(Self {
            data: Mutex::new(HashMap::from([(cid.to_string(), bytes)])),
            budget: Mutex::new(16 * 1024 * 1024),
            read_only: true,
        })
    }
}
impl Blockstore for PublicStore {
    async fn get<const S: usize>(
        &self,
        cid: &CidGeneric<S>,
    ) -> blockstore::Result<Option<Vec<u8>>> {
        let data = self
            .data
            .lock()
            .map_err(|_| blockstore::Error::StoredDataError("lock unavailable".into()))?;
        match data.get(&cid.to_string()) {
            None => Ok(None),
            Some(bytes) => {
                let mut budget = self
                    .budget
                    .lock()
                    .map_err(|_| blockstore::Error::StoredDataError("lock unavailable".into()))?;
                if *budget < bytes.len() {
                    return Err(blockstore::Error::ValueTooLarge);
                }
                *budget -= bytes.len();
                Ok(Some(bytes.clone()))
            }
        }
    }
    async fn put_keyed<const S: usize>(
        &self,
        cid: &CidGeneric<S>,
        bytes: &[u8],
    ) -> blockstore::Result<()> {
        if self.read_only {
            return Err(blockstore::Error::StoredDataError(
                "provider public set is immutable".into(),
            ));
        }
        verify_block(cid, bytes).map_err(|e| blockstore::Error::StoredDataError(e.to_string()))?;
        let mut data = self
            .data
            .lock()
            .map_err(|_| blockstore::Error::StoredDataError("lock unavailable".into()))?;
        if !data.contains_key(&cid.to_string()) && data.len() >= 4 {
            return Err(blockstore::Error::ValueTooLarge);
        }
        data.insert(cid.to_string(), bytes.to_vec());
        Ok(())
    }
    async fn remove<const S: usize>(&self, cid: &CidGeneric<S>) -> blockstore::Result<()> {
        self.data
            .lock()
            .map_err(|_| blockstore::Error::StoredDataError("lock unavailable".into()))?
            .remove(&cid.to_string());
        Ok(())
    }
    async fn close(self) -> blockstore::Result<()> {
        Ok(())
    }
}

#[derive(NetworkBehaviour)]
pub struct Behaviour {
    bitswap: beetswap::Behaviour<64, PublicStore>,
    ping: ping::Behaviour,
    identify: identify::Behaviour,
    limits: connection_limits::Behaviour,
}

pub fn swarm(key: identity::Keypair, store: Arc<PublicStore>) -> Result<Swarm<Behaviour>> {
    let builder = SwarmBuilder::with_existing_identity(key)
        .with_tokio()
        .with_tcp(
            libp2p::tcp::Config::default(),
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )?
        .with_quic();
    Ok(builder
        .with_behaviour(|key| Behaviour {
            bitswap: beetswap::Behaviour::new(store),
            ping: ping::Behaviour::new(
                ping::Config::new()
                    .with_interval(Duration::from_secs(5))
                    .with_timeout(Duration::from_secs(10)),
            ),
            identify: identify::Behaviour::new(
                identify::Config::new("/awai/public-peer/1.0.0".into(), key.public())
                    .with_push_listen_addr_updates(false),
            ),
            limits: connection_limits::Behaviour::new(
                connection_limits::ConnectionLimits::default()
                    .with_max_pending_incoming(Some(4))
                    .with_max_pending_outgoing(Some(4))
                    .with_max_established(Some(4))
                    .with_max_established_per_peer(Some(1)),
            ),
        })?
        .with_swarm_config(|c| {
            c.with_idle_connection_timeout(Duration::from_secs(30))
                .with_max_negotiating_inbound_streams(4)
        })
        .build())
}

pub fn load_identity(dir: &Path) -> Result<identity::Keypair> {
    fs::create_dir_all(dir)?;
    let path = dir.join("peer-identity-v1.key");
    if path.exists() {
        ensure!(
            fs::symlink_metadata(&path)?.file_type().is_file(),
            "identity must be a regular file"
        );
        ensure!(
            fs::metadata(&path)?.len() <= 8192,
            "invalid identity length"
        );
        return identity::Keypair::from_protobuf_encoding(&fs::read(path)?).map_err(Into::into);
    }
    let key = identity::Keypair::generate_ed25519();
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path)?;
    file.write_all(&key.to_protobuf_encoding()?)?;
    file.sync_all()?;
    #[cfg(unix)]
    fs::File::open(dir)?.sync_all()?;
    Ok(key)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PeerResult {
    pub peer_id: String,
    pub protocol: String,
    pub authenticated: bool,
    pub cid: Option<String>,
    pub bytes: usize,
    pub data_base64: Option<String>,
}

pub async fn execute(
    key: identity::Keypair,
    endpoint: PeerEndpoint,
    payload: serde_json::Value,
) -> Result<PeerResult> {
    let (peer, addresses) = endpoint.checked()?;
    ensure!(
        serde_json::to_vec(&payload)?.len() <= endpoint.max_request_bytes,
        "request exceeds budget"
    );
    let object = payload
        .as_object()
        .ok_or_else(|| anyhow!("request must be an object"))?;
    let requested = if endpoint.action == "get-block" {
        ensure!(object.len() == 1, "get-block accepts only cid");
        let text = object
            .get("cid")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("cid required"))?;
        ensure!(text.len() <= 128, "CID too long");
        let cid: Cid = text.parse().context("invalid CID")?;
        ensure!(
            [0x55, 0x70, 0x71].contains(&cid.codec()) && matches!(cid.hash().code(), 0x12 | 0x1e),
            "unsupported CID codec/hash"
        );
        Some(cid)
    } else {
        ensure!(object.is_empty(), "connect accepts no request fields");
        None
    };
    let work = async {
        let mut node = swarm(key, Arc::new(PublicStore::empty()))?;
        // Exactly one pinned destination; no DHT, DNS, HTTP, mDNS, relay or
        // learned address is automatically dialed under this approval.
        node.dial(
            libp2p::swarm::dial_opts::DialOpts::peer_id(peer)
                .addresses(addresses)
                .build(),
        )?;
        let mut query = None;
        loop {
            match node.select_next_some().await {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    ensure!(
                        peer_id == peer,
                        "authenticated peer differs from approved peer"
                    );
                    if let Some(cid) = requested {
                        query = Some(node.behaviour_mut().bitswap.get(&cid));
                    }
                }
                SwarmEvent::Behaviour(BehaviourEvent::Ping(ping::Event {
                    peer: remote,
                    result: Ok(_),
                    ..
                })) if requested.is_none() => {
                    ensure!(remote == peer, "ping peer mismatch");
                    return Ok(PeerResult {
                        peer_id: peer.to_string(),
                        protocol: PING.into(),
                        authenticated: true,
                        cid: None,
                        bytes: 0,
                        data_base64: None,
                    });
                }
                SwarmEvent::Behaviour(BehaviourEvent::Bitswap(
                    beetswap::Event::GetQueryResponse { query_id, data },
                )) if Some(query_id) == query => {
                    let cid = requested.ok_or_else(|| anyhow!("unexpected block"))?;
                    verify_block(&cid, &data)?;
                    use base64::Engine;
                    let result = PeerResult {
                        peer_id: peer.to_string(),
                        protocol: BITSWAP.into(),
                        authenticated: true,
                        cid: Some(cid.to_string()),
                        bytes: data.len(),
                        data_base64: Some(base64::engine::general_purpose::STANDARD.encode(&data)),
                    };
                    ensure!(
                        serde_json::to_vec(&result)?.len() <= endpoint.max_response_bytes,
                        "response exceeds declared budget"
                    );
                    return Ok(result);
                }
                SwarmEvent::Behaviour(BehaviourEvent::Bitswap(
                    beetswap::Event::GetQueryError { query_id, error },
                )) if Some(query_id) == query => bail!("Bitswap retrieval failed: {error}"),
                SwarmEvent::OutgoingConnectionError { error, .. } => {
                    bail!("peer dial refused: {error}")
                }
                SwarmEvent::ConnectionClosed { peer_id, .. } if peer_id == peer => {
                    bail!("approved peer disconnected")
                }
                _ => {}
            }
        }
    };
    tokio::time::timeout(Duration::from_millis(endpoint.timeout_ms), work)
        .await
        .context("peer operation deadline exceeded")?
}

/// A separate provider role: serves only one explicitly selected public block,
/// for a bounded lease and connection/read budget. No private tree is opened.
pub async fn serve_public(
    key: identity::Keypair,
    bind: Multiaddr,
    bytes: Vec<u8>,
    duration: Duration,
) -> Result<()> {
    ensure!(
        duration <= Duration::from_secs(300),
        "provider lease exceeds five minutes"
    );
    let cid = raw_cid(&bytes)?;
    let mut node = swarm(key, Arc::new(PublicStore::with_block(cid, bytes)?))?;
    let peer = *node.local_peer_id();
    node.listen_on(bind)?;
    let deadline = tokio::time::sleep(duration);
    tokio::pin!(deadline);
    loop {
        tokio::select! {
            _=&mut deadline=>return Ok(()),
            event=node.select_next_some()=>if let SwarmEvent::NewListenAddr {address,..}=event {
                println!("{}",serde_json::json!({"peerId":peer.to_string(),"address":address.with(Protocol::P2p(peer)).to_string(),"cid":cid.to_string(),"public":true}));
                std::io::stdout().flush()?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn endpoint(peer: PeerId, port: u16) -> PeerEndpoint {
        PeerEndpoint {
            transport: "libp2p".into(),
            peer_id: peer.to_string(),
            addresses: vec![format!("/ip4/127.0.0.1/udp/{port}/quic-v1/p2p/{peer}")],
            protocol: BITSWAP.into(),
            action: "get-block".into(),
            max_request_bytes: 1024,
            max_response_bytes: 1048576,
            timeout_ms: 5000,
        }
    }
    #[test]
    fn peer_scope_refuses_dns_mismatched_identity_and_unbounded_request() {
        let peer = identity::Keypair::generate_ed25519().public().to_peer_id();
        let mut e = endpoint(peer, 12345);
        assert!(e.checked().is_ok());
        e.addresses[0] = format!("/dns4/example.test/udp/12345/quic-v1/p2p/{peer}");
        assert!(e.checked().is_err());
        e = endpoint(peer, 0);
        assert!(e.checked().is_err());
        e = endpoint(peer, 12345);
        e.timeout_ms = 60001;
        assert!(e.checked().is_err());
        e = endpoint(peer, 12345);
        e.peer_id = identity::Keypair::generate_ed25519()
            .public()
            .to_peer_id()
            .to_string();
        assert!(e.checked().is_err());
    }
    #[test]
    fn corrupt_or_oversized_blocks_are_never_accepted() {
        let cid = raw_cid(b"hello").unwrap();
        assert!(verify_block(&cid, b"hello").is_ok());
        assert!(verify_block(&cid, b"corrupt").is_err());
        assert!(raw_cid(&vec![0; MAX_BLOCK_BYTES + 1]).is_err());
    }
    #[tokio::test]
    async fn real_quic_identity_and_bitswap_roundtrip() -> Result<()> {
        let bytes = b"public CID fixture over UDP/QUIC, no HTTP or DNS".to_vec();
        let cid = raw_cid(&bytes)?;
        let mut provider = swarm(
            identity::Keypair::generate_ed25519(),
            Arc::new(PublicStore::with_block(cid, bytes.clone())?),
        )?;
        let peer = *provider.local_peer_id();
        provider.listen_on("/ip4/127.0.0.1/udp/0/quic-v1".parse()?)?;
        let address = loop {
            if let SwarmEvent::NewListenAddr { address, .. } = provider.select_next_some().await {
                break address;
            }
        };
        let port = address
            .iter()
            .find_map(|p| {
                if let Protocol::Udp(port) = p {
                    Some(port)
                } else {
                    None
                }
            })
            .unwrap();
        let task = tokio::spawn(async move { while provider.next().await.is_some() {} });
        let received = execute(
            identity::Keypair::generate_ed25519(),
            endpoint(peer, port),
            serde_json::json!({"cid":cid.to_string()}),
        )
        .await?;
        use base64::Engine;
        assert_eq!(
            base64::engine::general_purpose::STANDARD.decode(received.data_base64.unwrap())?,
            bytes
        );
        assert!(received.authenticated);
        let mut ping = endpoint(peer, port);
        ping.action = "connect".into();
        ping.protocol = PING.into();
        assert!(
            execute(
                identity::Keypair::generate_ed25519(),
                ping,
                serde_json::json!({})
            )
            .await?
            .authenticated
        );
        let mut wrong = endpoint(peer, port);
        let other = identity::Keypair::generate_ed25519().public().to_peer_id();
        wrong.peer_id = other.to_string();
        wrong.addresses[0] = format!("/ip4/127.0.0.1/udp/{port}/quic-v1/p2p/{other}");
        assert!(execute(
            identity::Keypair::generate_ed25519(),
            wrong,
            serde_json::json!({"cid":cid.to_string()})
        )
        .await
        .is_err());
        task.abort();
        Ok(())
    }
}

pub mod provider;
pub mod snapshot;

pub mod nat;
