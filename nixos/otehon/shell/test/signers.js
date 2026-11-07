// Software stand-ins for a wallet and a passkey, for tests only. Keys are random.
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  LINK_ORIGIN,
  RP_ID,
  SESSION_MS,
  checksumAddress,
  passkeyChallenge,
  personalMessageHash,
  siweMessage,
  toBase64Url,
} from "../src/identity/link.js";

const encoder = new TextEncoder();
const hex = (bytes) => Buffer.from(bytes).toString("hex");

export function randomWallet() {
  return walletFromSecret(secp256k1.utils.randomSecretKey());
}

export function walletFromSecret(secret) {
  const publicKey = secp256k1.getPublicKey(secret, false);
  return { secret, address: checksumAddress(`0x${hex(keccak_256(publicKey.slice(1))).slice(-40)}`) };
}

export function signPersonal(wallet, message) {
  const recovered = secp256k1.sign(personalMessageHash(message), wallet.secret, { prehash: false, format: "recovered" });
  return `0x${hex(recovered.slice(1))}${recovered[0].toString(16).padStart(2, "0")}`;
}

export function walletResponse(wallet, request, now, { lifetime = SESSION_MS, legacyV = false, chainId = 1 } = {}) {
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + lifetime).toISOString();
  const message = siweMessage({
    address: wallet.address,
    chainId,
    device: request.device,
    nonce: request.nonce,
    issuedAt,
    expiresAt,
  });
  const recovered = secp256k1.sign(personalMessageHash(message), wallet.secret, { prehash: false, format: "recovered" });
  const v = recovered[0] + (legacyV ? 27 : 0);
  const signature = `0x${hex(recovered.slice(1))}${v.toString(16).padStart(2, "0")}`;
  return { method: "wallet", address: wallet.address, chainId, issuedAt, expiresAt, signature };
}

export function passkeyResponse(
  secret,
  request,
  now,
  { origin = LINK_ORIGIN, type = "webauthn.get", rpId = RP_ID, flags = 0x05 } = {},
) {
  const expiresAt = new Date(now + SESSION_MS).toISOString();
  const challenge = toBase64Url(passkeyChallenge({ device: request.device, nonce: request.nonce, expiresAt }));
  const clientData = encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const authData = Uint8Array.from([...sha256(encoder.encode(rpId)), flags, 0, 0, 0, 1]);
  const signed = sha256(Uint8Array.from([...authData, ...sha256(clientData)]));
  const signature = p256.sign(signed, secret, { prehash: false, format: "der" });
  return {
    method: "passkey",
    publicKey: toBase64Url(p256.getPublicKey(secret)),
    authenticatorData: toBase64Url(authData),
    clientDataJSON: toBase64Url(clientData),
    signature: toBase64Url(signature),
    expiresAt,
  };
}
