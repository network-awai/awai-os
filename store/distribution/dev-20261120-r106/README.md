# Itonami Store public development catalog r106

The catalog uses the existing development catalog signature and immutable APK
pins. Itonami 0.1.2 (1002) and standalone Yotei 0.2.1 (2001) add the approved
launcher crests. Both APKs include arm64-v8a and x86_64.

- Itonami source: Awai OS PR #325, merged at `a8338d17`.
- Yotei source: app-yotei PR #5, merged at `383ac7be`.
- Both exact APKs were installed over their existing versions on a physical
  moto g05 with matching signers and unchanged package UID/data paths. The
  Awai launcher showed the new crests, and tapping each launched its app.
- Android 35 ARM emulator: an event in the previous public Yotei v4 APK survived
  the explicit import and relaunch after backgrounding.
- The existing Torihiki, Torihiki Bot, Deai, and Registry Assoc catalog entries
  retain their pinned APKs. The catalog JSON has the exact APK digests.
- Distribution uses the development key, not a production signing rail. The
  x86_64 payload is packaged; its runtime was not exercised by the Moto test.

Tracking: [AWAI-3595](https://linear.app/kotobalabs/issue/AWAI-3595).
