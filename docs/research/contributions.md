# Contribution record

Per-claim contribution rows for the [evidence map](evidence-map.md). One row per
claim ID records who measured or verified the claim, with which command, and what
output, so a reviewer can reproduce the result. Attribution is split: artifact
production, measurement, and verification are credited separately.

UNVERIFIED and CONTRADICTED rows are recorded here for traceability but are
EXCLUDED from manuscript prose, abstracts, and promoted summaries until a new,
separately reviewed claim ID exists (see the [researcher
profile](researcher-profile.md)). A single recorded run stays MEASURED-ONCE even
after readback. A changed configuration, signer, scope, or artifact digest
starts a new row; the old row is kept and marked superseded, never edited in
place. Human research-lead admission is recorded in the final column; bot
verification alone does not admit a claim.

| Claim ID | Manuscript wording (proposed) | Operator / measurer | Researcher contribution (bot) | Bot verification date (JST) | Command / review method | Source revision + citation | Independent reviewer + readback | Final decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BOOT-LAN | The physical Ryzen 7 7735HS target booted Android from the LAN with RAM-backed userdata and NVMe hidden. MEASURED-ONCE (2026-11-16 single run). | Original trial operator (recorded in source JSON) | Row-level readback: values match primary record; status MEASURED-ONCE correct for a single run | 2026-11-24 | `read_file android/desktop/netboot/physical-observation-20261116.json` compared to evidence-map row | sourceRevision `05d5237365311772e384b1fe090c3607a2834430`; `physical-observation-20261116.json` | Kougi (bot:Kougi), 2026-11-24: values match; BOOT-LAN stays MEASURED-ONCE (readback only, no physical re-execution); attribution note: source JSON has no operator field and `bootcomplete1` is README wording — see superseding row below | Not yet admitted (draft) — SUPERSEDED by corrected BOOT-LAN row 2026-11-24 |
| BOOT-LAN (corrected 2026-11-24; supersedes row above) | The physical Ryzen 7 7735HS target booted Android from the LAN with RAM-backed userdata and NVMe hidden. MEASURED-ONCE (2026-11-16 single run). | Operator not recorded in source JSON (unknown; to be set by operator — do not attribute). `bootcomplete1` is README wording; source JSON records `bootCompleted: true`. | Row-level readback: values match primary record; status MEASURED-ONCE correct for a single run | 2026-11-24 | `read_file android/desktop/netboot/physical-observation-20261116.json` compared to evidence-map row | sourceRevision `05d5237365311772e384b1fe090c3607a2834430`; `physical-observation-20261116.json` | Kougi (bot:Kougi), 2026-11-24: values match; readback only, no re-execution | Not yet admitted (draft) |
| BOOT-PINS | The LAN trial manifest records full digests and lengths for its boot artifacts. MEASURED (committed manifest pin). | Manifest author (2026-11-16 trial) | Byte-level readback: kernel/initrd/iPXE lengths and SHA-256 match JSON exactly | 2026-11-24 | `cat android/desktop/netboot/artifacts-20261116.json` compared to evidence-map row | `android/desktop/netboot/artifacts-20261116.json` | Kougi (bot:Kougi), 2026-11-24: lengths and SHA-256 match independent output | Not yet admitted (draft) |
| BOOT-INPUT | The evaluation manifest pins an unofficial third-party live image in equal-sized parts. MEASURED. | Manifest author | Readback: both parts `1420745728` B, `productionQualified: false`, `sourceClosureVerified: false` match JSON | 2026-11-24 | `python3 json.load(android/desktop/pc-evaluation-pins.json)` | `android/desktop/pc-evaluation-pins.json` | Kougi (bot:Kougi), 2026-11-24: both parts `1420745728` B and both false flags match | Not yet admitted (draft) |
| (counts / keys) | Evidence map has 24 claim rows: MEASURED 6 / MEASURED-ONCE 14 / UNVERIFIED 2 / CONTRADICTED 2. Prior handoff memo said "22 rows"; actual count is 24. | — | Recount from table: `grep -c` = 26 `\| ` lines (header + separator + 24 rows); per-status greps 6/14/2/2 | 2026-11-24 | `grep -c "^| " docs/research/evidence-map.md` and per-status `grep` | `docs/research/evidence-map.md` | Kougi (bot:Kougi), 2026-11-24: `grep -c` = 26 lines = 24 rows; 22-row correction correct | Clarification only |

All other rows (GPT-REFUSAL, INSTALL-*, OTA-*, STORE-*, YATA-*) were not yet
re-read by Researcher in this pass and are marked `not verified by the author`
until a dedicated readback row is added. They must not be quoted in draft
prose as bot-verified.
