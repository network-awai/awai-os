// Product availability, not ownership proof or a signing authority. Unknown
// balances stay unknown; Passkey login does not create chain accounts here.
import { accountAddress } from "./trust.js";

export function walletView(account) {
  const address = accountAddress(account?.accountDid);
  return {
    identity: account?.method === "passkey" ? "passkey" : account?.method === "wallet" ? "wallet" : "unknown",
    assets: [
      { id: "evm", title: "EVM", currency: "ETH", status: address ? "read-available" : "not-connected", address },
      { id: "bitcoin", title: "Bitcoin", currency: "BTC", status: "planned", address: null },
      { id: "solana", title: "Solana", currency: "SOL", status: "planned", address: null },
    ],
  };
}
