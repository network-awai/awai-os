# Goal-only ledger, new state epoch (AWAI-2864)

The owner requested a new real `~/.itonami` after the old application-state path disappeared. The prior three-node ledger remains on levi/benjamin/joseph. Its local CA/root credentials were not recovered. Do not reset its membership, auth, claims or original jobs.

This separate Goal-only ledger uses new managed roots `~/.itonami/control-plane/etcd/awai-circle-goals-v1`, workspace `github/workspaces/codex/awai-2864-circle-ledger`, client/peer ports23989/23990 and the distinct Background label `network.awai.otehon.circle-ledger`. It uses the same pinned official etcd3.6.14 package and existing hardware/SSH identities. New node private keys remain on their hosts; local CA/root/worker keys stay in the new private application directory. No keys are committed.

The operator tools are adapted from the approved ledger's staged provisioner. They refuse existing deployment paths, mismatched identities, occupied ports and existing auth state. They are one-shot administration tools, not a Python Bot runtime or a Native fallback. A running process does not qualify cold boot, machine power loss or private-data replication. Root administration is separate from worker read-only enrollment rights and model/tool authority.

Initialize only a genuinely new deployment, preserving partial state on failure:

1. Capture fresh free-port/hardware observations in `.agent-output/circle-ledger/etcd-preflight.json`; compare with the independently verified machine inventory.
2. `bb nixos/otehon/circle-ledger/provision.clj prepare`
3. `bb nixos/otehon/circle-ledger/provision.clj pki`
4. `bb nixos/otehon/circle-ledger/provision.clj activate`
5. `bb nixos/otehon/circle-ledger/bootstrap-auth.clj`

Never rerun these stages blindly against a live deployment. The new cluster is exclusively for new Goal contribution job IDs; it does not make missing legacy conversations available or resolve old unknown outcomes. Original source cron, disabled/paused jobs, tool grants and the old services are preserved. The new work controller must explicitly bind each run to a live owning Issue and its Project/Initiative, pinned Goal/Role/profile/source schedule, daily cap, occurrence and artifact. Dialogue/proposal completion is not verified business-goal acceptance.
