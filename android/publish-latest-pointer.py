#!/usr/bin/env python3
"""Sign the Store's latest-catalog pointer (AWAI-3662). Development signer by default.

Builds `itonami.store.latest.v1` from a pins file (same shape as android/online-pins.dev.json),
signs it with the Android debug identity through SignCatalog (the key that signs the development
catalogs, signer certificate 2507930b...), and writes store/latest/pointer-envelope.json.
The sequence must be higher than the published one. Publishing happens by committing that file
to main; the Store trusts it only after the signature and sequence checks in LatestPointer.java.

Another key (AWAI-3761): --keystore, --key-alias, --keystore-pass-env NAME and --expected-signer
together. The password is read from the named environment variable, and the script refuses to write
unless the key's certificate has exactly the expected SHA-256. A Store accepts the result only when
it was built with that same key.

Key list (AWAI-3775): --key-list DIR (from android/key-list.py sign) instead of --expected-signer. The key's
public key must be listed for the pointer role in that list, which must itself verify; the Store then accepts
the pointer through the list, whatever certificate wraps the key.
"""
import argparse, base64, hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'store/latest/pointer-envelope.json'
SIGNER = '2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29'
LIFETIME = 30 * 24 * 60 * 60

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pins', type=pathlib.Path, default=ROOT / 'android/online-pins.dev.json')
    ap.add_argument('--sequence', type=int, required=True)
    ap.add_argument('--keystore', type=pathlib.Path, default=pathlib.Path.home() / '.android/debug.keystore')
    ap.add_argument('--key-alias', default='androiddebugkey')
    ap.add_argument('--keystore-pass-env', help='name of the environment variable holding the keystore and key password')
    ap.add_argument('--expected-signer', default=SIGNER, help='SHA-256 of the signing certificate; default: the development signer')
    ap.add_argument('--key-list', type=pathlib.Path, help='directory with the verified key list; the key must be a listed pointer key')
    ap.add_argument('--out', type=pathlib.Path, default=OUT, help='where to write the envelope (default: the published store/latest/pointer-envelope.json)')
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'))
    a = ap.parse_args()
    if not re.fullmatch(r'[a-f0-9]{64}', a.expected_signer): ap.error('--expected-signer takes a lowercase SHA-256')
    if a.keystore_pass_env is not None and not (re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', a.keystore_pass_env) and os.environ.get(a.keystore_pass_env)):
        ap.error('--keystore-pass-env takes the name of a set environment variable')
    key_args = [a.key_alias] + ([a.keystore_pass_env] if a.keystore_pass_env else [])
    listed = None
    if a.key_list:
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
        if listed is not None:
            key_id = hashlib.sha256((t / 'key.der').read_bytes()).hexdigest()
            if key_id not in listed: sys.exit(f'key {key_id} is not listed for the pointer role; refusing to publish')
            fp = key_id
        elif fp != a.expected_signer: sys.exit(f'unexpected signer {fp}; refusing to publish')
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
