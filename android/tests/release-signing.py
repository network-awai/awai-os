#!/usr/bin/env python3
"""Check build.py --release with a throwaway key (AWAI-3761). The catalog is signed by the development catalog key
of the key list (AWAI-3775), so ~/.android/awai-store-dev must hold it.

Creates a PKCS12 keystore with a random password in a temporary directory, builds the hosts with it and
checks every APK: exactly that signer, not the Android debug identity, not debuggable. Then the refusals.
Needs the same prerequisites as build.py --skip-cljs. Nothing is installed or published; the key is
deleted with the temporary directory.
"""
import argparse, hashlib, json, os, pathlib, re, secrets, subprocess, sys, tempfile, zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV = 'AWAI_RELEASE_SIGNING_TEST_PASS'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sdk', type=pathlib.Path, default=pathlib.Path.home() / 'Library/Android/sdk')
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'))
    a = ap.parse_args()
    tools = a.sdk / 'build-tools/36.1.0'
    checks = []

    def check(name, ok, detail=''):
        checks.append({'check': name, 'ok': bool(ok)} | ({'detail': detail} if detail and not ok else {}))

    def build(out, extra, env):
        return subprocess.run([sys.executable, str(ROOT / 'android/build.py'), '--version', '1', '--skip-cljs',
                               '--sdk', str(a.sdk), '--java', str(a.java), '--out', str(out), *extra],
                              capture_output=True, text=True, env=env)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = pathlib.Path(tmp)
        password = secrets.token_urlsafe(24)
        env = dict(os.environ, **{ENV: password})
        ks = tmp / 'throwaway.p12'
        subprocess.run([str(a.java / 'keytool'), '-genkeypair', '-keystore', str(ks), '-storetype', 'PKCS12', '-alias', 'throwaway',
                        '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=AWAI-3761 throwaway test key',
                        '-storepass:env', ENV, '-keypass:env', ENV], check=True, capture_output=True, env=env)
        der = subprocess.run([str(a.java / 'keytool'), '-exportcert', '-keystore', str(ks), '-alias', 'throwaway', '-storepass:env', ENV],
                             check=True, capture_output=True, env=env).stdout
        expected = hashlib.sha256(der).hexdigest()
        key_args = ['--keystore', str(ks), '--key-alias', 'throwaway', '--keystore-pass-env', ENV]

        out = tmp / 'release'
        r = build(out, ['--release', *key_args], env)
        check('release build succeeds', r.returncode == 0, r.stderr[-600:])
        if r.returncode == 0:
            report = json.loads((out / 'build-v1.json').read_text())
            check('report names the release key', report.get('signing') == 'release-key' and report.get('publicSignerSha256') == expected
                  and report.get('debuggable') is False, json.dumps({k: report.get(k) for k in ('signing', 'publicSignerSha256', 'debuggable')}))
            apks = sorted(out.glob('*-v1.apk'))
            check('four APKs are built', [p.name for p in apks] == ['home-v1.apk', 'store-v1.apk', 'torihiki-v1.apk', 'yotei-v1.apk'], str(apks))
            for apk in apks:
                certs = subprocess.run([str(tools / 'apksigner'), 'verify', '--print-certs', str(apk)], capture_output=True, text=True).stdout
                badging = subprocess.run([str(tools / 'aapt2'), 'dump', 'badging', str(apk)], capture_output=True, text=True).stdout
                check(f'{apk.name}: single signer is the given key', re.findall(r'certificate SHA-256 digest: ([a-f0-9]{64})', certs) == [expected], certs[:300])
                check(f'{apk.name}: not the Android debug identity', 'CN=Android Debug' not in certs)
                check(f'{apk.name}: not debuggable', 'application-debuggable' not in badging)
            # AWAI-3775: the catalog is signed by a catalog key from the bundled key list, not by the APK key.
            with zipfile.ZipFile(out / 'store-v1.apk') as z:
                names = set(z.namelist())
                raw, sig = z.read('assets/catalog.json'), z.read('assets/catalog.sig')
                bundled = {n: z.read('assets/' + n) for n in ('store-root.der', 'keys.txt', 'keys.sig')}
            check('Store bundles the published root and key list, not a single catalog key',
                  'assets/catalog-key.der' not in names and bundled['store-root.der'] == (ROOT / 'store/keys/store-root.der').read_bytes()
                  and bundled['keys.txt'] == json.loads((ROOT / 'store/latest/keys-envelope.json').read_text())['raw'].encode())
            (tmp / 'raw').write_bytes(raw); (tmp / 'sig').write_bytes(sig)
            cert_spki = subprocess.run(['openssl', 'x509', '-inform', 'DER', '-pubkey', '-noout'], input=der, capture_output=True, check=True).stdout
            (tmp / 'apk.pem').write_bytes(cert_spki)
            by_apk_key = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(tmp / 'apk.pem'), '-signature', str(tmp / 'sig'), str(tmp / 'raw')], capture_output=True)
            check('the APK key does not sign the catalog', by_apk_key.returncode != 0)
            trust = report.get('trust', {})
            check('bundled catalog is signed by a listed catalog key', trust.get('mode') == 'key-list' and trust.get('catalogKey') in
                  json.loads(subprocess.run([sys.executable, str(ROOT / 'android/key-list.py'), 'verify', '--dir', str(out / 'key-list')],
                                            capture_output=True, text=True).stdout)['catalogKeys'], json.dumps(trust))
            leaked = [n for n, t in (('stdout', r.stdout), ('stderr', r.stderr), ('report', (out / 'build-v1.json').read_text())) if password in t]
            check('password is absent from output and report', not leaked, str(leaked))

        # Refusals. The first three stop at argument checks; the last reaches the keystore.
        r = build(tmp / 'n1', ['--release', '--keystore', str(ks), '--key-alias', 'throwaway'], env)
        check('refuses --release without a password variable', r.returncode != 0 and '--release requires' in r.stderr, r.stderr[-300:])
        r = build(tmp / 'n2', ['--release', '--keystore-pass-env', ENV], env)
        check('refuses --release with the Android debug identity', r.returncode != 0 and 'debug identity' in r.stderr, r.stderr[-300:])
        r = build(tmp / 'n3', ['--release', *key_args], {k: v for k, v in env.items() if k != ENV})
        check('refuses an unset password variable', r.returncode != 0 and 'is not set' in r.stderr, r.stderr[-300:])
        r = build(tmp / 'n4', ['--release', *key_args], dict(env, **{ENV: password + 'x'}))
        check('fails with a wrong password and builds no APK', r.returncode != 0 and not list((tmp / 'n4').glob('*.apk')), r.stderr[-300:])
        check('wrong password is absent from output', password not in r.stdout + r.stderr)

    failed = [c for c in checks if not c['ok']]
    print(json.dumps({'schema': 'awai.android.release-signing-test.v1', 'checks': len(checks), 'failed': len(failed), 'results': checks}, ensure_ascii=False, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
