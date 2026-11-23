# indexes/ — audit mirror of src/indexes.js

This directory holds `indexes.json`, a plain-JSON mirror of the mutable
feed indexes embedded in the Worker (`../src/indexes.js`). Both files are
generated deterministically (keys sorted) by
`../scripts/publish-index.py`, which reuses
`android/desktop/pc-ab-device/updater-feed.py make-index`. Do not edit
either file by hand: re-run the publish script.
