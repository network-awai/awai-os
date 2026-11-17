# Awai Node buyer and operator path

This records what the current code supports after an operator installs NixOS.
It is not a claim that retail units are preconfigured. The ISO does not install
a model, expose a buyer chat UI, or pair a Kotoba authority account. Current
source adds a `murakumo.cloud` factory claim responder to the installed NixOS
node, but no new ISO or physical unit has been verified with it.

| Stage | Current action | Completion evidence |
| --- | --- | --- |
| Purchase and delivery | Retail ordering and physical fulfillment happen outside this installer. | A delivered, configured unit is inspected against the sold specification. |
| OS install | Operator boots the USB, selects and installs a target disk using the NixOS manual. | Installed host boots from its own disk and remote access works. |
| Local AI | Operator supplies an OpenAI-compatible model server and reviewed model. | `node /etc/murakumo/node-readiness.mjs --model MODEL_ID --local-url http://127.0.0.1:11434/v1` returns success from that exact model. |
| Factory identity | On each installed unit, the operator provisions a unique Ed25519 device key and label, then registers the factory DID and token with the operator-only `murakumo.cloud` API near dispatch. | The private key stays on the device; a distinct printed label and a factory row exist for that unit. |
| Buyer device claim | The buyer signs in at `murakumo.cloud`, scans the label, and the powered-on node signs the pending challenge. The node then sends signed heartbeats. | The site records a single claimed owner and a fresh signed heartbeat. This is a site device claim, separate from `auth.kotoba.cloud` authority pairing. |
| Optional community participation | Operator installs a Murakumo CLI version that supports `MURAKUMO_NODE_IDENTITY_FILE`, then runs `doctor`, `check`, and foreground `join` with the factory device identity. Do not run `node init` for a factory-provisioned unit. | The Community node reports the same DID as the buyer-claimed device, followed by admission and a fresh model-ready heartbeat. These do not prove job placement. |
| Rewards | Inference credits and reward accounting are separate from CLI join. | A completed, accepted job and an actual reward ledger entry are needed. No automatic reward or cash redemption is implemented by this installer. |

The supported command sequence for the CLI is documented in
[`kotoba-lang/murakumo`](https://github.com/kotoba-lang/murakumo). The local
readiness check does not mutate the model server or contact the community. It
accepts only a loopback HTTP `/v1` URL, verifies that the exact model ID is
listed, and requests a short chat completion. It does not establish GPU
acceleration, throughput, restart recovery or hardware suitability.

After installing a reviewed NixOS configuration that imports `node-base.nix`,
the operator runs the following on each unit. `provision` refuses to replace an
existing identity. The file containing the device private key and factory token
is root-readable only; keep the printed registration JSON and QR URL private
until the unit is prepared for its buyer.

```sh
sudo node /etc/murakumo/device-claim.mjs provision --model 'Murakumo 2609'
sudo systemctl start murakumo-device-claim
sudo systemctl status murakumo-device-claim
```

The `murakumo-device-claim` unit ships disabled: enable it with
`services.murakumoDeviceClaim.enable = true` (and `sudo nixos-rebuild switch`)
before the `systemctl start` above. It is an alternative to the CLI-based
`services.murakumoClaimResponder`; enable exactly one of the two, because the
node profile asserts they are mutually exclusive and one device must never
answer the same buyer challenge twice.

The operator sends the returned `registration` JSON to
`POST https://murakumo.cloud/api/devices/register` using the site admin token
from a trusted operator environment, never from the node. The factory claim
window is 30 days from registration, so register near dispatch. The printed
`labelUrl` is the QR content. If a label must be reprinted, run
`sudo node /etc/murakumo/device-claim.mjs label` on that same unit. The buyer
opens that URL, signs in with the site's Passkey flow, scans/submits the label,
and keeps the node powered and online while it answers the five-minute
challenge. A successful claim changes the site device row to `claimed`; a
subsequent signed heartbeat confirms that the same key is online. A heartbeat
reports identity/liveness only, not model readiness or inference capability.

The site claim and the Community inference provider can use the same device
identity when the CLI is started with the root-readable factory identity file.
This binds their device DID, but does not delegate the device's earned credits
to the buyer's account. A claimed buyer unit is not automatically a paid
provider. Joining Community still needs its own admission, an accepted
completed inference job, and a reward ledger entry before any reward can be
asserted.

After installing the updated Murakumo CLI, run it as root for this check so
the private factory key never needs a copy in a user's home directory. Use
the exact model ID returned by the local model server; replace the example
value below. `check` enrolls and reports a heartbeat without taking jobs.
Only after the operator has admitted the Community node and confirmed the
model should `join` be used for unattended participation. The NixOS module
keeps Community participation disabled by default. To opt in, install the CLI
release that supports `--idle-only` and add this to the host configuration:

```nix
services.murakumoCommunity = {
  enable = true;
  cli = "/opt/murakumo/bin/murakumo";
  model = "YOUR_MODEL_ID";
  localUrl = "http://127.0.0.1:11434/v1";
};
```

The service checks a real local completion before starting, reuses the factory
DID, and withholds new Community jobs and free-slot heartbeats while the host
has high CPU load or low free memory. A job already claimed is allowed to
finish. Disable the option and rebuild the host to stop participation. This
host check does not see every GPU-only workload, so physical coexistence and
buyer control still need validation before a retail promise.

```sh
sudo env MURAKUMO_NODE_IDENTITY_FILE=/var/lib/murakumo/device-identity.json \
  murakumo node doctor --model YOUR_MODEL_ID
sudo env MURAKUMO_NODE_IDENTITY_FILE=/var/lib/murakumo/device-identity.json \
  murakumo node check --model YOUR_MODEL_ID
sudo env MURAKUMO_NODE_IDENTITY_FILE=/var/lib/murakumo/device-identity.json \
  murakumo node join --model YOUR_MODEL_ID
```

After the same DID has served an accepted paid job, the person operating the
unit can inspect its earned credits. A payout request needs two independent
approvals: the buyer signs in to the draft `murakumo.cloud` device console and
authorizes one exact destination and credit amount, then the device signs the
same request. The buyer copies the two-minute authorization into a private
mode-0600 file on the node. The credits are debited when the API accepts the
request; an operator must separately approve and settle the USDC transfer.
This cross-service path passed a local integration test with a model fixture,
but the site/API changes are draft and are not a live payout flow.

```sh
sudo env MURAKUMO_NODE_IDENTITY_FILE=/var/lib/murakumo/device-identity.json \
  murakumo node earnings
sudo env MURAKUMO_NODE_IDENTITY_FILE=/var/lib/murakumo/device-identity.json \
  murakumo node payout --credits 5000 --to YOUR_0x_WALLET_ADDRESS \
  --owner-token-file /absolute/private/buyer-authorization.txt
```

Only a qualified Community node can take explicitly public work. The current
node worker can execute a `full-shard` job with `input.trust-tier=public` and
the exact local model ID; private `host-large-model` jobs remain outside the
Community pool. This has been exercised only with a local model fixture; an
accepted job on a shipped unit remains an open acceptance check.

Once that check passes, a user on the node can call the same local API. For
example, with a server on port 11434:

```sh
curl -fsS http://127.0.0.1:11434/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"YOUR_MODEL_ID","messages":[{"role":"user","content":"こんにちは"}],"stream":false}'
```

This is a local API call, not an account-backed Murakumo chat experience.
Access from a phone or browser needs a separately designed authenticated
interface; do not expose the loopback model server directly to the Internet.

The `murakumo.cloud/onprem` standard retail specification and the separate
24 GB/256 GB Murakumo 2609 listing must be qualified independently. A model
tested on one hardware configuration is not automatically qualified on the
other. Before advertising a turn-key buyer flow, validate the shipped unit's
image, model license and digest, local endpoint, account linking, recovery and
support path on physical hardware.
