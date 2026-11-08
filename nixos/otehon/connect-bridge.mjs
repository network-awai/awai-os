// Loopback bridge between the Tsunagu app in the shell and this VM's Tailscale
// and Kekkai services (connect.nix). The shell is a file:// page, so its origin
// is "null"; nothing else on the VM is expected to call this port.
// Tailscale runs only after the user approves it in Tsunagu, and Kekkai SSH
// pairing reuses the locally approved flow of remote-access.mjs.
import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
export const PORT = 8791;
const STATE = '/var/lib/otehon-connect';
const CONTROL = '/run/murakumo-remote/control.sock';

// Keep only what the app shows; the raw status lists every peer on the tailnet.
export function summarize(status) {
  if (!status || typeof status !== 'object') return { state: 'Unknown' };
  const self = status.Self || {};
  return {
    state: typeof status.BackendState === 'string' ? status.BackendState : 'Unknown',
    authURL: typeof status.AuthURL === 'string' && status.AuthURL.startsWith('https://') ? status.AuthURL : null,
    name: typeof self.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : null,
    addresses: Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs.filter((a) => typeof a === 'string') : [],
  };
}

export function pairingInfo(info) {
  if (!info || typeof info !== 'object' || info.error) return { available: false };
  return {
    available: true,
    code: info.window ? info.window.code : null,
    expires: info.window ? info.window.expires : null,
    pending: info.pending ? { name: info.pending.name, address: info.pending.address } : null,
    connected: info.session ? { name: info.session.name, expires: info.session.expires } : null,
    ssh: info.ssh ? { fingerprint: info.ssh.fingerprint, kekkaiFingerprint: info.ssh.kekkaiFingerprint ?? null } : null,
    certificate: typeof info.certificate === 'string' ? info.certificate : null,
  };
}

export function control(value, socket = CONTROL) {
  return new Promise((resolve, reject) => {
    const s = net.connect(socket);
    let body = '';
    s.setEncoding('utf8');
    s.setTimeout(90000, () => s.destroy(Error('timeout')));
    s.on('connect', () => s.write(JSON.stringify(value) + '\n'));
    s.on('error', reject);
    s.on('data', (d) => {
      body += d;
      if (body.length > 65536) s.destroy(Error('too_large'));
      if (body.includes('\n')) { s.end(); resolve(JSON.parse(body.split('\n')[0])); }
    });
  });
}

export function systemDependencies({ run = execute, ask = control, state = STATE } = {}) {
  const flag = state + '/tailscale-enabled';
  const tailscale = (...args) => run('tailscale', args, { encoding: 'utf8', timeout: 30000 });
  const active = async () => (await run('systemctl', ['is-active', 'tailscaled.service']).catch(() => ({ stdout: '' }))).stdout.trim() === 'active';
  const status = async () => {
    if (!(await active())) return { state: 'Stopped', authURL: null, name: null, addresses: [] };
    return summarize(JSON.parse((await tailscale('status', '--json')).stdout));
  };
  const stop = async () => {
    await unlink(flag).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    await run('systemctl', ['stop', 'tailscaled.service']);
  };
  return {
    status,
    // The flag is the unit's start condition, so it is written first.
    async connect() {
      await mkdir(state, { recursive: true, mode: 0o700 });
      await writeFile(flag, 'approved in Tsunagu\n', { mode: 0o600 });
      await run('systemctl', ['start', 'tailscaled.service']);
      // `up` waits for the sign-in; the URL is in the status once it times out.
      await tailscale('up', '--timeout=10s').catch(() => {});
      return status();
    },
    async disconnect() { await tailscale('down').catch(() => {}); await stop(); return status(); },
    async logout() { await tailscale('logout').catch(() => {}); await stop(); return status(); },
    pairing: async () => pairingInfo(await ask({ action: 'info' }).catch(() => null)),
    pairingAction: (value) => ask(value),
  };
}

const HEX_OR_FINGERPRINT = /^[A-Za-z0-9+/=:]{1,128}$/;

export function connectHandler(deps) {
  return async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'access-control-allow-origin': 'null',
        'access-control-allow-headers': 'content-type, x-otehon-connect',
        'access-control-allow-methods': 'GET, POST',
        'x-content-type-options': 'nosniff',
      });
      res.end(value === null ? '' : JSON.stringify(value));
    };
    try {
      if (req.headers.host !== `127.0.0.1:${PORT}`) return send(403, { error: 'host_refused' });
      if (req.headers.origin !== undefined && req.headers.origin !== 'null') return send(403, { error: 'origin_refused' });
      if (req.method === 'OPTIONS') return send(204, null);
      if (req.headers['x-otehon-connect'] !== '1') return send(403, { error: 'header_required' });
      if (req.method === 'GET' && req.url === '/status') {
        return send(200, { tailscale: await deps.status(), kekkai: await deps.pairing() });
      }
      if (req.method !== 'POST') return send(404, { error: 'not_found' });
      const chunks = [];
      let size = 0;
      for await (const d of req) { size += d.length; if (size > 4096) throw Error('too_large'); chunks.push(Buffer.from(d)); }
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      switch (req.url) {
        case '/tailscale/connect': return send(200, await deps.connect());
        case '/tailscale/disconnect': return send(200, await deps.disconnect());
        case '/tailscale/logout': return send(200, await deps.logout());
        case '/kekkai/open': await deps.pairingAction({ action: 'open' }); return send(200, await deps.pairing());
        case '/kekkai/close': await deps.pairingAction({ action: 'close' }); return send(200, await deps.pairing());
        case '/kekkai/revoke': await deps.pairingAction({ action: 'revoke-ssh' }); return send(200, await deps.pairing());
        case '/kekkai/approve': {
          const { fingerprint, kekkaiFingerprint } = body;
          for (const v of [fingerprint, kekkaiFingerprint]) {
            if (v !== undefined && v !== null && (typeof v !== 'string' || !HEX_OR_FINGERPRINT.test(v))) return send(400, { error: 'invalid_request' });
          }
          // remote-access.mjs refuses the approval if the request changed since it was shown.
          const result = await deps.pairingAction({ action: 'approve', fingerprint, kekkaiFingerprint });
          if (result && result.error) return send(409, { error: 'approval_failed' });
          return send(200, await deps.pairing());
        }
        default: return send(404, { error: 'not_found' });
      }
    } catch {
      return send(500, { error: 'operation_failed' });
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = http.createServer(connectHandler(systemDependencies()));
  server.requestTimeout = 60000;
  server.listen(PORT, '127.0.0.1');
}
