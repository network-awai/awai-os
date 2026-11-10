// The restricted Saifu guest can request one read; the host chooses the endpoint,
// method and body and delegates consent to the shared broker on every operation.
import { requestWalletBalance } from "./runtime.js";

function hasOnlyKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function createSaifuHostBroker(broker) {
  return Object.freeze({
    async invoke(selector, payload, options) {
      if (!hasOnlyKeys(selector, ["capability", "service", "operation"])
          || selector.capability !== "awai-wallet" || selector.service !== "optimism-public-rpc"
          || selector.operation !== "read-eth-balance" || !hasOnlyKeys(payload, ["address"])) {
        throw new Error("saifu-operation-not-supported");
      }
      return requestWalletBalance(broker, payload.address, options);
    },
  });
}
