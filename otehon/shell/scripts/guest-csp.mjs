// CSP hash sources for restricted guests (AWAI-3148).
// mountRestrictedClientApp loads a guest through srcdoc, and a srcdoc document
// inherits the embedding page's CSP. The shell keeps script-src/style-src
// 'self' (no 'unsafe-inline'); instead it allows exactly the inline script and
// style of each digest-pinned guest, plus the runtime's guest preamble, by hash.
// The guest still runs under its own connect-src 'none' and sandbox.
import { createHash } from "node:crypto";

const hash = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

function blocks(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1]);
}

export function guestPreamble(runtimeSource) {
  const match = runtimeSource.match(/const GUEST_PREAMBLE = '<script>(.*?)<\/script>';/);
  if (!match) throw Error("guest preamble not found in the pinned runtime");
  return match[1];
}

export function restrictedGuestHashes({ guestHtml, runtimeSource }) {
  const scripts = blocks(guestHtml, "script");
  const styles = blocks(guestHtml, "style");
  if (scripts.length !== 1 || styles.length !== 1) throw Error("guest must carry exactly one inline script and one inline style");
  const markup = guestHtml.replace(/<(script|style)>[\s\S]*?<\/\1>/g, "");
  if (/<script\b|<link\b|<[^>]+\son[a-z]+\s*=/i.test(markup)) throw Error("guest must not load external resources or use inline handlers");
  return {
    script: [hash(guestPreamble(runtimeSource)), hash(scripts[0])],
    style: [hash(styles[0])],
  };
}
