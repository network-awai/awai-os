//! Explicit Circuit Relay v2 profile. Never discovers or selects a public relay.
use anyhow::{bail, ensure, Result};
use futures::StreamExt;
use libp2p::{
    identity,
    multiaddr::Protocol,
    swarm::{NetworkBehaviour, SwarmEvent},
    Multiaddr, PeerId, SwarmBuilder,
};
use std::time::Duration;
use tokio::sync::oneshot;

pub fn literal_transport(address: &Multiaddr, bind: bool) -> Result<()> {
    match address.iter().collect::<Vec<_>>().as_slice() {
        [Protocol::Ip4(ip), Protocol::Tcp(port)]
        | [Protocol::Ip4(ip), Protocol::Udp(port), Protocol::QuicV1] => ensure!(
            !ip.is_multicast()
                && !ip.is_broadcast()
                && (bind || (!ip.is_unspecified() && *port != 0)),
            "invalid literal transport"
        ),
        _ => bail!("literal IPv4 TCP/QUIC required; DNS/gateways are not admitted"),
    }
    Ok(())
}
pub fn relay_bind(address: &Multiaddr) -> Result<Option<(PeerId, Multiaddr)>> {
    if matches!(address.iter().last(), Some(Protocol::P2pCircuit)) {
        let mut base = address.clone();
        base.pop();
        let relay = match base.pop() {
            Some(Protocol::P2p(id)) => id,
            _ => bail!("relay PeerID required"),
        };
        literal_transport(&base, false)?;
        Ok(Some((relay, base.with(Protocol::P2p(relay)))))
    } else {
        literal_transport(address, true)?;
        Ok(None)
    }
}
pub fn target(address: &Multiaddr) -> Result<(PeerId, Option<(PeerId, Multiaddr)>)> {
    ensure!(address.to_string().len() <= 512, "peer address too long");
    let mut base = address.clone();
    let peer = match base.pop() {
        Some(Protocol::P2p(id)) => id,
        _ => bail!("target PeerID required"),
    };
    if matches!(base.iter().last(), Some(Protocol::P2pCircuit)) {
        let relay = relay_bind(&base)?.expect("circuit profile");
        ensure!(relay.0 != peer, "relay and target must differ");
        Ok((peer, Some(relay)))
    } else {
        literal_transport(&base, false)?;
        Ok((peer, None))
    }
}

#[derive(NetworkBehaviour)]
struct Relay {
    relay: libp2p::relay::Behaviour,
    identify: libp2p::identify::Behaviour,
    autonat: libp2p::autonat::Behaviour,
    allow: libp2p::allow_block_list::Behaviour<libp2p::allow_block_list::AllowedPeers>,
    limits: libp2p::connection_limits::Behaviour,
}
pub async fn run_relay(
    key: identity::Keypair,
    bind: Multiaddr,
    allowed: Vec<PeerId>,
    duration: Duration,
    ready: oneshot::Sender<Multiaddr>,
    stop: oneshot::Receiver<()>,
) -> Result<()> {
    literal_transport(&bind, true)?;
    ensure!(
        !allowed.is_empty() && allowed.len() <= 16,
        "declare relay participants"
    );
    ensure!(
        duration.as_secs() > 0 && duration.as_secs() <= 21600,
        "relay duration limit"
    );
    let mut node = SwarmBuilder::with_existing_identity(key)
        .with_tokio()
        .with_tcp(
            Default::default(),
            libp2p::noise::Config::new,
            libp2p::yamux::Config::default,
        )?
        .with_quic()
        .with_behaviour(|key| {
            let id = key.public().to_peer_id();
            let mut allow = libp2p::allow_block_list::Behaviour::<
                libp2p::allow_block_list::AllowedPeers,
            >::default();
            for peer in allowed {
                allow.allow_peer(peer);
            }
            Relay {
                relay: libp2p::relay::Behaviour::new(
                    id,
                    libp2p::relay::Config {
                        max_reservations: 16,
                        max_reservations_per_peer: 1,
                        reservation_duration: Duration::from_secs(300),
                        max_circuits: 16,
                        max_circuits_per_peer: 2,
                        max_circuit_duration: Duration::from_secs(120),
                        max_circuit_bytes: 32 * 1024 * 1024,
                        ..Default::default()
                    },
                ),
                identify: libp2p::identify::Behaviour::new(
                    libp2p::identify::Config::new("/awai/relay/1.0.0".into(), key.public())
                        .with_push_listen_addr_updates(false),
                ),
                autonat: libp2p::autonat::Behaviour::new(
                    id,
                    libp2p::autonat::Config {
                        use_connected: false,
                        boot_delay: Duration::from_secs(21600),
                        max_peer_addresses: 4,
                        throttle_clients_global_max: 8,
                        throttle_clients_peer_max: 2,
                        ..Default::default()
                    },
                ),
                allow,
                limits: libp2p::connection_limits::Behaviour::new(
                    libp2p::connection_limits::ConnectionLimits::default()
                        .with_max_established(Some(16))
                        .with_max_pending_incoming(Some(4))
                        .with_max_pending_outgoing(Some(4)),
                ),
            }
        })?
        .build();
    node.listen_on(bind)?;
    let id = *node.local_peer_id();
    let mut ready = Some(ready);
    tokio::pin!(stop);
    let deadline = tokio::time::sleep(duration);
    tokio::pin!(deadline);
    loop {
        tokio::select! {_=&mut stop=>return Ok(()),_=&mut deadline=>return Ok(()),event=node.select_next_some()=>match event {
            SwarmEvent::NewListenAddr{address,..}=>{node.add_external_address(address.clone());if let Some(tx)=ready.take(){let _=tx.send(address.with(Protocol::P2p(id)));}},
            SwarmEvent::Behaviour(RelayEvent::Identify(libp2p::identify::Event::Received{info,..}))=>if literal_transport(&info.observed_addr,false).is_ok(){node.add_external_address(info.observed_addr);},
            _=>(),
        }}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relay_profile_is_explicit_and_literal() {
        let relay = PeerId::random();
        let peer = PeerId::random();
        assert!(target(
            &format!("/ip4/127.0.0.1/tcp/1234/p2p/{relay}/p2p-circuit/p2p/{peer}")
                .parse()
                .unwrap()
        )
        .is_ok());
        assert!(target(
            &format!("/dns4/example.org/tcp/1234/p2p/{peer}")
                .parse()
                .unwrap()
        )
        .is_err());
        assert!(target(
            &format!("/ip4/127.0.0.1/tcp/1234/p2p/{relay}/p2p-circuit/p2p/{relay}")
                .parse()
                .unwrap()
        )
        .is_err());
    }
}
