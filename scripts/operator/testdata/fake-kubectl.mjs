#!/usr/bin/env node
// Minimal kubectl stand-in for vke-release-pool.mjs CLI tests. State lives in $FAKE_VKE_STATE.
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.FAKE_VKE_STATE;
const state = JSON.parse(readFileSync(file, "utf8"));
const save = () => writeFileSync(file, JSON.stringify(state));
const raw = process.argv.slice(2);
const args = raw.filter((arg, index) => arg !== "--kubeconfig" && raw[index - 1] !== "--kubeconfig" &&
  !arg.startsWith("--request-timeout"));
const output = args.includes("-o") ? args[args.indexOf("-o") + 1] : null;
const words = args.filter((arg, index) => arg !== "-o" && args[index - 1] !== "-o");
const text = words.join(" ");
const items = (list) => JSON.stringify({ items: list });
const ns = "awai-pc-release-build";
const tatara = [
  { metadata: { name: "tatara-system-1", labels: { "vke.vultr.com/node-pool": "tatara-system", "tatara.network/role": "system" } } },
  { metadata: { name: "tatara-runner-1", labels: { "vke.vultr.com/node-pool": "tatara-ci-runners-1c", "tatara.network/role": "runner" } } },
];
const releaseNodes = () => state.pools.map((pool) => ({ metadata: { name: `${pool.label}-node`, labels: {
  "vke.vultr.com/node-pool": pool.label, "vke.vultr.com/node-pool-id": pool.id, "node.kubernetes.io/instance-type": pool.plan } },
  status: { conditions: [{ type: "Ready", status: "True" }] } }));
state.calls.push(text); save();
if (text === "config view --minify") { process.stdout.write("https://3f1932a3-896f-417a-a1e4-9d0ef6b57711.vultr-k8s.com:6443"); }
else if (text === "get nodes") { process.stdout.write(items([...tatara, ...releaseNodes()])); }
else if (text.startsWith("get nodes -l vke.vultr.com/node-pool=")) {
  const label = text.split("=")[1];
  process.stdout.write(items(releaseNodes().filter((node) => node.metadata.labels["vke.vultr.com/node-pool"] === label)));
} else if (text === `get namespace ${ns} --ignore-not-found`) {
  if (state.namespace) process.stdout.write(output === "json" ? JSON.stringify(state.namespace) : state.namespace.metadata.annotations["awai.network/vke-run"]);
} else if (text === `get namespace ${ns}`) {
  if (!state.namespace) process.exit(1);
  process.stdout.write(JSON.stringify(state.namespace));
} else if (text === "create -f -") {
  const body = JSON.parse(readFileSync(0, "utf8"));
  if (state.namespace) process.exit(1);
  state.namespace = { ...body, metadata: { ...body.metadata, uid: "ns-uid-1" } }; save();
  process.stdout.write(JSON.stringify(state.namespace));
} else if (text.startsWith("taint nodes ")) { state.tainted = true; save(); }
else if (text === `-n ${ns} get jobs`) { process.stdout.write(items(state.jobs)); }
else if (text === `-n ${ns} get pods`) { process.stdout.write(items(state.jobs.map(() => ({ metadata: { namespace: ns, name: "p" }, status: { phase: "Running" } })))); }
else if (text === "get pods -A") { process.stdout.write(items([])); }
else if (text === `-n ${ns} get pvc`) { process.stdout.write(items([])); }
else if (text.startsWith(`-n ${ns} delete jobs --all`)) { state.jobs = []; save(); }
else if (text === `delete --raw /api/v1/namespaces/${ns} -f -`) { state.namespace = null; save(); }
else { console.error(`fake kubectl: unexpected ${text}`); process.exit(2); }
