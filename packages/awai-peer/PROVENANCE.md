# Shared transport extraction

AWAI-3001 extracts the previously verified explicit-peer public transport from network-awai/app-aozora-appview commit 7ffb5e75fe9976436f7e6af7e71a48b9fc2470e7, awai/p2p. This Otehon transport adapter is separate from Native/selfhost and keeps WNFS semantics in the existing CLJC implementation. No Rust WNFS runtime is substituted. New code handles bounded opaque CAR/IPLD blocks, transport and persistence only. Protocol services are separate roles from static app delivery.
