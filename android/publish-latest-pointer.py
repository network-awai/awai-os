#!/usr/bin/env python3
"""Sign the Store's latest-catalog pointer (AWAI-3662), with a pointer key from the Store's key list (AWAI-3775).

Builds `itonami.store.latest.v1` from a pins file (same shape as android/online-pins.dev.json), signs it
through SignCatalog and writes store/latest/pointer-envelope.json. The key's public key must be listed for the
pointer role in the key list, which must itself verify (android/key-list.py verify). Defaults: the published
list (store/keys/store-root.der, store/latest/keys-envelope.json) and the development pointer key in
~/.android/awai-store-dev. Another key: --keystore, --key-alias and --keystore-pass-env NAME (the password is
read from that environment variable); another list: --key-list DIR. The sequence must be higher than the
published one. Publishing happens by committing that file to main; the Store trusts it only after the
signature and sequence checks in LatestPointer.java.
"""
import argparse, base64, hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'store/latest/pointer-envelope.json'
LIFETIME = 30 * 24 * 60 * 60

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pins', type=pathlib.Path, default=ROOT / 'android/online-pins.dev.json')
    ap.add_argument('--sequence', type=int, required=True)
    # AWAI-3775: the pointer is signed by a pointer key from the Store's key list. Defaults: the development pointer
    # key in ~/.android/awai-store-dev and the published list (store/keys/store-root.der, store/latest/keys-envelope.json).
    ap.add_argument('--keystore', type=pathlib.Path, default=pathlib.Path.home() / '.android/awai-store-dev/pointer.p12')
    ap.add_argument('--key-alias', default='pointer')
    ap.add_argument('--keystore-pass-env', help='name of the environment variable holding the keystore and key password; '
                    'default for the development key: read from ~/.android/awai-store-dev/password')
    ap.add_argument('--key-list', type=pathlib.Path, help='directory with the verified key list; default: the published list')
    ap.add_argument('--out', type=pathlib.Path, default=OUT, help='where to write the envelope (default: the published store/latest/pointer-envelope.json)')
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'))
    a = ap.parse_args()
    dev = pathlib.Path.home() / '.android/awai-store-dev'
    if a.keystore_pass_env is None and a.keystore == dev / 'pointer.p12':
        if not (dev / 'password').is_file(): sys.exit(f'missing the development pointer key in {dev}: see store/keys/README.md')
        os.environ['AWAI_STORE_DEV_PASS'] = (dev / 'password').read_text().strip()
        a.keystore_pass_env = 'AWAI_STORE_DEV_PASS'
    if a.keystore_pass_env is not None and not (re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', a.keystore_pass_env) and os.environ.get(a.keystore_pass_env)):
        ap.error('--keystore-pass-env takes the name of a set environment variable')
    key_args = [a.key_alias] + ([a.keystore_pass_env] if a.keystore_pass_env else [])
    published_list = None
    if not a.key_list:
        published_list = tempfile.TemporaryDirectory()
        a.key_list = pathlib.Path(published_list.name)
        (a.key_list / 'store-root.der').write_bytes((ROOT / 'store/keys/store-root.der').read_bytes())
        envelope = json.loads((ROOT / 'store/latest/keys-envelope.json').read_text())
        (a.key_list / 'keys.txt').write_bytes(envelope['raw'].encode('ascii'))
        (a.key_list / 'keys.sig').write_bytes(base64.b64decode(envelope['signature']))
    if True:
        checked = subprocess.run([sys.executable, ROOT / 'android/key-list.py', 'verify', '--dir', a.key_list], capture_output=True, text=True)
        if checked.returncode != 0: sys.exit(checked.stderr.strip() or 'key list refused')
        listed = json.loads(checked.stdout)['pointerKeys']
    if a.out.exists():
        current = json.loads(json.loads(a.out.read_text())['raw'])['sequence']
        if a.sequence <= current: sys.exit(f'sequence must be above the published {current}')
    pins = json.loads(a.pins.read_text())
    now = int(time.time())
    raw = json.dumps({'schema': 'itonami.store.latest.v1', 'sequence': a.sequence, 'issuedAt': now,
                      'expiresAt': now + LIFETIME, 'pins': pins}, separators=(',', ':'), ensure_ascii=False)
    with tempfile.TemporaryDirectory() as t:
        t = pathlib.Path(t)
        subprocess.run([a.java / 'javac', '-d', t, ROOT / 'android/SignCatalog.java'], check=True)
        (t / 'raw').write_text(raw, encoding='utf-8')
        fp = subprocess.run([a.java / 'java', '-cp', t, 'SignCatalog', a.keystore, t / 'raw', t / 'key.der', t / 'sig', *key_args],
                            check=True, capture_output=True, text=True).stdout.strip()
        key_id = hashlib.sha256((t / 'key.der').read_bytes()).hexdigest()
        if key_id not in listed: sys.exit(f'key {key_id} is not listed for the pointer role; refusing to publish')
        fp = key_id
        sig = base64.b64encode((t / 'sig').read_bytes()).decode()
        subprocess.run(['openssl', 'dgst', '-sha256', '-verify', '/dev/stdin', '-signature', t / 'sig', t / 'raw'],
                       input=subprocess.run(['openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', t / 'key.der'],
                                            check=True, capture_output=True).stdout, check=True, capture_output=True)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({'raw': raw, 'signature': sig}, ensure_ascii=False, indent=1) + '\n'
    a.out.write_text(body, encoding='utf-8')
    print(json.dumps({'sequence': a.sequence, 'expiresAt': now + LIFETIME, 'bytes': len(body.encode()),
                      'sha256': hashlib.sha256(body.encode()).hexdigest(), 'signer': fp}))

if __name__ == '__main__': main()
