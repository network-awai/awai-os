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
  const descriptor = await verifySignedClientDescriptor({
    bytes: descriptorBytes, signature, publicKey: publisherKey, pinnedPublicKey: pins.publisherKey,
    revision: pins.revision, digest: pins.descriptorSha256, requestedCapabilities: ["awai-wallet"], appOrigins: [],
  });
  if (!isSupportedDescriptor(descriptor.runtime)) throw new Error("saifu-descriptor-not-supported");
  const artifact = await verifyClientArtifact(appBytes, {
    revision: pins.revision, sha256: pins.appSha256, "max-bytes": pins.appMaxBytes,
  });
  return Object.freeze({ descriptor, artifact });
}

export async function mountSaifuPackage({ descriptorBytes, signature, publisherKey, appBytes, pins, container, broker, getScore }) {
  const { artifact } = await admitSaifuPackage({ descriptorBytes, signature, publisherKey, appBytes, pins });
  return mountRestrictedClientApp({ artifact, container, broker: createSaifuHostBroker(broker, { getScore }) });
}
