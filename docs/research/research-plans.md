# Awai Network research plans

The plans share the [evidence map](evidence-map.md). Hypotheses and methods below are proposed work. The cited observations define the starting configurations and the limits of current evidence.

## Agent delegation and robotics in a social model of work

**Problem.** Awai Network brings together an Android device OS, a Store, dapps, and an agent fleet. The social question is whether people can delegate routine work while retaining control over decisions, approvals, and the benefits of time saved. A reduction in the visible steps of a workflow could leave someone else doing equivalent review, recovery, or maintenance. Robotics extends that question to physical work, where operator intervention and recovery must be counted too. The existing device and distribution records establish a platform baseline for that inquiry. The social and robotics outcomes remain open.

**Research questions**

- Which routine tasks can agents take over while leaving participants in control of consequential actions?
- Who saves time and who absorbs oversight, correction, maintenance, and exception handling?
- Which outcomes carry over to a bounded robotics task once an approved device adapter exists?

**Hypotheses and method**

| Hypothesis | Proposed measurement |
| --- | --- |
| Agent assistance reduces total active human time for a defined routine workflow at comparable completion quality. | On a supported dapp with a reversible task, compare manual and agent-assisted runs with the same input and rubric. Counterbalance task order. Record active time by role, approvals, interventions, corrections, retries, and independently scored task quality. Include operator maintenance and recovery attributable to each run. |
| A bounded robotics workflow preserves the same human veto and reduces active labor once setup and recovery are counted. | After an authorized robotics adapter and test task exist, exercise the same approved task manually and with an agent in a supervised test area. Record task completion, total active time by role, corrections, veto outcomes, and recovery. Check the software-only workflow first and keep the physical results separate. |

**Existing evidence.** EMPTY for labor, social, and robotics outcomes. `BOOT-LAN`, `STORE-JOB`, and `OTA-FEED` contextualize the device and software distribution environment.

**Work required.** Select a supported dapp task and fleet configuration, define participant consent and task-quality criteria, and add minimal per-task timing and intervention records. The robotics study depends on an approved adapter, a supervised fixture, and a repeatable task with a tested stop procedure.

**Expected contribution.** A method for assessing who gains discretionary time from delegation and who performs the remaining work.

**Risks.** Learning effects, hidden operator labor, selection bias, exposure of private task data, and treating workflow time savings as evidence of broader social liberation.

**What would falsify this.** Equivalent or higher total human time, worse completion quality, or a transfer of the burden to another role defeats the labor-saving claim for that workflow. A task continuing after a valid veto or requiring as much human labor as manual execution defeats the corresponding robotics claim.

## Fail-closed controls for Awai OS installation and updates

**Problem.** Awai OS has distinct paths for disk installation, system OTA, and Store app updates. Each makes decisions from different inputs, including disk identity and free space, update signatures and slot state, and an app's declared operations. Existing records show refusals in a physical audit and in virtual environments. The research question is how consistently those decisions protect state across supported configurations and through restart.

**Research questions**

- Do disagreements in disk identity or available space stop installation before protected writes?
- Do disallowed OTA payloads and Store updates leave installed state intact?

**Hypotheses and method**

| Hypothesis | Proposed measurement |
| --- | --- |
| Installer preflight refuses a mismatched or insufficient target and preserves protected regions. | Repeat the reviewed installer guard suite and replay the audited GPT with disposable disk images. Record the planner result, write ranges, and before/after digests. With owner authorization, qualify the selected second disk separately and read back protected GPT and partition witnesses. |
| Patched OTA and Store policy reject disallowed transitions while allowing eligible controls. | On isolated KVM guests, pair a valid signed test payload with older and wrong-key controls. Read back active slot, boot completion, build ID, and protected hashes after restart. On an Android emulator, pair an eligible update with candidates that add a permission, omit operations, or expand their declaration. Read back policy reason, installed version, and application state. Keep physical release qualification separate. |

**Existing evidence.** `GPT-REFUSAL`, `INSTALL-REVIEW`, `OTA-REF-LIMIT`, `OTA-PC`, `OTA-DELTA`, `OTA-REJECT`, and `STORE-DECLARATION`. The `STORE-TEXT` and `STORE-REFUSAL` pair stays in the evidence map pending reconciliation and is excluded from draft claims.

**Work required.** Pin harness revisions, disk and payload digests, and test-key fixtures. Repeat the paired controls and capture independent reboot and version readbacks. `INSTALL-PC` and `OTA-ENDTOEND` require authorized physical qualification.

**Expected contribution.** A comparison of fail-closed behavior across disk planning, OS updates, and app updates, with a record of the state each layer preserves.

**Risks.** Test-key and virtual-device results have limited physical release applicability. Hash witnesses cover their recorded ranges. Power interruption and recovery require separate trials.

**What would falsify this.** A write to protected regions after a preflight failure falsifies the installer hypothesis. Accepting a disallowed update or changing protected state after refusal falsifies the update hypothesis. Refusal of the matched eligible control also defeats the proposed behavior.

## Trust models for artifact distribution and delegated operations

**Problem.** Awai Network uses distinct authorities for publisher signatures, payload transport, and consent to external operations. Store and OTA records already show that a successful fetch, an ETag, and content-addressed storage expose different information. The research aim is to determine which checks let a device verify artifact provenance and which additional checks are needed when a dapp or bot requests authority to act.

**Research questions**

- Which trust decisions can clients reproduce from signed metadata and the retrieved bytes when the transport redirects or changes?
- Can a reviewer trace an external operation to the exact approved principal, operation, and request scope?

**Hypotheses and method**

| Hypothesis | Proposed measurement |
| --- | --- |
| Signed pins and client verification keep artifact acceptance bound to the authorized bytes across the supported transport paths. | Repeat the Store pointer fixtures with valid, stale, wrong-key, and altered inputs. Run publisher range and full-body readback against a digest-pinned asset and use a local redirect fixture with deliberately differing bytes. For streaming OTA capture UpdateEngine's payload verification separately from full-ZIP verification. Compare verified artifact digest, Range status, and client accept/refuse result. |
| A bounded consent grant permits the authorized workflow and fails closed when the request or actor binding changes. | With the owning broker and an approved dapp or bot fixture, record the consent receipt and operation outcome for a matched request. Repeat with changed actor, operation, or request scope and an expired grant in an isolated environment. Inspect broker and endpoint logs for operation execution and keep private data out of the research record. |

**Existing evidence.** `BOOT-PINS`, `BOOT-INPUT`, `STORE-PINS`, `STORE-BODY`, `STORE-JOB`, `OTA-DESIGN`, `OTA-RANGE`, `OTA-ETAG`, `OTA-FEED`, `YATA-RAW`, and `YATA-CAR` support the artifact and transport baseline. `STORE-DECLARATION` supplies an app-update policy observation. Direct evidence for the delegated-operation hypothesis remains EMPTY.

**Work required.** Record the accepted signer and revocation state for each tested channel. Capture authorized and denied broker traces bound to the same workflow, then obtain independent readback from the operation owner.

**Expected contribution.** A model that connects observable evidence to publisher identity, byte integrity, and authority to act.

**Risks.** Key rotation, mutable asset references, expiring redirects, and partial logs can undermine repeatability. A transport test does not establish consent or key custody.

**What would falsify this.** Acceptance of modified bytes under the original signed pin or rejection of the matched valid control defeats the artifact hypothesis for that path. An endpoint executing a request with a mismatched or expired grant, or refusing the matched valid request, defeats the delegated-operation hypothesis for the tested workflow.
