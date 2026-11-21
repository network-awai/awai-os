#!/usr/bin/env python3
"""Checks the key-list build and signing scripts with throwaway keys (AWAI-3775). About three minutes.

Creates PKCS12 keystores for a root, a catalog key, a pointer key and an unlisted key in a temporary
directory, with a random password held only in this process's environment, and deletes them at the end.
Nothing is installed or published; the pointer is written to a temporary path.

  python3 android/tests/key-list-signing.py [--skip-build]
"""
import base64, hashlib, json, os, pathlib, secrets, subprocess, sys, tempfile, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
JAVA = pathlib.Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')) / 'bin'
results = []


def check(name, ok):
    results.append({'check': name, 'ok': bool(ok)})


def run(*cmd, env=None):
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, env=env)


def main():
    skip_build = '--skip-build' in sys.argv
    env = dict(os.environ, AWAI_TEST_KEY_PASS=secrets.token_urlsafe(24))
    with tempfile.TemporaryDirectory() as t:
        t = pathlib.Path(t)
        for name in ('root', 'catalog', 'pointer', 'other'):
            r = run(JAVA / 'keytool', '-genkeypair', '-keystore', t / f'{name}.p12', '-storetype', 'PKCS12', '-alias', name,
                    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', f'CN=awai store test {name}',
                    '-storepass:env', 'AWAI_TEST_KEY_PASS', env=env)
            if r.returncode: sys.exit(r.stderr)
        kl = ROOT / 'android/key-list.py'
        ids = {}
        for name in ('root', 'catalog', 'pointer', 'other'):
            r = run(sys.executable, kl, 'export', '--keystore', t / f'{name}.p12', '--alias', name, '--pass-env', 'AWAI_TEST_KEY_PASS',
                    '--out', t / f'{name}.der', env=env)
            ids[name] = json.loads(r.stdout)['keyId'] if r.returncode == 0 else None
        check('export writes each public key and its ID', all(ids.values()) and ids['root'] == hashlib.sha256((t / 'root.der').read_bytes()).hexdigest())
        r = run(sys.executable, kl, 'prepare', '--sequence', '7', '--catalog-key', t / 'catalog.der', '--pointer-key', t / 'pointer.der',
                '--lifetime-days', '30', '--out', t / 'keys.txt', '--allow-sequence')
        prepared = json.loads(r.stdout) if r.returncode == 0 else {}
        check('prepare lists the catalog and pointer keys', prepared.get('catalogKeys') == [ids['catalog']] and prepared.get('pointerKeys') == [ids['pointer']])
        check('prepare refuses a lifetime over 190 days', run(sys.executable, kl, 'prepare', '--sequence', '7', '--catalog-key', t / 'catalog.der',
              '--pointer-key', t / 'pointer.der', '--lifetime-days', '191', '--out', t / 'x.txt', '--allow-sequence').returncode != 0)
        check('prepare refuses one key in both roles', run(sys.executable, kl, 'prepare', '--sequence', '7', '--catalog-key', t / 'catalog.der',
              '--pointer-key', t / 'catalog.der', '--out', t / 'x.txt', '--allow-sequence').returncode != 0)
        sign = lambda out, sha, root='root', expected=None: run(sys.executable, kl, 'sign', '--list', t / 'keys.txt', '--expected-sha256', sha,
            '--keystore', t / f'{root}.p12', '--alias', root, '--pass-env', 'AWAI_TEST_KEY_PASS', '--expected-root', expected or ids['root'],
            '--out-dir', t / out, env=env)
        check('sign refuses text other than the requested SHA-256', sign('bad-text', '0' * 64).returncode != 0 and not (t / 'bad-text').exists())
        check('sign refuses a keystore that holds another root', sign('bad-root', prepared['sha256'], root='other').returncode != 0
              and not (t / 'bad-root' / 'keys.sig').exists())
        r = sign('list', prepared['sha256'])
        check('sign writes the root, the list, its signature and the envelope', r.returncode == 0
              and all((t / 'list' / n).is_file() for n in ('store-root.der', 'keys.txt', 'keys.sig', 'keys-envelope.json')))
        env_json = json.loads((t / 'list/keys-envelope.json').read_text())
        check('the envelope holds exactly the signed text', env_json['raw'].encode() == (t / 'list/keys.txt').read_bytes()
              and base64.b64decode(env_json['signature']) == (t / 'list/keys.sig').read_bytes())
        r = run(sys.executable, kl, 'verify', '--dir', t / 'list')
        check('verify accepts the list with the Store rules', r.returncode == 0 and json.loads(r.stdout)['sequence'] == 7)
        r = run(sys.executable, kl, 'verify', '--dir', t / 'list', '--now', str(prepared['expiresAt']))
        check('verify refuses the list once it has expired', r.returncode != 0 and 'keys-expired' in r.stderr)
        (t / 'tampered').mkdir()
        for n in ('store-root.der', 'keys.sig'): (t / 'tampered' / n).write_bytes((t / 'list' / n).read_bytes())
        (t / 'tampered/keys.txt').write_bytes((t / 'list/keys.txt').read_bytes().replace(b'sequence 7', b'sequence 8'))
        r = run(sys.executable, kl, 'verify', '--dir', t / 'tampered')
        check('verify refuses a changed list', r.returncode != 0 and 'keys-signature' in r.stderr)

        # Pointer: only a listed pointer key may sign.
        pp = ROOT / 'android/publish-latest-pointer.py'
        pointer = lambda key, out: run(sys.executable, pp, '--sequence', '99', '--keystore', t / f'{key}.p12', '--key-alias', key,
                                       '--keystore-pass-env', 'AWAI_TEST_KEY_PASS', '--key-list', t / 'list', '--out', t / out, env=env)
        r = pointer('pointer', 'pointer.json')
        check('a listed pointer key signs the pointer', r.returncode == 0 and json.loads(r.stdout)['signer'] == ids['pointer'])
        check('the catalog key may not sign the pointer', pointer('catalog', 'p2.json').returncode != 0 and not (t / 'p2.json').exists())
        check('an unlisted key may not sign the pointer', pointer('other', 'p3.json').returncode != 0 and not (t / 'p3.json').exists())
        check('the published pointer is untouched', run('git', '-C', ROOT, 'diff', '--quiet', '--', 'store/latest').returncode == 0)

        # Distribution catalog: only a listed catalog key may sign; any number of apps.
        import time
        raw = json.dumps({'schema': 'itonami.store.bundled.v1', 'revision': 500, 'expiresAt': int(time.time()) + 86400,
                          'apps': [{'id': 'network.itonami.yotei'}, {'id': 'network.itonami.deai'}, {'id': 'network.itonami.kumade'}]},
                         separators=(',', ':'))
        (t / 'raw.json').write_text(raw)
        sc = ROOT / 'android/sign-catalog-envelope.py'
        cat = lambda key, out: run(sys.executable, sc, '--raw', t / 'raw.json', '--key-list', t / 'list', '--keystore', t / f'{key}.p12',
                                   '--alias', key, '--pass-env', 'AWAI_TEST_KEY_PASS', '--out', t / out, env=env)
        r = cat('catalog', 'cat.json')
        check('a listed catalog key signs a three-app catalog', r.returncode == 0 and json.loads(r.stdout)['apps'] == 3
              and json.loads((t / 'cat.json').read_text())['raw'] == raw)
        check('the pointer key may not sign a catalog', cat('pointer', 'c2.json').returncode != 0 and not (t / 'c2.json').exists())
        check('the root may not sign a catalog', cat('root', 'c3.json').returncode != 0 and not (t / 'c3.json').exists())

        if not skip_build:
            out = t / 'build'
            base = [sys.executable, ROOT / 'android/build.py', '--version', '1', '--skip-cljs', '--out', out]
            refused = run(*base, '--key-list', t / 'list', '--catalog-keystore', t / 'other.p12', '--catalog-key-alias', 'other',
                          '--catalog-pass-env', 'AWAI_TEST_KEY_PASS', env=env)
            check('build refuses an unlisted catalog key', refused.returncode != 0 and 'not listed' in refused.stderr + refused.stdout)
            check('build refuses a partial key-list option set', run(*base, '--key-list', t / 'list', env=env).returncode != 0)
            r = run(*base, '--key-list', t / 'list', '--catalog-keystore', t / 'catalog.p12', '--catalog-key-alias', 'catalog',
                    '--catalog-pass-env', 'AWAI_TEST_KEY_PASS', env=env)
            check('build with the key list succeeds', r.returncode == 0)
            if r.returncode == 0:
                report = json.loads((out / 'build-v1.json').read_text())
                check('report names the list, the root and the catalog key', report['trust'] == {
                    'mode': 'key-list', 'sequence': 7, 'expiresAt': prepared['expiresAt'], 'root': ids['root'],
                    'catalogKey': ids['catalog'], 'pointerKeys': [ids['pointer']]})
                with zipfile.ZipFile(out / 'store-v1.apk') as z:
                    names = set(z.namelist())
                    check('the Store bundles the root and the list, not a single catalog key',
                          {'assets/store-root.der', 'assets/keys.txt', 'assets/keys.sig'} <= names and 'assets/catalog-key.der' not in names)
                    check('the bundled root and list are the signed ones', z.read('assets/store-root.der') == (t / 'list/store-root.der').read_bytes()
                          and z.read('assets/keys.txt') == (t / 'list/keys.txt').read_bytes())
                    js = z.read('assets/catalog-data.js').decode()
                    check('the page gets the list, not a single public key', 'window.ItonamiKeyList=' in js and 'ItonamiPublicKey' not in js)
                    cat_raw, cat_sig = z.read('assets/catalog.json'), z.read('assets/catalog.sig')
                    pub = run('openssl', 'pkey', '-pubin', '-inform', 'DER', '-in', t / 'catalog.der').stdout
                    (t / 'c.json').write_bytes(cat_raw); (t / 'c.sig').write_bytes(cat_sig); (t / 'c.pem').write_text(pub)
                    check('the bundled catalog is signed by the catalog key',
                          run('openssl', 'dgst', '-sha256', '-verify', t / 'c.pem', '-signature', t / 'c.sig', t / 'c.json').returncode == 0)
                apk_report = report.get('publicSignerSha256')
                check('the APKs are still signed by the APK key (debug), not the catalog key', apk_report and apk_report != ids['catalog'])
            leaked = env['AWAI_TEST_KEY_PASS']
            check('password is absent from the report', not (out / 'build-v1.json').exists() or leaked not in (out / 'build-v1.json').read_text())

    failed = [r for r in results if not r['ok']]
    print(json.dumps({'checks': len(results), 'failed': len(failed), 'results': results}, indent=1, ensure_ascii=False))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
