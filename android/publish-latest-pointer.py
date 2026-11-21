#!/usr/bin/env python3
"""Sign the Store's latest-catalog pointer (AWAI-3662). Development signer only.

Builds `itonami.store.latest.v1` from a pins file (same shape as android/online-pins.dev.json),
signs it with the Android debug identity through SignCatalog (the key that signs the development
catalogs, signer certificate 2507930b...), and writes store/latest/pointer-envelope.json.
The sequence must be higher than the published one. Publishing happens by committing that file
to main; the Store trusts it only after the signature and sequence checks in LatestPointer.java.
"""
import argparse, base64, hashlib, json, pathlib, subprocess, sys, tempfile, time
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'store/latest/pointer-envelope.json'
SIGNER = '2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29'
LIFETIME = 30 * 24 * 60 * 60

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pins', type=pathlib.Path, default=ROOT / 'android/online-pins.dev.json')
    ap.add_argument('--sequence', type=int, required=True)
    ap.add_argument('--keystore', type=pathlib.Path, default=pathlib.Path.home() / '.android/debug.keystore')
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'))
    a = ap.parse_args()
    if OUT.exists():
        current = json.loads(json.loads(OUT.read_text())['raw'])['sequence']
        if a.sequence <= current: sys.exit(f'sequence must be above the published {current}')
    pins = json.loads(a.pins.read_text())
    now = int(time.time())
    raw = json.dumps({'schema': 'itonami.store.latest.v1', 'sequence': a.sequence, 'issuedAt': now,
                      'expiresAt': now + LIFETIME, 'pins': pins}, separators=(',', ':'), ensure_ascii=False)
    with tempfile.TemporaryDirectory() as t:
        t = pathlib.Path(t)
        subprocess.run([a.java / 'javac', '-d', t, ROOT / 'android/SignCatalog.java'], check=True)
        (t / 'raw').write_text(raw, encoding='utf-8')
        fp = subprocess.run([a.java / 'java', '-cp', t, 'SignCatalog', a.keystore, t / 'raw', t / 'key.der', t / 'sig'],
                            check=True, capture_output=True, text=True).stdout.strip()
        if fp != SIGNER: sys.exit(f'unexpected signer {fp}; refusing to publish')
        sig = base64.b64encode((t / 'sig').read_bytes()).decode()
        subprocess.run(['openssl', 'dgst', '-sha256', '-verify', '/dev/stdin', '-signature', t / 'sig', t / 'raw'],
                       input=subprocess.run(['openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', t / 'key.der'],
                                            check=True, capture_output=True).stdout, check=True, capture_output=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({'raw': raw, 'signature': sig}, ensure_ascii=False, indent=1) + '\n'
    OUT.write_text(body, encoding='utf-8')
    print(json.dumps({'sequence': a.sequence, 'expiresAt': now + LIFETIME, 'bytes': len(body.encode()),
                      'sha256': hashlib.sha256(body.encode()).hexdigest(), 'signer': fp}))

if __name__ == '__main__': main()
