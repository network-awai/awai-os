// Preloaded with --import: replaces fetch with an in-memory Vultr node-pool API backed by $FAKE_VKE_STATE.
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.FAKE_VKE_STATE;
globalThis.fetch = async (url, { method = "GET", body } = {}) => {
  const state = JSON.parse(readFileSync(file, "utf8"));
  const reply = (status, value) => new Response(value === undefined ? "" : JSON.stringify(value), { status });
  if (!String(url).startsWith("https://api.vultr.com/v2/kubernetes/clusters/")) return reply(500);
  if (method === "GET") return reply(200, { node_pools: state.pools, meta: { links: { next: "" } } });
  if (method === "POST") {
    const request = JSON.parse(body);
    state.pools.push({ ...request, id: "pool-id-1", labels: request.labels });
    state.created = request;
  } else if (method === "DELETE") {
    state.pools = state.pools.filter((pool) => !String(url).endsWith(`/${pool.id}`));
    state.deleted = (state.deleted ?? 0) + 1;
  }
  writeFileSync(file, JSON.stringify(state));
  return reply(method === "POST" ? 201 : 204);
};
