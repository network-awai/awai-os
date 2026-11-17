// Trust score (ADR 0026 D13). The score is a condition for dapps and operations.
// It does not mean goodwill, truth or verified identity. A service that accepts an
// operation must check the proofs itself: this device's copy can be edited locally.
// Inlined from dapp-trust.json (removed): shadow-cljs cannot require JSON,
// so the table lives here as the single source of truth.
const rules = {
  torihiki: { operations: { "submit-order": 50 } },
  saifu: { operations: { "read-chain-state": 50 } },
};

export const POINTS = { login: 10, passport: 40, worldId: 50 };
export const PASSPORT_PASSING_SCORE = 20;
export const PROOF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function fresh(proof, accountDid, now) {
  return (
    proof !== null &&
    typeof proof === "object" &&
    proof.account === accountDid &&
    Number.isFinite(proof.checkedAt) &&
    proof.checkedAt <= now &&
    now - proof.checkedAt <= PROOF_MAX_AGE_MS
  );
}

export function trustScore({ accountDid, proofs = {}, now = Date.now() }) {
  if (!accountDid) return 0;
  let score = POINTS.login;
  const { passport, worldId } = proofs;
  if (fresh(passport, accountDid, now) && passport.score >= PASSPORT_PASSING_SCORE) score += POINTS.passport;
  if (fresh(worldId, accountDid, now) && worldId.verified === true) score += POINTS.worldId;
  return score;
}

export function dappMinimum(dappId, table = rules) {
  return table[dappId]?.minimum ?? 0;
}

export function operationMinimum(dappId, operation, table = rules) {
  return Math.max(dappMinimum(dappId, table), table[dappId]?.operations?.[operation] ?? 0);
}

// An address from did:pkh, which is the only account form with an onchain score.
export function accountAddress(accountDid) {
  return /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/.exec(accountDid ?? "")?.[1] ?? null;
}

const GET_SCORE = "0xd47875d0";

export function passportCall(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("invalid-address");
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [
      { to: PASSPORT_DECODER, data: `${GET_SCORE}${address.slice(2).toLowerCase().padStart(64, "0")}` },
      "latest",
    ],
  };
}

// The decoder stores the score times 10000 and reverts when there is no valid score.
export function parsePassportResponse(body) {
  if (body?.error) {
    if (/revert/i.test(body.error.message ?? "")) return 0;
    throw new Error("chain-read-failed");
  }
  if (typeof body?.result !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.result)) {
    throw new Error("chain-read-failed");
  }
  return Number(BigInt(body.result)) / 10000;
}

export const PASSPORT_RPC_ORIGIN = "https://mainnet.optimism.io";
export const PASSPORT_DECODER = "0x5558D441779Eca04A329BcD6b47830D2C6607769";
