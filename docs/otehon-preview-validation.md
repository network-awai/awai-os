# Otehon preview validation continuity

For the owned local preview, reuse the existing browser profile and the exact
origin `http://127.0.0.1:8906/`. Do not clear browser data, sign out, change the
port/hostname, or create a fresh browser profile for routine follow-up checks.
The currently authenticated tab should be retained as a deliverable.

The device key lives in IndexedDB and is non-exportable. The signed account
proof lives in localStorage and is verified again at startup. These are not
sessionStorage entries. Reusing authentication never reuses external-operation
consent: the shared broker continues to ask for each operation separately.

Account shows whether the proof is saved, its signed expiry, and browser
storage-eviction protection. The user can request protection there. A browser
may refuse it; refusal must remain visible and must not be called persistent
storage qualification. Browser data deletion, a different profile, or an
expired proof requires authentication again. Do not extend or rewrite a signed
expiry. A Passkey assertion is currently valid for at most 30 days.

Check continuity by reloading the OS and opening the exact origin in a new tab
in the same browser. Verify the authenticated shell remains open without a new
phone prompt. Do not copy raw browser storage, proofs, private keys, QR URLs,
signatures or account identifiers into reports or fixtures. A browser restart
is a separate observation; reload/new-tab success does not prove restart or
indefinite retention.

In the OS, choose **Soshiki**. It opens **稼働状況 Runtime** by default and reads
the same-origin static `fleet-state.json`, with no application API. Chart and
Bot Profiles are local organization-editing views, separate from the automatic
fleet projection. The standalone read-only view is `/soshiki-runtime/`.

At phone widths up to 640px, use the upper **App** selector. At tablet widths
641–1199px, use the sidebar; the auxiliary information panel is hidden so the
main view retains its width. Larger desktops keep the full side panel.
Observed browser checks: 390x844, 1024x768 and 1440x900, with no document or
main-view horizontal overflow. Always reset temporary test viewport overrides.
