# Owning-main dependency landing and review (2026-11-10)

The initial measurement record in this directory used apex `a9c676f`, then on
open stacked PR #180. Review now separates the source dependency from #147's
remaining daemon/remote/auth changes:

1. #180 gained an isolated Nix-pinned Otehon codec job. Exact head
   `0048e6d7fdfdc01184ba350c79dbcd677fe82d83` passed
   [CI 42780545668](https://github.com/network-awai/network-awai-apex/actions/runs/42780545668),
   then merged into #147's branch as `902d315a728298c31414845f2ff386d55b89135e`.
2. Focused [apex #181](https://github.com/network-awai/network-awai-apex/pull/181)
   extracted only codec/tests, their interoperability evidence and Otehon CI
   from a fresh main. Exact head `24f129557a707761afddd94bec64a3adfed8fcf3`
   passed [CI 42780861576](https://github.com/network-awai/network-awai-apex/actions/runs/42780861576)
   and landed on owning main as `df68aad6101d7bf9587ea48bc30946b834aa4ba2`.
3. The consumer manifest now pins that main merge. `git show
   df68aad6101d7bf9587ea48bc30946b834aa4ba2:src/awai/fs/car.cljc | cmp -
   <vendored-module>` passes. SHA-256 is unchanged:
   `6c11cf9d1022b628fce73c2ac8de589667f9d277e0ae69ad52742fc9bebf148b`.

There is no runtime-source change in this repin. The original code hashes,
crash/empty-cache measurements and independent oracle outputs remain evidence
for the same bytes; the initial manifest hash in `source-sha256.txt` belongs
to the historical pre-landing manifest. Final commit/CI links are recorded in
PR #82 and AWAI-532 rather than rewriting the earlier measurements.

Review covered CAR-before-metadata publication, writer exclusion, root commit
selection, missing/corrupt CAR refusal, immutable input copying, derived-index
reconstruction, full/range reads, resource bounds, opt-in packaging and native
separation. No blocking finding remained in #82's bounded profile. Local
17 tests / 70 assertions pass again. The source codec's affected CAR/path/
UnixFS/GraphSync/ADL consumers also pass 24 tests / 164 assertions; its isolated
CI is 12 tests / 96 assertions with malformed-link negative controls.

#147 itself remains open/unmerged to main. Its local worktree and operational
daemon/data are untouched; no native, optional-index, power-loss, remote/B2 or
production qualification is inferred from these merges. AWAI-532 stays
In Progress for the broader hardware/tiered-storage acceptance work.
