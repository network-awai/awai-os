# Awai dapp Tauri 3 carrier (development preview)

The snapshot panel shares one thin Rust/libp2p host and a pinned canonical consent broker across independently identified Android packages. Preserved product artifacts retain their own pinned runtime attestations; this does not claim that every existing product operation migrated to the new broker revision. Five profiles target ARM64 phones and x86_64 Android Desktop. All app-origin artifacts are static; the host exposes bounded snapshot operations, never general HTTP, shell or arbitrary filesystem access.

Aozora and Dougaka preserve their pinned existing static interfaces. Ongakuka and Itonami currently package a **P2P connectivity preview**; their creative/agent domain interfaces have not been ported. Yataverse exposes snapshot receiving, pin receipts and queries. These packages are not production store releases. Aozora's production update ID remains `app.aozora`; this fixture uses a separate preview ID and cannot replace the production app.

## Prepare and build

Install the exact npm lockfile with `npm ci --ignore-scripts`. Supply the previously built static artifacts explicitly:

```sh
node scripts/prepare.mjs --aozora-web /absolute/verified/aozora/dist --dougaka-web /absolute/verified/dougaka/dist
npm run tauri -- icon generated/awai-icon.png --output generated/common-icons
node scripts/android.mjs
node scripts/build-android.mjs
npx playwright test
```

Preparation verifies every input file against `profiles/web-sources.json`, and downloads only the immutable revision/digest-pinned canonical broker. `record-web.mjs` is an explicit developer pin-maintenance tool, not automatic acceptance of changed inputs. The maintained Cargo and npm lockfiles pin the carrier. Android SDK/NDK/JDK prerequisites must be installed; no credential is copied into generated output. `generated/` is disposable task build output and is never deployed by these commands.

`build-android.mjs` sequentially reuses dependency compilation while regenerating Tauri/Wry's package-specific JNI/Kotlin outputs. Directly switching app IDs in the same Cargo target without this regeneration can leave missing or incorrect Android bindings.

## Receive and stop

On the receiving device, select the exact sender PeerID, snapshot CID, literal listening address, byte budget and duration. Android 17 local-network permission and notification permission are requested by an explicit button; these OS permissions do not approve a snapshot operation. The pinned canonical broker then presents the complete operation for a fresh trusted choice. Read-back to the sender is a separate, initially unchecked choice.

Receiving runs in an unexported `dataSync` foreground service with an ongoing Stop notification, for at most six hours. It never resumes after process death/reboot and never silently broadens a grant. Android may impose a shorter OS budget or terminate the process. This is bounded background reception, not a guarantee of indefinite mobile availability. Peer keys and snapshot blocks stay in app-private storage, excluded from Android cloud/device backup. Removing the app destroys this preview's identity/data; no automatic identity replacement or key recovery is claimed.

The CAR transport verifies and persists opaque IPLD blocks. WNFS private-tree, key and merge semantics remain owned by the pinned apex `.cljc` implementation. A pin receipt proves verified custody at observation time and a bounded retention promise; it is not an independent availability or durability guarantee. Imported blocks do not automatically replace a user's active WNFS root. Full concurrent WNFS merge/adoption remains a separate integration.

NAT support uses one explicit relay, AutoNAT and DCUtR. Loopback relay tests and same-LAN devices do not qualify hole punching across independent networks. No HTTP, DNS, gateway, DHT discovery or automatic relay fallback is used for snapshot transfer.

`device-receive-test.mjs` drives only this disposable Yataverse preview through real canonical consent UI, checks foreground-service state, backgrounds the app, then sends/queries/returns a synthetic encrypted WNFS fixture over the LAN and confirms explicit Stop refuses traffic. Its local CDP/ADB channel controls UI and diagnostics; snapshot data uses literal-IP libp2p. It must be run against an explicitly selected fixture device and a task-owned debug endpoint, never a user's existing app/account.

UI proposal: https://www.figma.com/design/umqCqP5KSjLWh9fhCI1HaN?node-id=236-2636 (baseline unmodified; runtime/physical-device comparison recorded separately).

## Export and qualification

`node scripts/export.mjs` verifies prepared static bytes, APK identity, signer and both ABIs, then creates a task-local `distribution.json`, five APKs and five static `.dapp.zip` bundles. It performs no upload or installation. Bundles use the explicit `awai.dapp.bundle.v1` carrier schema; they do not claim implementation of the separate native `itonami.dapp.v1` / `ui://` sandbox intake. Snapshot operations in these static previews require the Tauri host; Web transport parity remains open.

`device-pair-test.mjs` exercises two explicitly selected disposable Yataverse APKs through canonical UI choices and an operator-started relay limited to those two peers. A successful local-segment relay test is distinct from WAN NAT hole-punch qualification. Fixture OS permissions and scripted trusted UI clicks are test setup, not evidence of a human consent study.

`device-store-test.mjs` exercises only an explicitly selected disposable Store preview and absent preview app IDs. It walks browser review, independent native confirmation, Android PackageInstaller confirmation and Store launch, then waits for the app-specific WebView and shared peer host. It refuses existing app replacements and retains installation checkpoints when startup diagnostics fail.

The existing Dougaka vendor `PROVENANCE.edn:6` contains a malformed upstream revision (`c29b87e59fdb1b8b3a2ca7295356cd0af1e9`). It is preserved. Carrier static files are checked byte-for-byte against the OS vendor input at `c7f1008cf06f4eacb7817d3602f7a9c0373146c5`; the profile's full upstream revision is a reference, not proof of a reconstructed upstream build. Production provenance qualification remains open.

The owning WNFS CLJC provider currently imports Node crypto/filesystem modules, including prime generation/checking. It cannot simply run inside Android WebView. This carrier transports/restores its opaque encrypted snapshots; browser-provider, key-authority, active-root adoption and concurrent domain-state merge must be integrated in the owning shared implementation, rather than replaced with product-local Rust WNFS semantics.
