// These pins are supplied by the trusted installer, never by the guest. Until
// production pins and a verified package exist, Saifu cannot be mounted.
import { mountRestrictedClientApp, verifyClientArtifact, verifySignedClientDescriptor } from "../vendor/kotoba-client-runtime.js";
import { createSaifuHostBroker } from "./saifu-host.js";

function keysExactly(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isSupportedDescriptor(runtime) {
  if (runtime.entry !== "saifu.html" || runtime.profile !== "trusted-page-v1"
      || runtime["local-state"]?.adapter !== "memory" || runtime["local-state"]?.schema !== "awai.saifu"
      || runtime["local-state"]?.version !== 1 || (runtime.workers && runtime.workers.length !== 0)
      || runtime.operations.length !== 1) return false;
  const op = runtime.operations[0];
  return keysExactly(op, ["capability", "service", "operation", "consent", "data-categories", "endpoint"])
    && op.capability === "awai-wallet" && op.service === "optimism-public-rpc"
    && op.operation === "read-eth-balance" && op.consent === "each-operation"
    && Array.isArray(op["data-categories"]) && op["data-categories"].length === 1
    && op["data-categories"][0] === "wallet-address"
    && keysExactly(op.endpoint, ["origin", "method", "path"])
    && op.endpoint.origin === "https://mainnet.optimism.io" && op.endpoint.method === "POST" && op.endpoint.path === "/";
}

export async function admitSaifuPackage({ descriptorBytes, signature, publisherKey, appBytes, pins }) {
  if (!keysExactly(pins, ["publisherKey", "revision", "descriptorSha256", "appSha256", "appMaxBytes"])) {
    throw new Error("saifu-trust-pins-required");
  }
  // Snapshot pins and bytes before awaiting signature verification: neither a
  // mutable installer buffer nor a later pin change may alter what is admitted.
  const trusted = Object.freeze({ ...pins });
  if (!(descriptorBytes instanceof Uint8Array) || descriptorBytes.length > 262144
      || !(appBytes instanceof Uint8Array) || !Number.isSafeInteger(trusted.appMaxBytes)
      || trusted.appMaxBytes < 1 || trusted.appMaxBytes > 8388608 || appBytes.length > trusted.appMaxBytes) {
    throw new Error("saifu-package-invalid-size");
  }
  const descriptorSnapshot = new Uint8Array(descriptorBytes);
  const appSnapshot = new Uint8Array(appBytes);
  const descriptor = await verifySignedClientDescriptor({
    bytes: descriptorSnapshot, signature, publicKey: publisherKey, pinnedPublicKey: trusted.publisherKey,
    revision: trusted.revision, digest: trusted.descriptorSha256, requestedCapabilities: ["awai-wallet"], appOrigins: [],
  });
  if (!isSupportedDescriptor(descriptor.runtime)) throw new Error("saifu-descriptor-not-supported");
  const artifact = await verifyClientArtifact(appSnapshot, {
    revision: trusted.revision, sha256: trusted.appSha256, "max-bytes": trusted.appMaxBytes,
  });
  return Object.freeze({ descriptor, artifact });
}

export async function mountSaifuPackage({ descriptorBytes, signature, publisherKey, appBytes, pins, container, broker, getScore }) {
  const { artifact } = await admitSaifuPackage({ descriptorBytes, signature, publisherKey, appBytes, pins });
  return mountRestrictedClientApp({ artifact, container, broker: createSaifuHostBroker(broker, { getScore }) });
}
