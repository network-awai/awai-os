use anyhow::{bail, ensure, Result};
use awai_peer_runtime::{execute, serve_public, PeerEndpoint, BITSWAP, MAX_BLOCK_BYTES, PING};
use libp2p::{identity, multiaddr::Protocol, Multiaddr};
use std::{path::Path, time::Duration};
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("serve-public")=> {
            ensure!(args.len()==5,"serve-public <literal bind multiaddr> <public-file> <seconds <=300>");
            let bind:Multiaddr=args[2].parse()?;
            ensure!(matches!(bind.iter().collect::<Vec<_>>().as_slice(),[Protocol::Ip4(_),Protocol::Udp(_),Protocol::QuicV1]|[Protocol::Ip4(_),Protocol::Tcp(_)]),"literal IP QUIC/TCP bind required");
            ensure!(std::fs::metadata(&args[3])?.len()<=MAX_BLOCK_BYTES as u64,"public file too large");
            serve_public(identity::Keypair::generate_ed25519(),bind,std::fs::read(&args[3])?,Duration::from_secs(args[4].parse()?)).await?;
        }
        Some("connect")|Some("get-block")=> {
            let get=args[1]=="get-block";ensure!(args.len()==if get{5}else{3},"connect <multiaddr> | get-block <multiaddr> <cid> <output-file>");
            let address:Multiaddr=args[2].parse()?;
            let peer=address.iter().find_map(|p|if let Protocol::P2p(id)=p {Some(id)}else{None}).ok_or_else(||anyhow::anyhow!("PeerID required"))?;
            let e=PeerEndpoint {transport:"libp2p".into(),peer_id:peer.to_string(),addresses:vec![args[2].clone()],protocol:if get{BITSWAP}else{PING}.into(),action:args[1].clone(),max_request_bytes:1024,max_response_bytes:1048576,timeout_ms:15000};
            let payload=if get{serde_json::json!({"cid":args[3]})}else{serde_json::json!({})};
            let mut result=execute(identity::Keypair::generate_ed25519(),e,payload).await?;
            if let Some(data)=result.data_base64.take() {
                use base64::Engine;let bytes=base64::engine::general_purpose::STANDARD.decode(data)?;
                ensure!(!Path::new(&args[4]).exists(),"refusing to overwrite output");
                use std::io::Write;let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(&args[4])?;f.write_all(&bytes)?;f.sync_all()?;
            }
            println!("{}",serde_json::to_string(&result)?);
        }
        _=>bail!("Usage: awai-peer serve-public <IP/QUIC bind> <public-file> <seconds> | connect <IP/QUIC/PeerID> | get-block <IP/QUIC/PeerID> <cid> <new-output>"),
    }
    Ok(())
}
