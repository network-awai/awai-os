# AWAI-531: Native Zstd admission probe, 2026-11-14 JST

This is a local compiler admission probe, not an RFC conformance test or Native
Forest I/O. Kotoba source revision is `5c75da8f399dfcc9c52c09c1e1729a127fa74262`;
its `lib/org.ietf.zstd/src/zstd/{bits,core,fse,huff,xxhash}.cljk` bytes are
pinned in `original.ksl`. The macOS arm64 Amu selfhost compiler artifact is the
same previously pinned and codesign-verified
`amu-full-root.macho` SHA-256
`369fc624cf5236b3f4a9dba2021bb057223bd1179736c882123506dee4fda082`.
The probe entry `corpus.kotoba` merely requests `zstd.core/compress`; it never
compiled, so it is not evidence of functioning compression.

Control: the previously successful 2 MiB Native logical-file corpus with KSL
SHA-256 `44a6be2f8aa86e14ddd3ea1dec5a6d7b244c51a1ef19a2f002f87195e64c7721`
compiled again with exit 0 when FD 3 opened the staging **parent** directory
containing both `src/` and the lock. An initial attempt erroneously opened
`src/` as FD 3 and got E6015 even for the control; that attempt is invalid as
a Zstd result. A separately attempted KSL2 control also returned E6015, so no
claim about KSL2 support is inferred from that attempt.

With the correct FD 3 and KSL1, the original `.cljk` source layout returned
`E6015 a multi-module compile needs pinned inputs`. Project root search in the
current seed source looks for `.kotoba`; E6015 alone does not identify a
precise compiler root cause. As a diagnostic only, the exact five source files
were copied without changing their bytes to `.kotoba` paths and locked by
`alias.ksl` (SHA-256
`69d8b424dca4767d3be775633a20dea53b3beee72fe6dfbf059f91747483eebe`).
The compiler then reached source parsing and refused
`E1005 unsupported reader syntax '\'' (byte 1965) in /src/zstd/huff.kotoba`;
that byte is in the `st'` identifier on source line 45. A second diagnostic
copy renamed `st'` to `st-prime` (only in scratch), locked by
`renamed-identifier.ksl` (SHA-256
`e5a26a7265c4d159c01099c378a871a06d88684bc485a72facfa0828dce4ee24`), and the
compiler next refused shorthand anonymous function syntax `#` at byte 2365,
source line 56. This was not a complete port or exhaustive compatibility audit.
The copied files are not checked in or adopted as canonical Native source.

For each directory, build a KSL1 manifest from the exact staged `src` files,
then execute (the lock SHA must match the selected manifest):

```sh
exec 3<.
env PATH=/nonexistent LANG=C "$PINNED_AMU" compile /src/corpus.kotoba --target aarch64-macos --output program.kseed --source-path /src --source-lock source.ksl --source-lock-sha256 "$LOCK_SHA256"
```

All probe inputs and outputs are retained in the task's `.agent-output`.
A correct port still needs typed Native implementations, bounded resource
behavior, Forest compatibility corpus and direct Native I/O/recovery tests.
