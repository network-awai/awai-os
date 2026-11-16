//! Separate Yataverse provider role; no app-origin API or ambient write access.
use crate::{snapshot::DiskStore, verify_block, MAX_BLOCK_BYTES};
use anyhow::{anyhow, ensure, Context, Result};
use cid::Cid;
use futures::StreamExt;
use libp2p::{
    identity,
    multiaddr::Protocol,
    request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    Multiaddr, PeerId, StreamProtocol, Swarm, SwarmBuilder,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::oneshot;

pub const PROTOCOL: &str = "/awai/yataverse/1.0.0";
const FRAME: u64 = MAX_BLOCK_BYTES as u64 + 4096;
pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Grant {
    pub peer_id: String,
    pub snapshot: String,
    pub max_bytes: usize,
    pub expires_at: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Request {
    Put {
        snapshot: String,
        cid: String,
        #[serde(with = "serde_bytes")]
        bytes: Vec<u8>,
    },
    Get {
        snapshot: String,
        cid: String,
    },
    Pin {
        snapshot: String,
    },
    Query {
        snapshot: String,
    },
}
impl Request {
    fn snapshot(&self) -> &str {
        match self {
            Self::Put { snapshot, .. }
            | Self::Get { snapshot, .. }
            | Self::Pin { snapshot }
            | Self::Query { snapshot } => snapshot,
        }
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReceiptBody {
    pub schema: String,
    pub provider: String,
    pub snapshot: String,
    pub blocks: usize,
    pub bytes: usize,
    pub observed_at: u64,
    pub retain_until: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
    #[serde(with = "serde_bytes")]
    pub signature: Vec<u8>,
    #[serde(with = "serde_bytes")]
    pub public_key: Vec<u8>,
}
impl Receipt {
    pub fn verify(&self, expected: PeerId, snapshot: &str) -> Result<ReceiptBody> {
        ensure!(
            self.body.len() <= 4096 && self.signature.len() <= 128 && self.public_key.len() <= 128,
            "receipt size limit"
        );
        let key = identity::PublicKey::try_decode_protobuf(&self.public_key)?;
        ensure!(
            key.to_peer_id() == expected && key.verify(&self.body, &self.signature),
            "receipt signer mismatch"
        );
        let body: ReceiptBody = serde_json::from_slice(&self.body)?;
        ensure!(
            body.schema == "yataverse.pin.receipt.v1"
                && body.provider == expected.to_string()
                && body.snapshot == snapshot,
            "receipt scope mismatch"
        );
        ensure!(
            body.observed_at <= now() + 30 && body.retain_until > now(),
            "receipt expired or future-dated"
        );
        Ok(body)
    }
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub ok: bool,
    #[serde(with = "serde_bytes")]
    pub bytes: Vec<u8>,
    pub receipt: Option<Receipt>,
    pub error: Option<String>,
}
impl Response {
    fn empty() -> Self {
        Self {
            ok: true,
            bytes: vec![],
            receipt: None,
            error: None,
        }
    }
    fn refused() -> Self {
        Self {
            ok: false,
            bytes: vec![],
            receipt: None,
            error: Some("scope-or-integrity-refused".into()),
        }
    }
}

#[derive(NetworkBehaviour)]
struct Wire {
    messages: request_response::cbor::Behaviour<Request, Response>,
    limits: libp2p::connection_limits::Behaviour,
}
fn swarm(key: identity::Keypair) -> Result<Swarm<Wire>> {
    Ok(SwarmBuilder::with_existing_identity(key)
        .with_tokio()
        .with_tcp(
            Default::default(),
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|_| Wire {
            messages: request_response::Behaviour::with_codec(
                request_response::cbor::codec::Codec::default()
                    .set_request_size_maximum(FRAME)
                    .set_response_size_maximum(FRAME),
                [(StreamProtocol::new(PROTOCOL), ProtocolSupport::Full)],
                request_response::Config::default()
                    .with_request_timeout(Duration::from_secs(15))
                    .with_max_concurrent_streams(4),
            ),
            limits: libp2p::connection_limits::Behaviour::new(
                libp2p::connection_limits::ConnectionLimits::default()
                    .with_max_established(Some(8))
                    .with_max_pending_incoming(Some(4))
                    .with_max_pending_outgoing(Some(4))
                    .with_max_established_per_peer(Some(2)),
            ),
        })?
        .with_swarm_config(|c| {
            c.with_idle_connection_timeout(Duration::from_secs(60))
                .with_max_negotiating_inbound_streams(4)
        })
        .build())
}

pub struct Provider {
    store: DiskStore,
    key: identity::Keypair,
    grants: Vec<Grant>,
    consumed: HashMap<(String, String), usize>,
}
impl Provider {
    pub fn new(root: PathBuf, key: identity::Keypair, grants: Vec<Grant>) -> Result<Self> {
        ensure!(
            !grants.is_empty() && grants.len() <= 16,
            "declare 1..16 provider grants"
        );
        for grant in &grants {
            grant.peer_id.parse::<PeerId>()?;
            grant.snapshot.parse::<Cid>()?;
            ensure!(
                (1..=256 * 1024 * 1024).contains(&grant.max_bytes)
                    && grant.expires_at > now()
                    && grant.expires_at <= now() + 21600,
                "grant byte/time limit"
            );
        }
        Ok(Self {
            store: DiskStore::open(&root)?,
            key,
            grants,
            consumed: HashMap::new(),
        })
    }
    fn handle(&mut self, peer: PeerId, request: Request) -> Result<Response> {
        let snapshot = request.snapshot();
        ensure!(snapshot.len() <= 128, "snapshot length");
        let grant = self
            .grants
            .iter()
            .find(|g| {
                g.peer_id == peer.to_string() && g.snapshot == snapshot && g.expires_at > now()
            })
            .context("provider grant absent")?
            .clone();
        let snapshot_cid: Cid = snapshot.parse()?;
        match request {
            Request::Put {
                snapshot,
                cid,
                bytes,
            } => {
                ensure!(cid.len() <= 128, "CID length");
                let cid: Cid = cid.parse()?;
                verify_block(&cid, &bytes)?;
                if cid != snapshot_cid {
                    ensure!(
                        self.store.snapshot(&snapshot_cid)?.blocks.contains(&cid),
                        "block outside snapshot"
                    );
                }
                let used = self
                    .consumed
                    .entry((peer.to_string(), snapshot))
                    .or_default();
                ensure!(
                    bytes.len() <= grant.max_bytes.saturating_sub(*used),
                    "provider byte budget exhausted"
                );
                self.store.put(&cid, &bytes)?;
                *used += bytes.len();
                if cid == snapshot_cid {
                    self.store.snapshot(&cid)?;
                }
                Ok(Response::empty())
            }
            Request::Get { cid, .. } => {
                ensure!(cid.len() <= 128, "CID length");
                let cid: Cid = cid.parse()?;
                ensure!(
                    cid == snapshot_cid
                        || self.store.snapshot(&snapshot_cid)?.blocks.contains(&cid),
                    "block outside snapshot"
                );
                let bytes = self.store.get(&cid)?;
                let used = self
                    .consumed
                    .entry((peer.to_string(), grant.snapshot.clone()))
                    .or_default();
                ensure!(
                    bytes.len() <= grant.max_bytes.saturating_sub(*used),
                    "provider byte budget exhausted"
                );
                *used += bytes.len();
                Ok(Response {
                    bytes,
                    ..Response::empty()
                })
            }
            Request::Pin { .. } | Request::Query { .. } => {
                let value = self.store.snapshot(&snapshot_cid)?;
                let mut total = 0;
                for cid in &value.blocks {
                    total += self.store.get(cid)?.len();
                    ensure!(total <= grant.max_bytes, "pin byte budget");
                }
                let body = serde_json::to_vec(&ReceiptBody {
                    schema: "yataverse.pin.receipt.v1".into(),
                    provider: self.key.public().to_peer_id().to_string(),
                    snapshot: grant.snapshot,
                    blocks: value.blocks.len(),
                    bytes: total,
                    observed_at: now(),
                    retain_until: grant.expires_at,
                })?;
                let receipt = Receipt {
                    signature: self.key.sign(&body)?,
                    body,
                    public_key: self.key.public().encode_protobuf(),
                };
                // A receipt proves this provider's verified custody at observation time.
                // Signed retention is a bounded provider promise, not independent durability.
                Ok(Response {
                    receipt: Some(receipt),
                    ..Response::empty()
                })
            }
        }
    }
    pub async fn run(
        mut self,
        bind: Multiaddr,
        ready: oneshot::Sender<Multiaddr>,
        stop: oneshot::Receiver<()>,
    ) -> Result<()> {
        ensure!(
            matches!(
                bind.iter().collect::<Vec<_>>().as_slice(),
                [Protocol::Ip4(_), Protocol::Tcp(_)]
                    | [Protocol::Ip4(_), Protocol::Udp(_), Protocol::QuicV1]
            ),
            "literal TCP/QUIC bind required"
        );
        let mut node = swarm(self.key.clone())?;
        let id = *node.local_peer_id();
        node.listen_on(bind)?;
        let mut ready = Some(ready);
        tokio::pin!(stop);
        let expiry = self.grants.iter().map(|g| g.expires_at).max().unwrap();
        let deadline = tokio::time::sleep(Duration::from_secs(expiry.saturating_sub(now())));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _=&mut stop=>return Ok(()), _=&mut deadline=>return Ok(()),
                event=node.select_next_some()=>match event {
                    SwarmEvent::NewListenAddr{address,..}=>if let Some(tx)=ready.take(){let _=tx.send(address.with(Protocol::P2p(id)));},
                    SwarmEvent::Behaviour(WireEvent::Messages(request_response::Event::Message{peer,message:request_response::Message::Request{request,channel,..},..}))=>{
                        let result=self.handle(peer,request).unwrap_or_else(|_|Response::refused());
                        let _=node.behaviour_mut().messages.send_response(channel,result);
                    },
                    _=>(),
                }
            }
        }
    }
}

/// One exact authenticated peer and one bounded request; no discovery/fallback.
pub async fn exchange(
    key: identity::Keypair,
    address: Multiaddr,
    request: Request,
) -> Result<Response> {
    let parts: Vec<_> = address.iter().collect();
    let peer = match parts.as_slice() {
        [Protocol::Ip4(ip), Protocol::Tcp(port), Protocol::P2p(id)]
        | [Protocol::Ip4(ip), Protocol::Udp(port), Protocol::QuicV1, Protocol::P2p(id)] => {
            ensure!(
                !ip.is_unspecified() && !ip.is_multicast() && !ip.is_broadcast() && *port != 0,
                "invalid destination"
            );
            *id
        }
        _ => return Err(anyhow!("explicit literal TCP/QUIC PeerID required")),
    };
    ensure!(request.snapshot().len() <= 128, "snapshot length");
    let mut node = swarm(key)?;
    node.dial(
        libp2p::swarm::dial_opts::DialOpts::peer_id(peer)
            .addresses(vec![address])
            .build(),
    )?;
    tokio::time::timeout(Duration::from_secs(20), async {
        let mut pending = Some(request);
        let mut query = None;
        loop {
            match node.select_next_some().await {
                SwarmEvent::ConnectionEstablished { peer_id, .. } => {
                    ensure!(peer_id == peer, "authenticated peer mismatch");
                    if let Some(request) = pending.take() {
                        query = Some(node.behaviour_mut().messages.send_request(&peer, request));
                    }
                }
                SwarmEvent::Behaviour(WireEvent::Messages(request_response::Event::Message {
                    peer: remote,
                    message:
                        request_response::Message::Response {
                            request_id,
                            response,
                        },
                    ..
                })) if Some(request_id) == query => {
                    ensure!(remote == peer, "response peer mismatch");
                    return Ok(response);
                }
                SwarmEvent::Behaviour(WireEvent::Messages(
                    request_response::Event::OutboundFailure { error, .. },
                )) => return Err(anyhow!("provider request failed: {error}")),
                SwarmEvent::OutgoingConnectionError { error, .. } => return Err(error.into()),
                _ => (),
            }
        }
    })
    .await
    .context("provider deadline exceeded")?
}

pub async fn push_snapshot(
    key: identity::Keypair,
    store: &DiskStore,
    address: Multiaddr,
    snapshot: Cid,
) -> Result<Receipt> {
    let value = store.snapshot(&snapshot)?;
    let peer = address
        .iter()
        .last()
        .and_then(|p| {
            if let Protocol::P2p(id) = p {
                Some(id)
            } else {
                None
            }
        })
        .context("PeerID required")?;
    for cid in std::iter::once(snapshot).chain(value.blocks) {
        let response = exchange(
            key.clone(),
            address.clone(),
            Request::Put {
                snapshot: snapshot.to_string(),
                cid: cid.to_string(),
                bytes: store.get(&cid)?,
            },
        )
        .await?;
        ensure!(response.ok, "provider refused snapshot block");
    }
    let response = exchange(
        key,
        address,
        Request::Pin {
            snapshot: snapshot.to_string(),
        },
    )
    .await?;
    ensure!(response.ok, "provider refused pin");
    let receipt = response.receipt.context("missing pin receipt")?;
    receipt.verify(peer, &snapshot.to_string())?;
    Ok(receipt)
}
pub async fn pull_snapshot(
    key: identity::Keypair,
    store: &DiskStore,
    address: Multiaddr,
    snapshot: Cid,
) -> Result<()> {
    let response = exchange(
        key.clone(),
        address.clone(),
        Request::Get {
            snapshot: snapshot.to_string(),
            cid: snapshot.to_string(),
        },
    )
    .await?;
    ensure!(response.ok, "provider refused snapshot");
    store.put(&snapshot, &response.bytes)?;
    let value = store.snapshot(&snapshot)?;
    let mut total = response.bytes.len();
    for cid in value.blocks {
        if store.get(&cid).is_ok() {
            continue;
        }
        let response = exchange(
            key.clone(),
            address.clone(),
            Request::Get {
                snapshot: snapshot.to_string(),
                cid: cid.to_string(),
            },
        )
        .await?;
        ensure!(response.ok, "provider refused block");
        total += response.bytes.len();
        ensure!(total <= 256 * 1024 * 1024, "transfer exceeds limit");
        store.put(&cid, &response.bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use multihash_codetable::{Code, MultihashDigest};
    #[tokio::test]
    async fn real_pin_query_sync_refuses_other_peer_and_tampering() -> Result<()> {
        let sender = identity::Keypair::generate_ed25519();
        let server = identity::Keypair::generate_ed25519();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.agent-output")
            .join(format!("provider-{}", server.public().to_peer_id()));
        std::fs::create_dir_all(&root)?;
        let source = DiskStore::open(&root.join("source"))?;
        let data = b"WNFS opaque ciphertext over authenticated libp2p";
        let block = Cid::new_v1(0x55, Code::Blake3_256.digest(data));
        source.put(&block, data)?;
        let value = crate::snapshot::Snapshot {
            schema: "awai.wnfs.snapshot.v1".into(),
            roots: vec![block],
            blocks: vec![block],
        };
        let bytes = serde_ipld_dagcbor::to_vec(&value)?;
        let snapshot = Cid::new_v1(0x71, Code::Sha2_256.digest(&bytes));
        source.put(&snapshot, &bytes)?;
        let provider = Provider::new(
            root.join("provider"),
            server.clone(),
            vec![Grant {
                peer_id: sender.public().to_peer_id().to_string(),
                snapshot: snapshot.to_string(),
                max_bytes: 100000,
                expires_at: now() + 60,
            }],
        )?;
        let (tx, rx) = oneshot::channel();
        let (stop, stopped) = oneshot::channel();
        let task = tokio::spawn(provider.run("/ip4/127.0.0.1/tcp/0".parse()?, tx, stopped));
        let address = rx.await?;
        let before = exchange(
            identity::Keypair::generate_ed25519(),
            address.clone(),
            Request::Put {
                snapshot: snapshot.to_string(),
                cid: snapshot.to_string(),
                bytes: bytes.clone(),
            },
        )
        .await?;
        assert!(!before.ok);
        assert!(!root
            .join("provider/blocks")
            .join(snapshot.to_string())
            .exists());
        let receipt = push_snapshot(sender.clone(), &source, address.clone(), snapshot).await?;
        let signed = receipt.verify(server.public().to_peer_id(), &snapshot.to_string())?;
        assert_eq!(signed.blocks, 1);
        assert_eq!(signed.bytes, data.len());
        let query = exchange(
            sender.clone(),
            address.clone(),
            Request::Query {
                snapshot: snapshot.to_string(),
            },
        )
        .await?;
        assert!(query.ok);
        query
            .receipt
            .context("query receipt")?
            .verify(server.public().to_peer_id(), &snapshot.to_string())?;
        let destination = DiskStore::open(&root.join("destination"))?;
        pull_snapshot(sender.clone(), &destination, address.clone(), snapshot).await?;
        assert_eq!(destination.get(&block)?, data);
        std::fs::write(
            root.join("provider/blocks").join(block.to_string()),
            b"corrupt",
        )?;
        let query = exchange(
            sender,
            address,
            Request::Query {
                snapshot: snapshot.to_string(),
            },
        )
        .await?;
        assert!(!query.ok);
        let _ = stop.send(());
        task.await??;
        std::fs::remove_dir_all(root)?;
        Ok(())
    }
}
