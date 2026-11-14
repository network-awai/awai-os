# Scoped two-Pack Linux guest readback, 2026-11-14

The real Otehon `publish-scoped!` fixture from `README-scoped-publication-20261114.md` was created on macOS using the pinned Forest writer: five blocks, including two deterministic random 600 KiB blocks, in one group with two physical Packs. Only its 1.2 MiB store, current adapter/probe sources and vendor source dependencies were copied into a new task-owned Lima VZ Linux aarch64 guest directory. The JVM jars came from the retained earlier signed-policy guest fixture. The transferred archive SHA-256 was `852685b9eff6dd4b28671653750580ab986e4478275e5b5e8a4d8e48db5bf60a`. Linux tar warned about macOS extended attributes; the regular files matched a SHA-256 manifest before and after the test.

The dedicated guest was synced and stopped/started through Lima. Boot ID changed from `5c1f25aa-2f11-4d1a-8e49-98742c305601` to `370c8ec1-f5df-41f8-a69d-a0113c235a01`. The first task data read after restart, before scanning the store hashes, ran the actual `scoped-read` proof in a fresh JVM with a nonexistent writer executable. It verified the named ref, both physical Packs and the bytes/CIDs of all five blocks:

```clojure
{:blocks 5, :packs 2, :fresh-process true, :pass true}
```

A subsequent separate process used a copied guest fixture with one real Forest file withheld; it failed with `:missing-forest`. Withheld file SHA-256 `15474827280e33561b36933b82c177be94fb805457484e99a0cd017927358a3f`; the original store manifest still matched. The pre/post stdout SHA-256 was `51d1e93edf96a5cba5df0374f9e5a612f788860df0d26c45c84709273c95fc6d`; input manifest SHA-256 `1a227c65d2a5da9265b373f77548e93295210d821dcf04a2c0f2ad5f9d7e0989`. Guest runtime: Linux `7.3.0-9-generic`, aarch64, OpenJDK `21.0.13.0.3`, Clojure 1.12.5. Boot IDs, result, manifest and missing-error report are retained in guest and `.agent-output/scoped-guest-cache-evidence-01`; no data was deleted.

This proves fresh-JVM readback of a **host-written** scoped group after the guest OS page cache was lost. The host/storage cache was not controlled, and guest-side creation, Native, physical power loss, signed query/receipt integration, independent fencing and GiB scale are not established. The `reboot-check.nix` gate in `README-scoped-guest-reboot-20261114.md` separately attempts guest-side creation on NixOS; its exact-head CI was still running when this evidence was recorded. This test used the JVM as a one-off hosted reference, not a new CI or Native fallback.
