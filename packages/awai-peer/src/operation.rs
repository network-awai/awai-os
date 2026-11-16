//! Native enforcement of the canonical bounded snapshot endpoint profile.
use anyhow::{ensure, Result};
use cid::Cid;
use libp2p::{Multiaddr, PeerId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Scope {
    pub snapshot_cid: String,
    pub max_transfer_bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_read_back: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listen_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receive_ms: Option<u64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Endpoint {
    pub transport: String,
    pub peer_id: String,
    pub addresses: Vec<String>,
    pub protocol: String,
    pub action: String,
    pub max_request_bytes: usize,
    pub max_response_bytes: usize,
    pub timeout_ms: u64,
    pub scope: Scope,
}
pub struct Checked {
    pub peer: PeerId,
    pub snapshot: Cid,
    pub address: Option<Multiaddr>,
    pub bind: Option<Multiaddr>,
}
impl Endpoint {
    pub fn checked(&self) -> Result<Checked> {
        ensure!(
            self.transport == "libp2p" && self.protocol == crate::provider::PROTOCOL,
            "undeclared transport/protocol"
        );
        ensure!(
            ["sync-push", "sync-pull", "pin-query", "receive-snapshot"]
                .contains(&self.action.as_str()),
            "unsupported scoped action"
        );
        ensure!(
            (1..=1048576).contains(&self.max_request_bytes)
                && (1..=1048576).contains(&self.max_response_bytes)
                && (1..=60000).contains(&self.timeout_ms),
            "operation budget out of range"
        );
        ensure!(
            (1..=268435456).contains(&self.scope.max_transfer_bytes),
            "transfer budget out of range"
        );
        ensure!(
            self.peer_id.len() <= 128 && self.scope.snapshot_cid.len() <= 128,
            "identifier length"
        );
        let peer: PeerId = self.peer_id.parse()?;
        let snapshot: Cid = self.scope.snapshot_cid.parse()?;
        ensure!(
            snapshot.version() == cid::Version::V1
                && snapshot.codec() == 0x71
                && matches!(snapshot.hash().code(), 0x12 | 0x1e)
                && snapshot.hash().digest().len() == 32,
            "unsupported snapshot CID"
        );
        let receive = self.action == "receive-snapshot";
        ensure!(
            self.addresses.len() <= 4 && (receive || !self.addresses.is_empty()),
            "declare bounded peer addresses"
        );
        let mut addresses = Vec::new();
        for text in &self.addresses {
            let address: Multiaddr = text.parse()?;
            ensure!(
                crate::nat::target(&address)?.0 == peer,
                "target PeerID mismatch"
            );
            ensure!(!addresses.contains(&address), "duplicate address");
            addresses.push(address);
        }
        let bind = if receive {
            ensure!(
                self.scope.allow_read_back.is_some(),
                "read-back choice required"
            );
            ensure!(
                self.scope
                    .receive_ms
                    .is_some_and(|ms| ms > 0 && ms <= 21600000),
                "receive duration out of range"
            );
            let text = self
                .scope
                .listen_address
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("listen address required"))?;
            ensure!(text.len() <= 512, "listener address length");
            let address: Multiaddr = text.parse()?;
            if crate::nat::relay_bind(&address)?.is_none() {
                crate::nat::literal_transport(&address, false)?;
            }
            Some(address)
        } else {
            ensure!(
                self.scope.receive_ms.is_none()
                    && self.scope.listen_address.is_none()
                    && self.scope.allow_read_back.is_none(),
                "unexpected receive scope"
            );
            None
        };
        // Multiple explicit addresses are an eligibility ceiling, not fallback.
        // This host selects only the first address; it never silently redials.
        Ok(Checked {
            peer,
            snapshot,
            address: addresses.into_iter().next(),
            bind,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use multihash_codetable::{Code, MultihashDigest};
    fn endpoint() -> Endpoint {
        let peer = PeerId::random();
        Endpoint {
            transport: "libp2p".into(),
            peer_id: peer.to_string(),
            addresses: vec![format!("/ip4/127.0.0.1/tcp/40213/p2p/{peer}")],
            protocol: crate::provider::PROTOCOL.into(),
            action: "sync-push".into(),
            max_request_bytes: 1024,
            max_response_bytes: 4096,
            timeout_ms: 30000,
            scope: Scope {
                snapshot_cid: Cid::new_v1(0x71, Code::Sha2_256.digest(b"fixture")).to_string(),
                max_transfer_bytes: 1048576,
                allow_read_back: None,
                listen_address: None,
                receive_ms: None,
            },
        }
    }
    #[test]
    fn scope_and_receive_are_independently_bounded() {
        let mut e = endpoint();
        assert!(e.checked().is_ok());
        e.peer_id = PeerId::random().to_string();
        assert!(e.checked().is_err());
        e = endpoint();
        e.action = "receive-snapshot".into();
        e.addresses.clear();
        assert!(e.checked().is_err());
        e.scope.listen_address = Some("/ip4/127.0.0.1/tcp/40213".into());
        e.scope.receive_ms = Some(600000);
        e.scope.allow_read_back = Some(false);
        assert!(e.checked().is_ok());
        e.scope.receive_ms = Some(21600001);
        assert!(e.checked().is_err());
        e.scope.receive_ms = Some(1);
        e.scope.listen_address = Some("/ip4/0.0.0.0/tcp/0".into());
        assert!(e.checked().is_err());
    }
}

pub type SnapshotCid = Cid;
