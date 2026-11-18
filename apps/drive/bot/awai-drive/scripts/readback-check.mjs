// AWAI-3255: one AwaiVol readback check in an isolated namespace.
//
// Writes one random object under `awai-drive-bot-readback/<run-id>/` on a loopback AwaiVol
// WebDAV origin, reads it back, compares SHA-256, asks the daemon how it classifies the object
// (/__availability), and deletes only the object and folders it created. It reads no other
// path, sends nothing off this machine and holds no key. A value it could not measure is
// written as "unknown".
//
//   AWAI_DRIVE_READBACK_ORIGIN=http://127.0.0.1:<port> node readback-check.mjs
//
// Exit 0 when the bytes read back match; 1 when they do not or a step failed; 2 when no
// origin is configured (nothing is sent).
import crypto from 'node:crypto';

export const NAMESPACE = 'awai-drive-bot-readback';
const SIZE = 4096;
const TIMEOUT_MS = 30000;

export function originOf(raw) {
  if (!raw) return null;
  const m = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost):(\d{1,5})$/.exec(raw.trim());
  if (!m || +m[2] < 1 || +m[2] > 65535) throw Error('origin must be http://127.0.0.1:<port> (loopback only)');
  return `http://${m[1]}:${m[2]}`;
}

const sha = b => crypto.createHash('sha256').update(b).digest('hex');

export async function check(origin, { fetchImpl = fetch, now = () => new Date(), runId } = {}) {
  const id = runId || `${now().toISOString().replace(/[-:.]/g, '').toLowerCase()}-${crypto.randomBytes(4).toString('hex')}`;
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw Error('run id');
  const folder = `${NAMESPACE}/${id}`;
  const object = `${folder}/probe.bin`;
  const report = { schema: 'awai.drive-bot.readback.v1', origin, object, bytes: SIZE, startedAt: now().toISOString(),
    put: 'unknown', get: 'unknown', match: 'unknown', zeroFilled: 'unknown', availability: 'unknown',
    cleanup: 'unknown', errors: [] };
  const call = async (method, path, body) => {
    const started = performance.now();
    try {
      const r = await fetchImpl(`${origin}/${path}`, { method, body, signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: body ? { 'Content-Type': 'application/octet-stream' } : {} });
      const b = Buffer.from(await r.arrayBuffer());
      return { status: r.status, ms: Math.round(performance.now() - started), body: b };
    } catch (e) {
      return { status: `error:${e.cause?.code || e.name}`, ms: Math.round(performance.now() - started), body: Buffer.alloc(0) };
    }
  };
  const created = [];
  for (const dir of [NAMESPACE, folder]) {
    const r = await call('MKCOL', `${dir}/`);
    if (r.status === 201) created.push(dir);
    else if (r.status !== 405) report.errors.push(`MKCOL ${dir} ${r.status}`);
  }
  const body = crypto.randomBytes(SIZE);
  const want = sha(body);
  const put = await call('PUT', object, body);
  report.put = { status: put.status, ms: put.ms };
  if (put.status === 201 || put.status === 204) {
    const got = await call('GET', object);
    report.get = { status: got.status, ms: got.ms };
    if (got.status === 200) {
      report.match = sha(got.body) === want;
      report.zeroFilled = got.body.length > 0 && !got.body.some(x => x);
    } else report.errors.push(`GET ${got.status}`);
    const av = await call('GET', `__availability?path=${encodeURIComponent(object)}`);
    if (av.status === 200) {
      try { const j = JSON.parse(av.body.toString('utf8')); report.availability = typeof j.state === 'string' ? j.state : 'unknown'; }
      catch { report.availability = 'unknown'; }
    }
    const del = await call('DELETE', object);
    if (![200, 204].includes(del.status)) report.errors.push(`DELETE object ${del.status}`);
  } else report.errors.push(`PUT ${put.status}`);
  // Remove only the folders this run created, deepest first.
  for (const dir of created.reverse()) {
    const r = await call('DELETE', `${dir}/`);
    if (![200, 204].includes(r.status)) report.errors.push(`DELETE ${dir} ${r.status}`);
  }
  report.cleanup = report.errors.some(e => e.startsWith('DELETE')) ? 'incomplete' : 'done';
  report.finishedAt = now().toISOString();
  report.ok = report.match === true && report.zeroFilled === false && report.errors.length === 0;
  return report;
}

const main = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (main) {
  let origin;
  try { origin = originOf(process.env.AWAI_DRIVE_READBACK_ORIGIN); }
  catch (e) { console.log(`readback not run: ${e.message}`); process.exit(2); }
  if (!origin) {
    console.log('readback not run: AWAI_DRIVE_READBACK_ORIGIN is not set; nothing was sent (state unknown)');
    process.exit(2);
  }
  const r = await check(origin);
  console.log(`readback ${r.ok ? 'ok' : 'FAILED'}: match=${r.match} zeroFilled=${r.zeroFilled} availability=${r.availability} cleanup=${r.cleanup}`);
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}
