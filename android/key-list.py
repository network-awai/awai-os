#!/usr/bin/env python3
"""Prepare, sign and check the Store's key list, itonami.store.keys.v1 (AWAI-3775).

The root signs the list; the Store pins only the root public key. Each step is separate so that the
root can stay offline: one person prepares the list text and the facts for a sign request, the root
holder signs that exact text on the signing machine, and anyone checks the result with public keys only.

  export   --keystore K --alias A [--pass-env NAME] --out role.der
           Writes a key's public key (X.509 SubjectPublicKeyInfo DER) and prints its SHA-256 (the key ID).
  prepare  --sequence N --catalog-key a.der [...] --pointer-key b.der [...] --out keys.txt
           [--lifetime-days D (default 180, at most 190)] [--issued UNIX_SECONDS]
           Writes the list text and prints the facts for a sign request: its SHA-256, sequence, validity
           and the key IDs per role. Refuses a sequence that is not above the published one.
  sign     --list keys.txt --expected-sha256 X --keystore K --alias A --pass-env NAME --expected-root ID --out-dir D
           Signs exactly that text with the root and writes D/store-root.der, D/keys.txt, D/keys.sig and
           D/keys-envelope.json (the form published at store/latest/keys-envelope.json). Refuses other text
           or another root, and checks the result with android/client/key-list.js before writing.
  verify   --dir D [--now UNIX_SECONDS]
           Checks D with the Store's rules (android/client/key-list.js) and prints the facts.

Key IDs are the SHA-256 of the SubjectPublicKeyInfo. Passwords are read from the named environment
variable by SignCatalog, never from the command line. No private key is written by this script.
"""
import argparse, base64, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLISHED = ROOT / 'store/latest/keys-envelope.json'
SCHEMA = 'itonami.store.keys.v1'
MAX_LIFETIME_DAYS = 190
JAVA = pathlib.Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')) / 'bin'

VERIFY_JS = r"""
import {readFileSync} from 'node:fs';
import {verifyKeyList} from %s;
const [dir, now] = process.argv.slice(-2);
const read = n => new Uint8Array(readFileSync(dir + '/' + n));
try {
  const l = await verifyKeyList(read('keys.txt'), read('keys.sig'), read('store-root.der'), Number(now), 0);
  console.log(JSON.stringify({ok: true, sequence: l.sequence, issuedAt: l.issuedAt, expiresAt: l.expiresAt}));
} catch (e) { console.log(JSON.stringify({ok: false, code: e.message})); process.exit(1); }
""" % json.dumps((ROOT / 'android/client/key-list.js').as_uri())


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def pass_env(name, ap):
    if name is None:
        return []
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name) or not os.environ.get(name):
        ap.error('--pass-env takes the name of a set environment variable')
    return [name]


def sign_catalog(t, keystore, alias, env, data, key_out, sig_out):
    """SignCatalog signs one file with SHA256withRSA and writes the key's public key. Prints the certificate SHA-256."""
    if not (t / 'SignCatalog.class').exists():
        subprocess.run([JAVA / 'javac', '-d', t, ROOT / 'android/SignCatalog.java'], check=True)
    return subprocess.run([JAVA / 'java', '-cp', t, 'SignCatalog', keystore, data, key_out, sig_out, alias, *env],
                          check=True, capture_output=True, text=True).stdout.strip()


def facts(text):
    lines = text.rstrip('\n').split('\n')
    keys = {'catalog': [], 'pointer': []}
    for line in lines[4:]:
        _, role, b64 = line.split(' ')
        keys[role].append(sha256(base64.b64decode(b64)))
    return {'sha256': sha256(text.encode('ascii')), 'sequence': int(lines[1].split(' ')[1]),
            'issuedAt': int(lines[2].split(' ')[1]), 'expiresAt': int(lines[3].split(' ')[1]),
            'catalogKeys': keys['catalog'], 'pointerKeys': keys['pointer']}


def published_sequence():
    if not PUBLISHED.exists():
        return 0
    raw = json.loads(PUBLISHED.read_text())['raw']
    return int(raw.split('\n')[1].split(' ')[1])


def check(directory, now):
    r = subprocess.run(['node', '--input-type=module', '-e', VERIFY_JS, str(directory), str(now)], capture_output=True, text=True)
    out = json.loads(r.stdout.strip() or '{"ok": false, "code": "node"}')
    if not out.get('ok'):
        sys.exit(f'key list refused: {out.get("code")}')
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    e = sub.add_parser('export')
    e.add_argument('--keystore', type=pathlib.Path, required=True)
    e.add_argument('--alias', required=True)
    e.add_argument('--pass-env')
    e.add_argument('--out', type=pathlib.Path, required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--sequence', type=int, required=True)
    p.add_argument('--catalog-key', type=pathlib.Path, action='append', required=True)
    p.add_argument('--pointer-key', type=pathlib.Path, action='append', required=True)
    p.add_argument('--lifetime-days', type=int, default=180)
    p.add_argument('--issued', type=int)
    p.add_argument('--out', type=pathlib.Path, required=True)
    p.add_argument('--allow-sequence', action='store_true', help='do not compare with the published list (for a separate channel)')
    s = sub.add_parser('sign')
    s.add_argument('--list', type=pathlib.Path, required=True)
    s.add_argument('--expected-sha256', required=True)
    s.add_argument('--keystore', type=pathlib.Path, required=True)
    s.add_argument('--alias', required=True)
    s.add_argument('--pass-env')
    s.add_argument('--expected-root', required=True, help='SHA-256 of the root public key (SubjectPublicKeyInfo)')
    s.add_argument('--out-dir', type=pathlib.Path, required=True)
    v = sub.add_parser('verify')
    v.add_argument('--dir', type=pathlib.Path, required=True)
    v.add_argument('--now', type=int)
    a = ap.parse_args()

    if a.cmd == 'export':
        env = pass_env(a.pass_env, ap)
        with tempfile.TemporaryDirectory() as t:
            t = pathlib.Path(t)
            (t / 'probe').write_bytes(b'public key export')
            sign_catalog(t, a.keystore, a.alias, env, t / 'probe', t / 'key.der', t / 'probe.sig')
            der = (t / 'key.der').read_bytes()
        a.out.write_bytes(der)
        print(json.dumps({'out': str(a.out), 'keyId': sha256(der)}))
        return

    if a.cmd == 'prepare':
        if not 1 <= a.lifetime_days <= MAX_LIFETIME_DAYS:
            ap.error(f'--lifetime-days must be 1..{MAX_LIFETIME_DAYS}')
        if not 1 <= a.sequence < 10 ** 15:
            ap.error('--sequence must be a positive integer of at most 15 digits')
        if not a.allow_sequence and a.sequence <= published_sequence():
            sys.exit(f'sequence must be above the published {published_sequence()}')
        issued = a.issued if a.issued is not None else int(time.time())
        lines = [SCHEMA, f'sequence {a.sequence}', f'issued {issued}', f'expires {issued + a.lifetime_days * 86400}']
        seen = set()
        for role, paths in (('catalog', a.catalog_key), ('pointer', a.pointer_key)):
            if len(paths) > 4:
                ap.error(f'at most 4 {role} keys')
            for path in paths:
                der = path.read_bytes()
                if sha256(der) in seen:
                    ap.error('a key may be listed once, in one role')
                seen.add(sha256(der))
                lines.append(f'key {role} {base64.b64encode(der).decode()}')
        text = '\n'.join(lines) + '\n'
        a.out.write_text(text, encoding='ascii')
        print(json.dumps({'out': str(a.out), **facts(text)}, indent=2))
        return

    if a.cmd == 'sign':
        text = a.list.read_bytes()
        if sha256(text) != a.expected_sha256:
            sys.exit('the list is not the text named in the sign request; refusing to sign')
        if not re.fullmatch(r'[a-f0-9]{64}', a.expected_root):
            ap.error('--expected-root takes a lowercase SHA-256')
        env = pass_env(a.pass_env, ap)
        if a.out_dir.exists() and any(a.out_dir.iterdir()):
            sys.exit('--out-dir must be new or empty')
        with tempfile.TemporaryDirectory() as t:
            t = pathlib.Path(t)
            sign_catalog(t, a.keystore, a.alias, env, a.list, t / 'store-root.der', t / 'keys.sig')
            root = (t / 'store-root.der').read_bytes()
            if sha256(root) != a.expected_root:
                sys.exit(f'the keystore holds root {sha256(root)}, not the expected one; refusing to write')
            shutil.copyfile(a.list, t / 'keys.txt')
            check(t, int(time.time()))
            a.out_dir.mkdir(parents=True, exist_ok=True)
            for name in ('store-root.der', 'keys.txt', 'keys.sig'):
                shutil.copyfile(t / name, a.out_dir / name)
        envelope = {'raw': text.decode('ascii'), 'signature': base64.b64encode((a.out_dir / 'keys.sig').read_bytes()).decode()}
        (a.out_dir / 'keys-envelope.json').write_text(json.dumps(envelope, separators=(',', ':')) + '\n')
        print(json.dumps({'outDir': str(a.out_dir), 'root': sha256(root), **facts(text.decode('ascii'))}, indent=2))
        return

    if a.cmd == 'verify':
        out = check(a.dir, a.now if a.now is not None else int(time.time()))
        print(json.dumps({**out, 'root': sha256((a.dir / 'store-root.der').read_bytes()),
                          **facts((a.dir / 'keys.txt').read_text(encoding='ascii'))}, indent=2))


if __name__ == '__main__':
    main()
