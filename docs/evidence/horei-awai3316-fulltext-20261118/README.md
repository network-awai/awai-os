# Horei — full text from Yataverse after consent (AWAI-3316, 2026-11-18)

Record only; do not rewrite.

## Unit tests (`npm test`, 23 pass)

`test/fulltext.test.mjs` uses a real e-Gov API v2 response for 婦人補導院法 (`test/fixtures/333AC0000000017.json`, 27,749 bytes), fetched on 2026-11-18. Its sha256 `4e4db3af…de3b7` equals the corpus record.

| Check | Result |
|---|---|
| CID from the recorded sha256 | `bafkreicojwz27ohlgj37dyt57r5p7fvyjgkyd3ogrsiu5h5ys7lszhpdw4`, the same as `yataverse cid` (kotoba-lang/yataverse `c875a39`) on the file |
| Descriptor | Passes the canonical `clientRuntimeProblems`. The endpoint allows only GET `/ipfs/…?format=raw`; PUT, `format=car` and `/api/v0/add` are refused |
| Deny | 0 requests, nothing cached |
| Allow | 1 request, verified, cached; the second open makes 0 requests |
| Negative control | One flipped byte, one byte short and one byte extra: each refused, nothing cached |
| Corrupted cache entry | Deleted, then fetched again |
| 404 / 502 | Reported as absent / unavailable, nothing cached |
| No answer | Aborted at the deadline, reported as unavailable |

## Browser (built `dist/`, Chromium pane, 375 px)

| Step | Result |
|---|---|
| Open 婦人補導院法 | "Get the full text" button with the destination note |
| Press it | The canonical consent dialog shows service `yataverse`, endpoint `https://ipfs.yataverse.com`, `GET /ipfs/<cid>?format=raw`, data category `public-law-text-cid`, delivery redirects `https://*.ipfs.yataverse.com` |
| Deny | Status 「取得しませんでした。要求は送っていません。」; resource entries for `yataverse`: 0 |
| Cache seeded with the verified 失火責任法 bytes (1,931 bytes, sha256 `f224fad6…0f46d` = record), reload | Text shown with 「この端末に保存した全文です（SHA-256 照合済み）。」, 0 `yataverse` requests |
| One cached byte flipped, reload | Text not shown, cache entry deleted (count 0), button offered again |
| Allow | The gateway did not answer. After 90 s the page reported 「全文を取得できませんでした。」, cached nothing and re-enabled the button. The pane's network log did not list the pending request |

## Not covered

- A successful fetch from Yataverse: the texts are not published (AWAI-3317), `ipfs.yataverse.com` timed out from this Mac, and `kotobase.net` did not resolve.
- Android APK build and emulator run with the new `INTERNET` permission.
- Awai FS synchronization of the cache.
