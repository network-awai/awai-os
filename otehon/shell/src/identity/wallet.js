// Sign a link request with an EIP-1193 wallet, on the phone page or on this device.
import { SESSION_MS, checksumAddress, siweMessage } from "./link.js";

export async function signWithProvider(provider, request, now = Date.now()) {
  const [account] = await provider.request({ method: "eth_requestAccounts" });
  const chainId = Number.parseInt(await provider.request({ method: "eth_chainId" }), 16);
  const address = checksumAddress(account);
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_MS).toISOString();
  const message = siweMessage({ address, chainId, device: request.device, nonce: request.nonce, issuedAt, expiresAt });
  const hex = Array.from(new TextEncoder().encode(message), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const signature = await provider.request({ method: "personal_sign", params: [`0x${hex}`, address] });
  return { method: "wallet", address, chainId, issuedAt, expiresAt, signature };
}
