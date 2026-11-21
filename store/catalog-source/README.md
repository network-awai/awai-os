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
- **ISCO-08 source text.** The marks are in `isco-source.tsv` (`repo`, `commit`, `ja`); they apply only to apps in
  `series-apps.json`. An ISCO-08 app stays out until it has a row whose commit added the final ISCO-08 source text,
  and its `release.json` records a `source_commit` that is that one or later (checked in a local clone with `--repos`).
  The four earlier marks pointed at the earlier wording and were cleared (2026-11-22). Add rows from a batch with
  `python3 android/isco-source-add.py BATCH.tsv [--extra REPO=COMMIT]`: it checks each commit is on the repository's
  default branch, that a mark only moves forward, and, when a repository has two candidate commits (README and app
  screen), takes the later one and refuses diverged branches. Nothing is written if any row fails.
- **ILO reference (AWAI-3629).** Each listed ISCO-08 app's description ends with one reference built from its code:
  `Occupation reference: ISCO-08 (International Labour Organization, 2012), code XXXX. This app is not produced,
  reviewed or endorsed by the ILO.`, and, when `ja` is true, `職業の参照: ISCO-08（国際労働機関 ILO、2012 年）のコード
  XXXX。日本語の名称は当方の訳です。この app は ILO が作成・確認・推奨したものではありません。` No list of codes and names,
  and no ILO logo.
- **UNSPSC (unspsc-10, 27, 39, 43, 73).** In the table without a rank, one key group per segment (`unspsc-10`
  and so on). Their marks are in `unspsc-source.tsv` (same form as `isco-source.tsv`; the import script routes each
  row by its repository). A listed UNSPSC app's description ends with the reference and trademark line from the
  Legal memo (`unspsc-redistribution.md`, 2026-11-22), with the code in eight digits (segment 10 is `10000000`):
  `Classification reference: UNSPSC® (United Nations Standard Products and Services Code), code XXXXXXXX. © United
  Nations Development Programme (UNDP). UNSPSC® is a registered trademark of UNDP. This app is not produced, reviewed
  or endorsed by UNDP.`, and, when `ja` is true, the Japanese line from the memo. One code per app, no list of codes
  and names, no UNDP emblem.
- **Holds.** `hold.json` lists source patterns kept out of the catalog as `held`, with the reason and who lifts the
  hold. Now: `unspsc-*` (Store distribution waits for the UNDP addendum; the application is in the owner's name and
  Legal is checking; Decision lifts it). When the hold is lifted, the UNSPSC apps go through the marks and the
  reference line above without further changes.

Generate, then sign with a catalog key from the key list:

```sh
python3 android/series-catalog.py --inputs DIR --revision N --base <current raw catalog> --out catalog-revN-raw.json --report report.json [--repos CLONES]
python3 android/sign-catalog-envelope.py --raw catalog-revN-raw.json --key-list DIR --keystore ~/.android/awai-store-dev/catalog.p12 ...
```

`DIR/<source>/` holds the app's `release.json`, `descriptor.json` and one APK. `python3 android/tests/series-catalog.py`
checks the generator with placeholder APKs made on the spot.
