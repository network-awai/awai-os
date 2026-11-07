// Checks a relay against the rules, using the verifier Otehon runs. usage: check-relay.mjs <origin>
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  checksumAddress, compressP256, createLinkRequest, openResponse, p256Did, sealResponse, siweMessage, verifyLink,
} from "../../nixos/otehon/shell/src/identity/link.js";
import { p256 } from "@noble/curves/nist.js";

const origin = process.argv[2];
let failed = 0;
const check = (name, ok) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const topic = () => randomBytes(16).toString("hex");
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const encoder = new TextEncoder();

// Reads a stream until it gives a message or the wait ends.
async function firstMessage(path, ms) {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), ms);
  try {
    const response = await fetch(`${origin}/${path}/json`, { signal: control.signal });
    let buffer = "";
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      for (const text of buffer.split("\n").slice(0, -1)) {
        const event = JSON.parse(text);
        if (event.event === "message") return event.message;
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    control.abort();
  }
  return null;
}

// The whole link, through this relay.
const secret = secp256k1.utils.randomSecretKey();
const address = checksumAddress(`0x${hex(keccak_256(secp256k1.getPublicKey(secret, false).slice(1))).slice(-40)}`);
const did = p256Did(compressP256(p256.getPublicKey(p256.utils.randomSecretKey(), false)));
const { request, privateKey } = await createLinkRequest(did);
const waiting = firstMessage(request.topic, 15000);
await new Promise((resolve) => setTimeout(resolve, 1000));

const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 86400000).toISOString();
const message = siweMessage({ address, chainId: 1, device: did, nonce: request.nonce, issuedAt, expiresAt });
const body = encoder.encode(message);
const hash = keccak_256(Uint8Array.from([...encoder.encode(`\x19Ethereum Signed Message:\n${body.length}`), ...body]));
const recovered = secp256k1.sign(hash, secret, { prehash: false, format: "recovered" });
const signature = `0x${hex(recovered.slice(1))}${(27 + recovered[0]).toString(16)}`;
const sealed = await sealResponse(request, { method: "wallet", address, chainId: 1, issuedAt, expiresAt, signature });
const posted = await fetch(`${origin}/${request.topic}`, { method: "POST", headers: { "content-type": "text/plain" }, body: sealed });
check(`post is accepted (${posted.status})`, posted.ok);
check("post allows any origin", posted.headers.get("access-control-allow-origin") === "*");
const received = await waiting;
check("a waiting device receives it", received === sealed);
const opened = await openResponse(request, privateKey, received);
check("Otehon accepts the link", verifyLink({ request, response: opened, deviceDid: did }).accountDid === `did:pkh:eip155:1:${address}`);
check("a device that connects later still receives it", (await firstMessage(request.topic, 8000)) === sealed);

// Negative controls.
const quiet = firstMessage(topic(), 2500);
check("another topic receives nothing", (await quiet) === null);
const status = async (path, init) => (await fetch(`${origin}${path}`, init)).status;
check("a short topic is refused", (await status("/abc", { method: "POST", body: "x" })) === 404);
check("an uppercase topic is refused", (await status(`/${topic().toUpperCase()}`, { method: "POST", body: "x" })) === 404);
check("the root is refused", (await status("/")) === 404);
check("a GET on the post route is refused", (await status(`/${topic()}`)) === 405);
check("a POST on the stream route is refused", (await status(`/${topic()}/json`, { method: "POST", body: "x" })) === 405);
check("an empty body is refused", (await status(`/${topic()}`, { method: "POST", body: "" })) === 400);
check("an oversized body is refused", (await status(`/${topic()}`, { method: "POST", body: "x".repeat(4097) })) === 413);
const flooded = topic();
for (let i = 0; i < 8; i += 1) await status(`/${flooded}`, { method: "POST", body: "x" });
check("a flooded topic is refused", (await status(`/${flooded}`, { method: "POST", body: "x" })) === 429);
const preflight = await fetch(`${origin}/${topic()}`, { method: "OPTIONS" });
check("a preflight is answered", preflight.status === 204);

if (failed) {
  console.log(`FAILED ${failed}`);
  process.exit(1);
}
console.log("PASS");
