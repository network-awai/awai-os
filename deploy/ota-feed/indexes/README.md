`indexes.json` is the audit copy of the Worker index. Each key is
`{device}/{installed-build}` and maps to an Updater offer array. An empty array
withdraws the offer. Generate both copies with [the publish command](../README.md#publish-an-offer).
