#!/usr/bin/env python3
"""Sign a distribution catalog with a catalog key from the Store's key list (AWAI-3775).

  python3 android/sign-catalog-envelope.py --raw store/distribution/<dir>/catalog-revN-raw.json \
      --key-list DIR --keystore K --alias A --pass-env NAME --out store/distribution/<dir>/catalog-envelope.json

The raw bytes are signed exactly as they are (SHA256withRSA) and written with the signature as
{"raw": ..., "signature": ...}, the form the Store and the entry page read. The key must be listed for the
catalog role in DIR, and DIR must verify (android/key-list.py verify). The catalog may list any number of
apps; which apps the Store admits is still decided by Catalog.java. The password is read from the named
environment variable by SignCatalog. Nothing is published: committing the file is a separate step.
"""
import argparse, base64, hashlib, json, os, pathlib, re, subprocess, sys, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--raw', type=pathlib.Path, required=True)
    ap.add_argument('--key-list', type=pathlib.Path, required=True)
    ap.add_argument('--keystore', type=pathlib.Path, required=True)
    ap.add_argument('--alias', required=True)
    ap.add_argument('--pass-env', required=True)
    ap.add_argument('--out', type=pathlib.Path, required=True)
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')) / 'bin')
    a = ap.parse_args()
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', a.pass_env) or not os.environ.get(a.pass_env):
        ap.error('--pass-env takes the name of a set environment variable')
    raw = a.raw.read_bytes()
    value = json.loads(raw.decode('utf-8'))
    if value.get('schema') != 'itonami.store.bundled.v1' or not isinstance(value.get('revision'), int) or value['revision'] < 1:
        sys.exit('not an itonami.store.bundled.v1 catalog with a positive revision')
    if not isinstance(value.get('expiresAt'), int) or value['expiresAt'] <= int(time.time()):
        sys.exit('the catalog has expired or has no expiresAt')
    checked = subprocess.run([sys.executable, ROOT / 'android/key-list.py', 'verify', '--dir', a.key_list], capture_output=True, text=True)
    if checked.returncode != 0:
        sys.exit(checked.stderr.strip() or 'key list refused')
    listed = json.loads(checked.stdout)['catalogKeys']
    with tempfile.TemporaryDirectory() as t:
        t = pathlib.Path(t)
        subprocess.run([a.java / 'javac', '-d', t, ROOT / 'android/SignCatalog.java'], check=True)
        subprocess.run([a.java / 'java', '-cp', t, 'SignCatalog', a.keystore, a.raw, t / 'key.der', t / 'sig', a.alias, a.pass_env],
                       check=True, capture_output=True)
        key_id = hashlib.sha256((t / 'key.der').read_bytes()).hexdigest()
        if key_id not in listed:
            sys.exit(f'key {key_id} is not listed for the catalog role; refusing to write')
        subprocess.run(['openssl', 'dgst', '-sha256', '-verify', '/dev/stdin', '-signature', t / 'sig', a.raw],
                       input=subprocess.run(['openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', t / 'key.der'],
                                            check=True, capture_output=True).stdout, check=True, capture_output=True)
        signature = base64.b64encode((t / 'sig').read_bytes()).decode()
    body = json.dumps({'raw': raw.decode('utf-8'), 'signature': signature}, ensure_ascii=False, separators=(',', ':')) + '\n'
    a.out.write_text(body, encoding='utf-8')
    print(json.dumps({'out': str(a.out), 'revision': value['revision'], 'apps': len(value.get('apps', [])), 'catalogKey': key_id,
                      'bytes': len(body.encode()), 'sha256': hashlib.sha256(body.encode()).hexdigest()}))


if __name__ == '__main__':
    main()
