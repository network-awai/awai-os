# Read-only itonami host catalog

This is a local platform service, separate from the static shell origin. It reads `ITONAMI_DIR/profiles` (default `~/.itonami/profiles`) and exposes only validated profile IDs, descriptions and skill names at `https://127.0.0.1:8777/v1/itonami/profiles`. It never reads Hermes configuration, `.env`, workspaces or sessions and never changes profile/runtime state. Symlinked profile directories/manifests, oversized/invalid manifests and ID/directory mismatches are excluded. An unavailable store fails closed.

For the local preview, use Node, Babashka and an **already trusted** mkcert CA:

```sh
cd nixos/otehon/shell
npm run profiles:host
# In another terminal, build/serve the static shell:
npm run preview
```

The runner creates only a localhost leaf certificate in mkcert's existing application directory. It does not install a CA, change trust settings or bypass certificate validation. Set `PROFILE_CATALOG_CERT` and `PROFILE_CATALOG_KEY` and run `node bridge.mjs` directly when providing platform-managed TLS credentials. `BB_COMMAND` can select the platform's pinned Babashka executable; `ITONAMI_DIR` selects an explicit itonami store. The service has a fixed loopback listener and route; requests cannot choose a filesystem path.

Entering Soshiki automatically requests the catalog through the exact pinned shared operation broker. Its fresh-operation confirmation identifies the local service and endpoint. Denial sends no request, and leaving the screen aborts an outstanding operation. No folder picker is used. Choosing a returned profile binds it to the selected circle in browser-local organization state. Binding does not start a bot or authorize execution.

The local preview runner and real TLS catalog are exercised separately from OS image qualification. Nix/VM/macOS-app installation and host-to-guest bridging are not claimed by these checks. The Otehon CI job runs the metadata confinement tests through `check.nix`; the native product does not depend on this hosted service or its checks.
