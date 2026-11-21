# Series apps for the Store catalog (AWAI-3771)

`series-apps.json` lists the classification-series apps (`cloud-itonami/app-itonami-cloud-itonami-*`) that the
Store catalog may carry, in App Cycle order: the order in which App Build makes their APKs. Owner decision
2026-11-22: the catalog is built from the apps' `release.json`, starting with the top ten.

| Rank | Source | Package id | Key group |
|---|---|---|---|
| 1 | isco-2423 | network.itonami.isco2423 | isco-2 |
| 2 | isic-7810 | network.itonami.isic7810 | isic-N |
| 3 | isic-7820 | network.itonami.isic7820 | isic-N |
| 4 | isco-3333 | network.itonami.isco3333 | isco-3 |
| 5 | isco-4311 | network.itonami.isco4311 | isco-4 |
| 6 | isco-2411 | network.itonami.isco2411 | isco-2 |
| 7 | isic-7120-cyberassurance | network.itonami.isic7120cyberassurance | isic-M |
| 8 | isic-6209 | network.itonami.isic6209 | isic-J |
| 9 | isic-8020 | network.itonami.isic8020 | isic-N |
| 10 | isic-6311-chainexplorer | network.itonami.isic6311chainexplorer | isic-J |

The package ids are the `identifier` in each repository's `app/src-tauri/tauri.conf.json` (checked 2026-11-22 at
the repositories' current `main`); the series build stamps `network.itonami.<scheme><code><suffix>`.

- **Key groups.** `release.json` carries no APK signer, so this table maps each app to its APK signing-key group:
  one key per ISIC Rev.4 section and per ISCO-08 major group; first-party apps have one key each (decision on
  AWAI-3771). `android/series-catalog.py` checks that each app's group follows from its code. In development,
  every group's signer is the Android debug identity `2507930b…`.
- **ISCO-08 source text.** An ISCO-08 app stays out of the generated catalog until `iscoSource.commit` names the
  commit that added the ISCO-08 source text, and the app's `release.json` records a `source_commit` that is that one
  or later (checked in a local clone with `--repos`). Marked (2026-11-22): isco-2423 `5bf9ea32…`, isco-3333
  `29773278…`, isco-4311 `b796093e…`, isco-2411 `4e578b83…` (AWAI-3629 attribution commits).
- **Clean builds only.** The series build writes `source_commit` (40 hex, or null without git) and `dirty`
  (true, false or null) into `release.json`. Any app whose `dirty` is not `false` is left out as `release-dirty`.
- **Which packages the Store admits.** The signed catalog decides. `Catalog.java` admits any
  `network.itonami.<one lowercase segment>` that the catalog lists, with the asset `packages/<segment>.apk`, the
  download name `online-<segment>.apk` and a 64 MiB ceiling; the catalog's APK asset must be exactly that name. No
  hand-written list of series package ids has to follow the table. Apps with their own rules (previews, Registry
  Assoc, the named apps and their budgets) keep them.

Generate, then sign with a catalog key from the key list:

```sh
python3 android/series-catalog.py --inputs DIR --revision N --base <current raw catalog> --out catalog-revN-raw.json --report report.json [--repos CLONES]
python3 android/sign-catalog-envelope.py --raw catalog-revN-raw.json --key-list DIR --keystore ~/.android/awai-store-dev/catalog.p12 ...
```

`DIR/<source>/` holds the app's `release.json`, `descriptor.json` and one APK. `python3 android/tests/series-catalog.py`
checks the generator with placeholder APKs made on the spot.
