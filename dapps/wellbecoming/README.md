# Wellbecoming core

The pure core that measures a person's wellbecoming against their own past, written first in
`.cljc` for Awai Otehon (ADR 0026 D18, D20). It implements the **proposed** spec of root ADR
`2611071400-wellbecoming-self-referenced-measurement-spec` (JUN-997). Tracking: JUN-999 under
JUN-996. It has no screen, MCP server, keys or storage, and it is **not built into the OS image**.

The constants are provisional. The ADR is `proposed`, and the owner has not yet decided the
dimensions, the windows, the floor or the dead band. They are options with defaults, so changing
them later changes no code.

| Part | File | Runs on |
| --- | --- | --- |
| Pure core | `src/wellbecoming/core.cljc` | Babashka, ClojureScript (nbb) and Basilisp checked |
| Shared cases | `test/cases.json` | All three runners |
| Runners | `test/run_cases.clj`, `test/run_cases.cljs`, `test/run_cases.lpy` | Babashka, nbb, Basilisp |
| Case generator | `test/gen_cases.py` | Python 3, only to rewrite the JSON |

## What the core decides

- **Delta per dimension.** The median of the last 14 days against the median of the 90 days before,
  divided by `max(1.4826 * MAD, 0.05)`, in milli-z and truncated toward zero. Fewer than 5 current or
  20 baseline observations is `insufficient`. Bad input is `invalid` with a reason. Neither is ever
  read as zero.
- **Direction.** From the worst side, never a mean. Under two usable dimensions is
  `insufficient-history`. A delta of -500 or less in any dimension is worse, +500 or more is better.
- **Hysteresis.** `worsening` is confirmed at once. Any other change needs the same direction in two
  windows in a row.
- **Local index.** A display number for the person only. It is never exported.
- **Export record.** Exactly five fields. A field that compares people or carries a score is refused
  as `forbidden-field`, and any other extra field as `unknown-field`.

Everything is an integer. Observations are permille (0 to 1000, higher is better) and days are
integers. The core has no I/O, regular expressions, dates or platform numbers, so the result is the
same on every host.

## Where it must run

On the person's device. The pseudonym rotates every 30 days and the windows are longer, so only the
person's own key can join the history. A server or the economy layer cannot, and this core gives
them nothing to join.

## Check

```bash
bb --classpath src test/run_cases.clj
nbb --classpath src test/run_cases.cljs
basilisp run -p src test/run_cases.lpy
```

## Evidence (2026-11-07 bb/nbb, macOS arm64 laptop, bb v1.12.218, nbb v1.4.208, Python 3.15.0;
## 2026-11-09 Basilisp, same laptop, Basilisp 0.5.1)

| Check | Result |
| --- | --- |
| Shared cases on Babashka | 93 of 93 |
| Shared cases on nbb (ClojureScript) | 93 of 93 |
| Shared cases on Basilisp | 93 of 93, exit 0; one tampered expectation fails with exit 1 |
| Expected values | From `gen_cases.py`, an exact-fraction implementation that shares no code with the core |
| `cases.json` regenerated | Byte-identical (fixed seed) |
| 14 one-line breaks of the core (tau, floor, window edge, both minimum counts, MAD factor, even median, mixed, clip, x range, hysteresis, two forbidden names, the closed-set check) | Each fails at least one case, with the expected reason |
| One changed expectation | The runner fails and exits 1 |

The ADR worked example (B median 0.60 and MAD 0.04, C median 0.54) comes out at -1011 milli-z, and
the floor example at -400.

## Not verified or not implemented

- Basilisp (D20, OS side) is now checked via `test/run_cases.lpy`: 93 of 93 on Basilisp
  0.5.1, using the same `core.cljc` with no code change. `clojure.string` calls and `quot`
  behave the same there on the shared cases.
- shadow-cljs and the browser build, and plain JVM Clojure.
- Real observations. Every value is synthetic, and nothing here calibrates a threshold.
- The encrypted payload, attestation and key handling. The core only checks the shape of the export
  record. It does not encrypt or sign.
- The screen, the MCP server, manimani, Hermes, and the consent broker.
- JUN-998's lexicon check on the kizashi side. The forbidden names here are the ADR D8 list, and the
  two lists must be kept in step by hand until then.
