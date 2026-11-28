import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/;
const RELEASE_PATH = /^store\/distribution\/rel-\d{8}-r\d+\//;

export function releaseSigners({approvals, inspectApk}, rootSha256, devRootSha256) {
  if (approvals?.schema !== 'awai.store-site.approvals.v1' ||
      !SHA256.test(approvals.rootSha256 ?? '') ||
      approvals.rootSha256 !== rootSha256 || rootSha256 === devRootSha256) {
    throw new Error('release-root');
  }
  const signers = approvals.apkSigners;
  if (!signers || typeof signers !== 'object' || Array.isArray(signers) ||
      !Object.keys(signers).length || Object.values(signers).some(value =>
        typeof value !== 'string' || !SHA256.test(value)) || typeof inspectApk !== 'function') {
    throw new Error('release-approvals');
  }
  return signers;
}

export function requireReleasePath(path) {
  if (!RELEASE_PATH.test(path)) {
    throw new Error('release-pin-path');
  }
}

export function verifyReleaseApk(app, apk, bytes, approval, inspectApk, devSigner) {
  if (!approval || approval === devSigner || approval !== apk?.signerSha256) {
    throw new Error('release-apk-approval');
  }
  if (!bytes) throw new Error('release-apk-missing');
  if (!Number.isSafeInteger(app.versionCode) || app.versionCode < 1 || apk.runtime !== 'android') {
    throw new Error('release-apk-metadata');
  }
  const observed = inspectApk(bytes);
  if (observed.packageId !== app.id || observed.versionCode !== app.versionCode ||
      observed.debuggable !== false || observed.signerSha256 !== approval) {
    throw new Error('release-apk-identity');
  }
}

function inspectArchive(bytes, buildTools) {
  const dir = mkdtempSync(join(tmpdir(), 'awai-site-apk-'));
  try {
    const apk = join(dir, 'candidate.apk');
    writeFileSync(apk, bytes, {mode: 0o600});
    const run = (tool, args) => {
      try {
        return execFileSync(join(buildTools, tool), args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
      } catch {
        throw new Error('release-apk-inspection');
      }
    };
    const signing = run('apksigner', ['verify', '--print-certs', apk]);
    const signers = [...signing.matchAll(/^Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})\s*$/gm)];
    const badging = run('aapt2', ['dump', 'badging', apk]);
    const pkg = /^package: name='([^']+)' versionCode='([0-9]+)'/m.exec(badging);
    if (signers.length !== 1 || !pkg) throw new Error('release-apk-inspection');
    return {packageId: pkg[1], versionCode: Number(pkg[2]), signerSha256: signers[0][1],
      debuggable: /^application-debuggable\b/m.test(badging)};
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

export function releaseFiles(directory, approvalsPath, buildTools) {
  const dir = resolve(directory), tools = resolve(buildTools);
  return {
    rootDer: readFileSync(join(dir, 'store-root.der')),
    keysBytes: readFileSync(join(dir, 'keys-envelope.json')),
    pointerBytes: readFileSync(join(dir, 'pointer-envelope.json')),
    release: {
      approvals: JSON.parse(readFileSync(approvalsPath, 'utf8')),
      inspectApk: bytes => inspectArchive(bytes, tools),
    },
  };
}
