// Build-time trusted pins and a signed package are separate inputs. The
// bundle is verified before its script is allowed by the host's static CSP.
import { admitSaifuPackage } from "./saifu-package.js";

function decodeBase64(text) {
  if (typeof text !== "string" || text.length > 12000000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) {
    throw new Error("saifu-invalid-base64");
  }
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function unpackSaifuBundle(bundle, pins) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)
      || Object.keys(bundle).sort().join(",") !== "app,descriptor,publisherKey,signature") {
    throw new Error("saifu-invalid-bundle");
  }
  return { descriptorBytes: decodeBase64(bundle.descriptor), appBytes: decodeBase64(bundle.app),
    publisherKey: bundle.publisherKey, signature: bundle.signature, pins };
}

export async function verifySaifuBundle(bundle, pins) {
  const unpacked = unpackSaifuBundle(bundle, pins);
  const admitted = await admitSaifuPackage(unpacked);
  const html = await admitted.artifact.blob.text();
  const prefix = "<style>";
  const middle = '</style><div id="saifu"></div><script>';
  const suffix = "</script>";
  const split = html.indexOf(middle);
  if (!html.startsWith(prefix) || split < prefix.length || !html.endsWith(suffix)) throw new Error("saifu-invalid-html-envelope");
  const style = html.slice(prefix.length, split);
  const script = html.slice(split + middle.length, -suffix.length);
  if (!style || !script || /<\/style/i.test(style) || /<\/script/i.test(script)) throw new Error("saifu-invalid-html-envelope");
  return { unpacked, script, style };
}

export async function saifuContentCsp(bundle, pins) {
  const { script, style } = await verifySaifuBundle(bundle, pins);
  const hash = async (value) => {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
    return `'sha256-${btoa(String.fromCharCode(...bytes))}'`;
  };
  return { script: await hash(script), style: await hash(style) };
}
