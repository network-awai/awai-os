# Meiji session closeout — 2026-11-16

Tracking: AWAI-195, AWAI-2795, AWAI-2820; session
`01a1c830-dd85-7993-847b-c183174d6e38`.

## Source delivery

Awai OS integration PR [152](https://github.com/network-awai/awai-os/pull/152)
contains parent Circle/Soshiki PR 95 and exact Meiji PR 144 source history,
resolved against current main. Main's reliability UI, installer, network setup,
non-destructive account loading and shared client-runtime consent are retained.
The Soshiki browser build also keeps the existing `process` resolver exclusion.
Session proof documents remain dated observations, not current fleet liveness.

Apex WebDAV prefix-index PR
[243](https://github.com/network-awai/network-awai-apex/pull/243) merged to main
as `b72a5e94f21d4ef63a4ff2872311ecc189652a4d` at 2026-11-16T10:41:50Z.
Legacy upload isolation and the explicitly approved etcd ADR are integrated
separately in apex PR 244; unrelated stale branch ancestry is excluded.

## Verified boundaries

Two deterministic Physics Bots completed on levi/benjamin Meiji guests with
original cron phases, retained history, two-replica/AwaiFS readback and Linear
result confirmation. Sending each completed slot to both owners refused all
four duplicate invocations. Owner-side scheduling remains a dependency.

The encrypted custody envelope was fetched from the B2 snapshot/Pack path with
zero local Pack reads and zero remote writes. Twelve chunk digests and the full
ciphertext digest matched, then 23 files decrypted using the existing wrapping
Keychain. Replacement-device recovery and loss of that wrapping key remain
unqualified. Existing node trust still includes the original CA.

One explicitly bound jacob Kapitsa review consumed 409 prompt and 512 completion
tokens (921 total; cache-read 0 is an input subset). It hit its output limit and
is displayed as a draft. This is not another completed analysis unit. Coding
session provider counters and comparable individual velocity remain unknown /
shared-unallocated. Do not add repeated service-log counters together.

## Remaining acceptance

- AWAI-2994: real production VM start/stop/resource limits through Tauri Soshiki.
  The tested lifecycle controls currently operate only a disposable fixture.
- AWAI-2809 and its existing children: remaining Bot/App/executor/grant rollout;
  no claim that all 899 registrations or the historical 311 held Bots are stable.
- AWAI-2777: fault integration and sustained soak; independent device custody
  recovery and all-platform release also remain separate qualification work.
- Preserve original cron, explicit pauses and Linear Cycle fields. Unknown or
  admitted outcomes never authorize retry or reassignment.

## Preservation and resume

Keep the original Meiji task worktree while its native debug app is running and
its unique image/test evidence is present. Keep the shared Circle worktree:
active report publishers and the desktop still reference its static report path.
The integration and apex worktrees retain their `.agent-output` evidence until
independent process checks and evidence archival complete. The storage lifecycle
tool's process scan timed out; its configured 40 GiB free-space admission floor
also exceeds the observed approximately 31 GiB available. Do not skip these
checks or discard evidence to make collection pass. The forest `west` entrypoint
has a missing executable target, so forest-wide orphan status is unknown.

Source merge, active immutable runtime capsules, device acceptance and cleanup
are separate records. Resume runtime work from the linked acceptance issues,
using the existing scoped service configurations and ledger cursors.
