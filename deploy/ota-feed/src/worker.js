import { INDEXES } from "./indexes.js";

const INDEX = /^\/v1\/pc\/pilot\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9._-]{1,128})\/builds\.json$/;
const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export default {
  fetch(request) {
    const head = request.method === "HEAD";
    if (!head && request.method !== "GET") {
      return new Response('{"error":"method-not-allowed"}', {
        status: 405,
        headers: { ...JSON_HEADERS, allow: "GET, HEAD" },
      });
    }
    const url = new URL(request.url);
    const match = INDEX.exec(url.pathname);
    if (!match || url.search) {
      return new Response(head ? null : '{"error":"not-found"}', {
        status: 404,
        headers: JSON_HEADERS,
      });
    }
    const offers = INDEXES[`${match[1]}/${match[2]}`] ?? [];
    return new Response(head ? null : JSON.stringify(offers), { headers: JSON_HEADERS });
  },
};
