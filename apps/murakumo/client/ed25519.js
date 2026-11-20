// Ed25519 signature verification (RFC 8032 §5.1.7) for WebViews whose WebCrypto lacks Ed25519
// (Chrome 124 in the Android 15 system image, AWAI-3377). Verification only: no secret is handled,
// so constant time is not required. SHA-512 comes from WebCrypto. The point arithmetic follows
// apps/isekai/src/model.js (extended twisted Edwards coordinates, a = -1).
const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a, m = P) => ((a % m) + m) % m;
function pow(b, e, m = P) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
const D = mod(-121665n * pow(121666n, P - 2n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);
const BX = 15112221349535400772501151409588531511454012693041857206046113283949847762202n;
const BY = 46316835694926478169428394003475163141307993866256225615783033603165251855960n;
const BASE = [BX, BY, 1n, BX * BY % P];
const leInt = bytes => { let n = 0n; for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]); return n; };
function add([X1, Y1, Z1, T1], [X2, Y2, Z2, T2]) {
  const A = (Y1 - X1) * (Y2 - X2) % P, B = (Y1 + X1) * (Y2 + X2) % P;
  const C = 2n * T1 * T2 * D % P, E2 = 2n * Z1 * Z2 % P;
  const E = B - A, F = E2 - C, G = E2 + C, H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(n, Q) { let R = [0n, 1n, 1n, 0n]; for (; n > 0n; n >>= 1n, Q = add(Q, Q)) if (n & 1n) R = add(R, Q); return R; }
/** RFC 8032 §5.1.3 decoding; null when the encoding is not a curve point. */
function decode(bytes) {
  const le = Uint8Array.from(bytes); const sign = le[31] >> 7; le[31] &= 0x7f;
  const y = leInt(le); if (y >= P) return null;
  const u = mod(y * y - 1n), v = mod(D * y * y + 1n);
  const x2 = u * pow(v, P - 2n) % P;
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = x * SQRT_M1 % P;
  if (mod(x * x - x2) !== 0n) return null;
  if (x === 0n && sign === 1) return null;
  if (Number(x & 1n) !== sign) x = P - x;
  return [x, y, 1n, x * y % P];
}
const same = ([X1, Y1, Z1], [X2, Y2, Z2]) => mod(X1 * Z2 - X2 * Z1) === 0n && mod(Y1 * Z2 - Y2 * Z1) === 0n;
/** true when sig (64 bytes) is a valid Ed25519 signature of message under publicKey (32 bytes). */
export async function verifyEd25519(publicKey, sig, message) {
  if (publicKey?.length !== 32 || sig?.length !== 64) return false;
  const A = decode(publicKey), R = decode(sig.subarray(0, 32)); if (!A || !R) return false;
  const S = leInt(sig.subarray(32)); if (S >= L) return false;
  const input = new Uint8Array(64 + message.length); input.set(sig.subarray(0, 32)); input.set(publicKey, 32); input.set(message, 64);
  const k = mod(leInt(new Uint8Array(await crypto.subtle.digest('SHA-512', input))), L);
  return same(mul(S, BASE), add(R, mul(k, A)));
}
