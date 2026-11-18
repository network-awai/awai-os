# Fixtures copied from the awai-public-funds itonami profile

From kotoba-lang/itonami-agent `f2866937c1db768b6f5c92db15e8cdd28c1af163`
(PR #6, AWAI-3294), `itonami/profiles/awai-public-funds/fixtures/expected/`.
The profile builds them from the unmodified Ministry of Finance CSVs
(予算書・決算書データベース, PDL1.0) for Japan's general account, fiscal year 2024;
its evidence checks every total against an independent recomputation.

| File | sha256 |
|---|---|
| `jp-fy2024-general.result.edn` | `26eea1074ebc0e1198719aeaf174416ec606dcdd9d7a9a70cf88ca297bc5a02b` |
| `rank-ministries-refused.refusal.edn` | `9998bbe24381598996af48dab33790ec109d7610aef1df653250e81d27f1b592` |

This app must import the result unchanged, reject the refusal, and give the
same totals the record states.
