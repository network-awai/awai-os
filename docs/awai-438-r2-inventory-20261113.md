# R2 configuration inventory, 2026-11-13

AWAI-438; read-only Cloudflare account API and bounded local-source inspection.
This is a configuration inventory, not proof of data contents, traffic, ownership,
or migration completion. The Worker-list response returned 114 scripts without
pagination metadata; settings were read for all 114 with no reported errors.
Other accounts, unpublished scripts, S3 API clients, external
services and complete source coverage have not been surveyed. This cannot support
a network-wide zero-dependency claim. Do not remove a binding based on this table.

| Worker | Configured R2 binding → bucket | Scope / next step |
|---|---|---|
| `aiueos-updates` | `RELEASES` → `aiueos-releases` | AIUEOS delivery; AWAI-2821 |
| `app-aozora-auth` | `CHALLENGES_R2` → `aozora-auth-data` | Aozora auth; challenge replay protection; qualify replacement |
| `app-aozora-live` | `SEGMENTS` → `aozora-live-segments` | Aozora video; preserve playlists and segments |
| `app-aozora-pds` | `BLOBS` → `aozora-pds-blobs` | PDS blobs; preserve identity, bytes and availability |
| `local-murakumo` | `MERKLE_BUCKET`, `MURAKUMO_QUEUE_R2` → `kotobase-merkle-lsm` | control-plane and queue; AWAI-365; establish actual use and safe migration |
| `yataverse-datoms` | `KOTOBASE_R2` → `kotobase-graph-database-production` | graph/datoms; identify owner, persistence contract and migration |
| `kura-conformance` | `SHARDS` → `kura-phase0` | conformance surface; establish ownership and actual use |
| `app-mail-relay` | `MAIL_BUCKET` → `itonami-mail-relay` | mail; AWAI-240/241; sensitive data and retention |
| `app-otent` | `DATALAKE` → `cloud-itonami-datalake` | determine owner and actual use |
| `cloud-itonami-hanmoto` | `REGISTER` → `hanmoto-register` | determine owner and record semantics |
| `inga-replica-testnet` | `INGA_LOG` → `inga-replica-testnet-log` | testnet log; identify retention and users |
| `kotoba-cloud-control-plane` | `PUBLIC_BLOCKS` → `kotobase-graph-database-production`; `SALES_LEADS` → `internal-sales-catalog` | distinguish graph service and private sales data; do not assume either is in scope |
| `kotoba-cloud-storage` | `STORAGE_BUCKET` → `kotoba-cloud-storage` | determine owner and storage contract |
| `murakumo-toshokan` | `TOSHOKAN_BUCKET` → `murakumo-toshokan` | determine owner and data contract |
| `nexus-x402` | `NEXUS_R2` → `nexus-x402-data`; `QR_R2` → `nexus-x402-qr-data` | determine owner and payment/data dependencies |
| `oppai-fans` | `OPPAI_R2` → `kotobase-merkle-lsm` | shared bucket; identify consumers before any change |
| `dev-yaoi` | `YAOI_CONTENT` → `yaoi-content` | ownership and scope unconfirmed |
| `kaigi` | `KAIGI_RECORDINGS` → `kaigi-recordings` | ownership and scope unconfirmed; recordings may be private |
| `mangaka-reader` | `CDN` → `ai-gftd-cdn` | separate product; scope unconfirmed |
| `spirit-in-physics-api` | `ARTIFACTS` → `spirit-in-physics-artifacts` | separate product; scope unconfirmed |

The same account's bucket-list call returned six names: `aiueos-releases`,
`internal-sales-catalog`, `kotobase-merkle-lsm`, `net-babiniku-generated-assets`,
`nexus-x402-data`, and `nexus-x402-qr-data`. Several configured binding names
were absent from that response. Pagination, jurisdiction, stale configuration,
permissions and other explanations have not been resolved; neither presence nor
absence here proves whether a bucket exists or holds production data. The list
also does not prove a bucket without a listed Worker binding is unused.

The Pages project list reported 18 projects over two pages; both pages were
read. `net-babiniku` lists `net-babiniku-generated-assets` in production and
preview. `itonami-agent-treasury-tokyo2026` lists `cloud-itonami-backup`,
`cloud-itonami-data`, `cloud-itonami-drive`, and `cloud-itonami-mail` in
production. No R2 entry appeared in the other 16 project settings returned.
This is configuration evidence only; confirm ownership and current usage.

In local `network-awai/app-aozora-engine` checkout revision `ccdb42c03eabbb5f20c3d20ea7248d18a94dc8d4`,
`auth/wrangler.jsonc`, `live/wrangler.jsonc` and `pds/wrangler.jsonc` declare the
three Aozora bindings. `auth/src/aozora/auth/challenge.cljk` uses the challenge
bucket in the spend path; `live/src/aozora/live/router.cljk` accesses segments;
`pds/src/aozora/pds/worker.cljk` and `router.cljk` access blobs. These observations
do not establish that this checkout matches the deployed Worker revision.
`kotobase-control-plane/kotobase-graph-database/wrangler.jsonc` also declares
`KOTOBASE_R2`, including testnet configuration; ownership and deployment join
remain to be verified. The four `network-awai-apex`, `network-awai-app`,
`network-awai-link` and `network-awai-relay` Worker settings returned no R2
bindings in this observation; this does not exclude calls to other services.

Next: inventory non-Worker clients; resolve bucket-list coverage and
deployed source revisions; classify each in-scope use by correctness, replay,
retention, privacy and recovery requirements. Qualify a non-R2 service and
independent readback for each before any separately approved live cutover.
