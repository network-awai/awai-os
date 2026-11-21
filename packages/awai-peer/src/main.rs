use anyhow::{bail, ensure, Result};
use awai_peer_runtime::{execute, serve_public, PeerEndpoint, BITSWAP, MAX_BLOCK_BYTES, PING};
use libp2p::{identity, multiaddr::Protocol, Multiaddr};
use std::{path::Path, time::Duration};
#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("relay") => {
            ensure!(args.len()==6,"relay <identity-dir> <literal-bind> <allowed-PeerIDs-json> <seconds <=21600>");
            ensure!(std::fs::metadata(&args[4])?.len()<=4096,"relay participants too large");
            let names:Vec<String>=serde_json::from_slice(&std::fs::read(&args[4])?)?;
            let allowed=names.iter().map(|name|name.parse()).collect::<Result<Vec<_>,_>>()?;
            let key=awai_peer_runtime::load_identity(Path::new(&args[2]))?;
            let(tx,rx)=tokio::sync::oneshot::channel();let(_stop,stopped)=tokio::sync::oneshot::channel();
            let task=tokio::spawn(awai_peer_runtime::nat::run_relay(key,args[3].parse()?,allowed,Duration::from_secs(args[5].parse()?),tx,stopped));
            let address=tokio::time::timeout(Duration::from_secs(30),rx).await??;
            println!("{}",serde_json::json!({"relay":address.to_string(),"protocol":"/libp2p/circuit/relay/0.2.0"}));
            {use std::io::Write;std::io::stdout().flush()?;}task.await??;
        }
        Some("identity") => {
            ensure!(args.len()==3,"identity <app-private-state-dir>");
            let key=awai_peer_runtime::load_identity(Path::new(&args[2]))?;
            println!("{}",serde_json::json!({"peerId":key.public().to_peer_id().to_string()}));
        }
        Some("snapshot-import") => {
            ensure!(args.len()==5,"snapshot-import <store> <CAR> <trusted-WNFS-root>");
            let store=awai_peer_runtime::snapshot::DiskStore::open(Path::new(&args[2]))?;
            let snapshot=store.import_car(Path::new(&args[3]),args[4].parse()?)?;
            println!("{}",serde_json::json!({"snapshot":snapshot.to_string(),"trustedRoot":args[4]}));
        }
        Some("provider") => {
            ensure!(args.len()==5,"provider <app-private-state-dir> <grants-json> <literal-bind-address>");
            ensure!(std::fs::metadata(&args[3])?.len()<=16384,"grant file too large");
            let grants=serde_json::from_slice(&std::fs::read(&args[3])?)?;
            let key=awai_peer_runtime::load_identity(Path::new(&args[2]))?;
            let service=awai_peer_runtime::provider::Provider::new(Path::new(&args[2]).join("store"),key,grants)?;
            let (ready,rx)=tokio::sync::oneshot::channel();let (_stop,stopped)=tokio::sync::oneshot::channel();
            let task=tokio::spawn(service.run(args[4].parse()?,ready,stopped));
            let address=rx.await?;println!("{}",serde_json::json!({"address":address.to_string(),"protocol":awai_peer_runtime::provider::PROTOCOL}));
            {use std::io::Write;std::io::stdout().flush()?;}
            task.await??;
        }
        Some("sync-push")|Some("sync-pull")|Some("pin-query") => {
            let pull=args[1]=="sync-pull"; let query=args[1]=="pin-query";
            ensure!(args.len()==if pull{7}else{6},"sync-push|pin-query <identity-dir> <store> <peer-address> <snapshot> | sync-pull <identity-dir> <store> <peer-address> <snapshot> <new-CAR>");
            let key=awai_peer_runtime::load_identity(Path::new(&args[2]))?;
            let store=awai_peer_runtime::snapshot::DiskStore::open(Path::new(&args[3]))?;
            let address:Multiaddr=args[4].parse()?; let snapshot:cid::Cid=args[5].parse()?;
            if pull {
                awai_peer_runtime::provider::pull_snapshot(key,&store,address,snapshot).await?;
                store.export_car(&snapshot,Path::new(&args[6]))?;
                println!("{}",serde_json::json!({"snapshot":snapshot.to_string(),"verified":true,"car":args[6]}));
            } else {
                let receipt=if query {
                    let response=awai_peer_runtime::provider::exchange(key,address.clone(),awai_peer_runtime::provider::Request::Query{snapshot:snapshot.to_string()}).await?;
                    ensure!(response.ok,"pin/query refused");response.receipt.ok_or_else(||anyhow::anyhow!("missing receipt"))?
                } else {awai_peer_runtime::provider::push_snapshot(key,&store,address.clone(),snapshot).await?};
                let peer=address.iter().last().and_then(|p|if let Protocol::P2p(id)=p{Some(id)}else{None}).ok_or_else(||anyhow::anyhow!("PeerID required"))?;
                let verified=receipt.verify(peer,&snapshot.to_string())?;
                println!("{}",serde_json::json!({"receipt":receipt,"verified":verified}));
            }
        }
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
