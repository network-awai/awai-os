// Transport only: Nodes independently verify signatures and complete closure hashes.
// No R2: artifacts and manifests resolve through the yataverse.com protocol only
// (ADR docs/adr/20261123-no-r2-yataverse-only.md).
export const YATAVERSE_ORIGIN = "https://yataverse.com";

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

// CIDv1 = base32(0x01 0x55 0x12 0x20 || sha256_digest), raw codec, sha2-256, 32 bytes.
// The base32 form is lowercase RFC 4648 without padding plus the multibase 'b' prefix.
export function sha256HexToCid(hex) {
  if (!/^[a-f0-9]{64}$/.test(hex)) {
    throw new TypeError("sha256 hex must be 64 lowercase hex chars");
  }
  const digest = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    digest[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const bytes = new Uint8Array(36);
  bytes[0] = 0x01; // CIDv1
  bytes[1] = 0x55; // raw codec
  bytes[2] = 0x12; // sha2-256 multihash code
  bytes[3] = 0x20; // 32-byte digest
  bytes.set(digest, 4);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return `b${out}`;
}

export default {
  async fetch(request, env = {}) {
    if (!["GET", "HEAD"].includes(request.method)) {
      return new Response("Method not allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    const isManifest = /^\/(stable|canary)\/manifest\.json$/.test(path);
    const artifactMatch = path.match(
      /^\/(?:stable\/|canary\/)?([a-f0-9]{64})\.(nar-export|iso)$/,
    );
    if (!isManifest && !artifactMatch) {
      return new Response("Not found", { status: 404 });
    }

    let cid;
    if (isManifest) {
      const channel = path.split("/")[1]; // stable | canary
      cid =
        env[`MANIFEST_CID_${channel.toUpperCase()}`] ?? env.MANIFEST_CID ?? null;
      if (!cid) {
        return new Response("Not found", { status: 404 });
      }
    } else {
      cid = sha256HexToCid(artifactMatch[1]);
    }

    const upstreamUrl = `${YATAVERSE_ORIGIN}/ipfs/${encodeURIComponent(cid)}`;
    const upstreamHeaders = new Headers();
    if (request.headers.has("range")) {
      upstreamHeaders.set("Range", request.headers.get("range"));
    }
    if (request.headers.has("if-range")) {
      upstreamHeaders.set("If-Range", request.headers.get("if-range"));
    }

    let upstream;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "GET",
        headers: upstreamHeaders,
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
    // Preserve upstream 200/206 exactly; every other upstream outcome
    // (including 404) is 404 here, never a backend 500.
    if (upstream.status !== 200 && upstream.status !== 206) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      isManifest ? "application/json" : "application/octet-stream",
    );
    headers.set(
      "Cache-Control",
      isManifest
        ? "no-store"
        : "public, max-age=31536000, immutable",
    );
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Accept-Ranges", "bytes");
    const upstreamEtag = upstream.headers.get("etag");
    if (upstreamEtag) {
      headers.set("ETag", upstreamEtag);
    } else if (!isManifest) {
      // Artifact keys are the SHA-256 of the full content.
      headers.set("ETag", `"${artifactMatch[1]}"`);
    }
    const upstreamLength = upstream.headers.get("content-length");
    if (upstreamLength) {
      headers.set("Content-Length", upstreamLength);
    }
    const upstreamRange = upstream.headers.get("content-range");
    if (upstreamRange) {
      headers.set("Content-Range", upstreamRange);
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};
