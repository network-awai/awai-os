#!/usr/bin/env python3
"""Build-time and round-trip regression tests for --online-pins parity with OnlinePins.java (AWAI-3729).

Verifies that android/build.py rejects every pin document that Android's OnlinePins.java / HostActivity.java
would reject (including decimal-formatted integer maxBytes like 1024.0, bool/out-of-range maxBytes,
duplicate keys, > 32,768-byte serialized JSON, preview/unadmitted app IDs, and malformed URLs) BEFORE
building any APK, and verifies round-trip acceptance of build.py's exact serialized bytes through
android/online-csp.mjs and JVM CatalogOnlinePinsCheck (Integrity.read + OnlinePins + Catalog).

  python3 -I android/tests/online-pins-build.py
"""
import importlib.util, json, os, pathlib, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build', ROOT / 'android/build.py')
assert spec is not None and spec.loader is not None
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

REV = 'a' * 40
SHA = 'b' * 64
BASE = f'https://raw.githubusercontent.com/network-awai/awai-os/{REV}/store/distribution/dev/'
results = []


def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok)} | ({'detail': detail} if detail and not ok else {}))


def make_pins_dict(count, target_bytes=None):
    apks = {
        f'network.itonami.app{i}': {'url': f'{BASE}app{i}.apk', 'sha256': SHA, 'maxBytes': 1048576}
        for i in range(count)
    }
    doc = {
        'revision': REV,
        'catalog': {'url': f'{BASE}catalog-envelope.json', 'sha256': SHA, 'maxBytes': 16965},
        'apks': apks,
    }
    if target_bytes is not None:
        current = len(json.dumps(doc, separators=(',', ':')).encode('utf-8'))
        extra = target_bytes - current
        assert extra >= 0, f'target_bytes {target_bytes} < base {current}'
        base_pad, rem = divmod(extra, count)
        for i in range(count):
            add = base_pad + (1 if i < rem else 0)
            if add > 0:
                apks[f'network.itonami.app{i}']['url'] = f'{BASE}app{i}-' + ('p' * (add - 1)) + '.apk'
    return doc


def rejects_bytes(label, raw_bytes):
    try:
        build.validate_online_pins_bytes(raw_bytes)
        check(f'validate_online_pins_bytes rejects {label}', False, 'unexpectedly accepted')
    except ValueError:
        check(f'validate_online_pins_bytes rejects {label}', True)


def main():
    good_one = json.dumps(make_pins_dict(1), separators=(',', ':'))

    # 1. Exact integer maxBytes type checks (reject 1024.0, 1e3, bool, string, out-of-range).
    rejects_bytes('decimal apk maxBytes (1024.0)', good_one.replace('1048576', '1024.0').encode('utf-8'))
    rejects_bytes('decimal catalog maxBytes (1024.0)', good_one.replace('16965', '1024.0').encode('utf-8'))
    rejects_bytes('exponent maxBytes (1e3)', good_one.replace('1048576', '1e3').encode('utf-8'))
    rejects_bytes('bool true maxBytes', good_one.replace('1048576', 'true').encode('utf-8'))
    rejects_bytes('bool false maxBytes', good_one.replace('1048576', 'false').encode('utf-8'))
    rejects_bytes('string maxBytes', good_one.replace('1048576', '"1024"').encode('utf-8'))
    rejects_bytes('zero maxBytes', good_one.replace('1048576', '0').encode('utf-8'))
    rejects_bytes('negative maxBytes', good_one.replace('1048576', '-1').encode('utf-8'))
    rejects_bytes('catalog maxBytes > 131072', good_one.replace('16965', '131073').encode('utf-8'))
    rejects_bytes('apk maxBytes > 64 MiB', good_one.replace('1048576', str(64 * 1024 * 1024 + 1)).encode('utf-8'))

    # 2. Duplicate keys, app count boundaries, preview/unadmitted apps, URL hygiene, and JSON null.
    dup_json = good_one.replace(
        '}}}',
        '},"network.itonami.app0":{"url":"' + BASE + 'dup.apk","sha256":"' + SHA + '","maxBytes":1024}}}',
    )
    rejects_bytes('duplicate APK key', dup_json.encode('utf-8'))
    rejects_bytes('literal null passed as --online-pins', b'null')
    rejects_bytes('0 APKs', json.dumps(make_pins_dict(0), separators=(',', ':')).encode('utf-8'))
    rejects_bytes('65 APKs (MAX_APPS + 1)', json.dumps(make_pins_dict(65), separators=(',', ':')).encode('utf-8'))

    preview_doc = make_pins_dict(1)
    preview_doc['apks'] = {'network.itonami.client.preview': preview_doc['apks']['network.itonami.app0']}
    rejects_bytes('offline-only preview app', json.dumps(preview_doc, separators=(',', ':')).encode('utf-8'))

    unadmitted_doc = make_pins_dict(1)
    unadmitted_doc['apks'] = {'network.other.evil': unadmitted_doc['apks']['network.itonami.app0']}
    rejects_bytes('unadmitted app id', json.dumps(unadmitted_doc, separators=(',', ':')).encode('utf-8'))

    for label, bad_url in [
        ('explicit :443 port', f'https://raw.githubusercontent.com:443/network-awai/awai-os/{REV}/store/distribution/dev/app0.apk'),
        ('traversal /../', f'{BASE}../evil.apk'),
        ('trailing /..', f'{BASE}dir/..'),
        ('percent-encoded path', f'{BASE}%2e%2e/evil.apk'),
        ('query string', f'{BASE}app0.apk?token=1'),
        ('fragment', f'{BASE}app0.apk#frag'),
        ('trailing slash', f'{BASE}dir/'),
    ]:
        bad_doc = make_pins_dict(1)
        bad_doc['apks']['network.itonami.app0']['url'] = bad_url
        rejects_bytes(f'URL {label}', json.dumps(bad_doc, separators=(',', ':')).encode('utf-8'))

    # 3. Serialized byte ceiling: 32,769 bytes (64 APKs) rejected; 32,768 bytes (64 APKs) accepted.
    over64_bytes = json.dumps(make_pins_dict(64, build.MAX_ONLINE_PIN_BYTES + 1), separators=(',', ':')).encode('utf-8')
    check('over64 fixture is exactly 32,769 bytes', len(over64_bytes) == build.MAX_ONLINE_PIN_BYTES + 1, str(len(over64_bytes)))
    rejects_bytes('64 APKs exceeding 32,768 bytes (32,769 B)', over64_bytes)

    exact64_bytes = json.dumps(make_pins_dict(64, build.MAX_ONLINE_PIN_BYTES), separators=(',', ':')).encode('utf-8')
    check('exact64 fixture is exactly 32,768 bytes', len(exact64_bytes) == build.MAX_ONLINE_PIN_BYTES, str(len(exact64_bytes)))
    _, exact64_serialized = build.validate_online_pins_bytes(exact64_bytes)
    check('exact 32,768-byte 64-APK document validates cleanly', len(exact64_serialized.encode('utf-8')) == build.MAX_ONLINE_PIN_BYTES)

    dev_bytes = (ROOT / 'android/online-pins.dev.json').read_bytes()
    dev_pins, dev_serialized = build.validate_online_pins_bytes(dev_bytes)
    check('checked-in online-pins.dev.json validates cleanly', len(dev_pins['apks']) >= 17 and len(dev_serialized.encode('utf-8')) <= build.MAX_ONLINE_PIN_BYTES)

    # 4. End-to-end build.py CLI rejection BEFORE any APK is generated.
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = pathlib.Path(tmp)
        for label, bad_raw in [
            ('decimal maxBytes (1024.0)', good_one.replace('1048576', '1024.0').encode('utf-8')),
            ('64 APKs over 32,768 bytes', over64_bytes),
        ]:
            pin_file = tmp_path / (label.replace(' ', '_').replace('(', '').replace(')', '').replace(',', '') + '.json')
            out_dir = tmp_path / ('out_' + pin_file.stem)
            pin_file.write_bytes(bad_raw)
            r = subprocess.run(
                [sys.executable, str(ROOT / 'android/build.py'), '--store-only', '--skip-cljs',
                 '--online-pins', str(pin_file), '--out', str(out_dir)],
                capture_output=True, text=True,
            )
            apks_created = list(out_dir.rglob('*.apk')) if out_dir.exists() else []
            check(f'build.py CLI rejects {label} before generating any APK',
                  r.returncode != 0 and len(apks_created) == 0,
                  f'rc={r.returncode} apks={apks_created} stderr={r.stderr.strip()}')

        # 5. Round-trip: exact bytes emitted by build.py for both online-pins.dev.json and exact 32,768-byte
        # 64-APK pins pass BOTH online-csp.mjs AND Java OnlinePins + Integrity.read + Catalog.
        stage = tmp_path / 'web'
        stage.mkdir()
        shutil.copyfile(ROOT / 'android/client/online.js', stage / 'online.js')
        shutil.copyfile(ROOT / 'android/client/key-list.js', stage / 'key-list.js')
        shutil.copyfile(ROOT / 'otehon/shell/vendor/kotoba-client-runtime.js', stage / 'runtime.js')
        descriptor = json.loads(subprocess.run(
            ['bb', '-cp', 'android/contracts/src', 'android/contracts/export.clj', str(tmp_path / 'shared.json')],
            cwd=ROOT, check=True, capture_output=True, text=True,
        ).stdout or (tmp_path / 'shared.json').read_text())['descriptor']

        # Compile CatalogOnlinePinsCheck once when JDK + android.jar are available.
        java_bin = pathlib.Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')) / 'bin'
        sdk = pathlib.Path(os.environ.get('ANDROID_SDK_ROOT', str(pathlib.Path.home() / 'Library/Android/sdk')))
        android_jar = next((p for p in (sdk / 'platforms/android-37.0/android.jar', sdk / 'platforms/android-36/android.jar') if p.is_file()), None)
        jvm_classes = None
        if (java_bin / 'javac').is_file() and android_jar is not None:
            jvm_classes = tmp_path / 'jvm'
            jvm_classes.mkdir()
            src = ROOT / 'android/shared/src/network/awai/platform'
            subprocess.run([
                str(java_bin / 'javac'), '--release', '8', '-Xlint:-options', '-encoding', 'UTF-8',
                '-cp', str(android_jar), '-d', str(jvm_classes),
                str(src / 'Integrity.java'), str(src / 'KeyList.java'), str(src / 'StoreTrust.java'),
                str(src / 'OnlinePins.java'), str(src / 'LatestPointer.java'), str(src / 'Catalog.java'),
                str(ROOT / 'android/tests/jvm-pins/CatalogOnlinePinsCheck.java'),
            ], check=True)

        for label, serialized, expected_count in [
            ('online-pins.dev.json', dev_serialized, len(dev_pins['apks'])),
            ('exact 32,768-byte 64-APK pins', exact64_serialized, 64),
        ]:
            csp_in = json.dumps({
                'assets': str(stage),
                'pins': json.loads(serialized),
                'pinsJson': serialized,
                'descriptor': descriptor,
            })
            csp = subprocess.run(['node', str(ROOT / 'android/online-csp.mjs')], input=csp_in, capture_output=True, text=True)
            check(f'round-trip online-csp.mjs accepts build.py bytes for {label}',
                  csp.returncode == 0 and csp.stdout.strip() == 'connect-src https://raw.githubusercontent.com',
                  f'rc={csp.returncode} out={csp.stdout.strip()} err={csp.stderr.strip()}')

            if jvm_classes is not None:
                ser_file = tmp_path / f'{expected_count}-serialized.json'
                ser_file.write_bytes(serialized.encode('utf-8'))
                jvm = subprocess.run([
                    str(java_bin / 'java'), '-cp', f'{jvm_classes}:{android_jar}',
                    'CatalogOnlinePinsCheck', '--pins-file', str(ser_file), str(expected_count),
                ], capture_output=True, text=True)
                check(f'round-trip JVM OnlinePins+Catalog accepts build.py bytes for {label}',
                      jvm.returncode == 0,
                      f'rc={jvm.returncode} out={jvm.stdout.strip()} err={jvm.stderr.strip()}')

    failed = [r for r in results if not r['ok']]
    print(json.dumps({'checks': len(results), 'failed': len(failed), 'results': results}, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
