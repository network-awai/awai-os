# AWAI-2792 UI verification — 2026-11-11

Base: e2c3f6a (AWAI-2791, PR #92). Candidate: codex/awai-2792-soshiki-ux.

Reagent/Hiccup renders SVG circles instead of rectangular nested cards. Garden styles retain Asa/Hiru/Yoru. Sibling circles have equal radii; their area does not represent membership or workload. Small/deep nodes remain reachable through child navigation and the role list. Editing is collapsed initially.

Validation on this candidate:

- `npm test --prefix nixos/otehon/shell`: 60/60 pass, including CLJS/JS extern property coverage.
- `npm run build --prefix nixos/otehon/shell`: file/kiosk release success.
- `OTEHON_HTTP=1 npm run build --prefix nixos/otehon/shell`: loopback preview release success.
- Both shell/link Closure builds reported 0 compiler warnings. Garden and JVM printed upstream name/deprecation warnings.
- Dedicated headless Chrome/CDP (1440×1100 and 390×844), random software wallet, synthetic local state: circle rendering, role details, self assignment, circle zoom, breadcrumb return, chart/list, open-role filter, circle-name search, no-results and reset, keyboard Enter activation, focus into details and return on close, dark theme, no horizontal document overflow.
- Dense fixture: 62 child circles remain accessible even when SVG labels would be too small. Multiple-root selector renders. No uncaught browser exceptions in these checks.
- `git diff --check`: clean.

Images: desktop.png (seed diagram), dark.png (Yoru after synthetic assignment), mobile.png (390px diagram). These are local synthetic browser observations, not real account/provider or Nix/physical-device qualification.

No broker/descriptor changes or production deployment. Existing 8901 preview is preserved; this worktree's HTTP preview uses 8902. Nix image hash placeholders inherited from AWAI-2791 remain outside this UI task.

Runtime binding: issue 3be182f3-b833-46e9-8977-4ba30cbbea9d / thread 01a1c9f2-e2ba-79c2-a37f-d5c7c348a18a / base e2c3f6a. Provider OpenAI; model GPT-6, exact variant and reasoning setting unknown. Forecast and observed input/cache-read/cache-write/output/reasoning tokens unknown because complete issue-attributed telemetry is unavailable. No zero usage or individual velocity is inferred. Source/browser unit completed; merge, deployment, and physical-device milestones remain separate.
