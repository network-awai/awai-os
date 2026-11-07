# Awai link services

What a phone needs to link a device (`docs/otehon/login-0.6.0.md`), in the Cloudflare account that holds
the `awai.network` zone.

| Part | URL | What it is |
| --- | --- | --- |
| `relay/` | `relay.awai.network` | Carries ciphertext. A Worker and one Durable Object per topic |
| `site/` | `awai.network/link/` | The phone page, as static files with no Worker code |

The relay speaks the two ntfy routes that `awai.link.v1` uses, so the Otehon test image can keep using ntfy.
A message lasts 10 minutes, up to 4 KiB and 8 messages per topic. Nothing is logged.

```bash
ln -s ../../nixos/otehon/shell/node_modules node_modules
node check-relay.mjs https://relay.awai.network
```

```bash
sh deploy.sh
```
