#!/usr/bin/env python3
"""Checks android/series-catalog.py with placeholder APKs and release.json files made here (AWAI-3771).

No series APK exists yet, so each test APK is a minimal package (manifest and label only) linked with aapt2 and
signed with a throwaway key per signing-key group. Keys live in a temporary directory with a random password held
in this process's environment, and are deleted at the end. Nothing is installed, committed or published.

  python3 android/tests/series-catalog.py
"""
import hashlib, json, os, pathlib, secrets, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
SDK = pathlib.Path.home() / 'Library/Android/sdk'
TOOLS = SDK / 'build-tools/36.1.0'
JAR = SDK / 'platforms/android-37.0/android.jar'
JAVA = pathlib.Path(os.environ.get('JAVA_HOME', '/opt/homebrew/opt/openjdk')) / 'bin'
GEN = ROOT / 'android/series-catalog.py'
results = []


def check(name, ok, detail=''):
    results.append({'check': name, 'ok': bool(ok)} | ({'detail': detail[-400:]} if detail and not ok else {}))


def run(*cmd, env=None):
    return subprocess.run([str(c) for c in cmd], capture_output=True, text=True, env=env)


def main():
    env = dict(os.environ, SERIES_TEST_PASS=secrets.token_urlsafe(24))
    table = json.loads((ROOT / 'store/catalog-source/series-apps.json').read_text())
    with tempfile.TemporaryDirectory() as t:
        t = pathlib.Path(t)
        # One throwaway key per group used below; the test table points each group at its key.
        signer = {}
        for g in ('isic-N', 'isic-J', 'isco-2'):
            ks = t / f'{g}.p12'
            r = run(JAVA / 'keytool', '-genkeypair', '-keystore', ks, '-storetype', 'PKCS12', '-alias', 'k', '-keyalg', 'RSA', '-keysize', '2048',
                    '-validity', '2', '-dname', f'CN=series test {g}', '-storepass:env', 'SERIES_TEST_PASS', env=env)
            if r.returncode: sys.exit(r.stderr)
            der = subprocess.run([str(JAVA / 'keytool'), '-exportcert', '-keystore', str(ks), '-alias', 'k', '-storepass:env', 'SERIES_TEST_PASS'],
                                 capture_output=True, env=env, check=True).stdout
            signer[g] = hashlib.sha256(der).hexdigest()
        for g in signer: table['groups'][g]['signerSha256'] = signer[g]

        def write_table(tab, name='table.json'):
            (t / name).write_text(json.dumps(tab, ensure_ascii=False))
            return t / name

        def apk(out, package, version_name, label, group, version_code=1):
            stage = out.parent / (out.name + '.stage'); stage.mkdir(parents=True, exist_ok=True)
            (stage / 'AndroidManifest.xml').write_text(
                f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{package}" '
                f'android:versionCode="{version_code}" android:versionName="{version_name}"><uses-sdk android:minSdkVersion="33" '
                f'android:targetSdkVersion="37"/><application android:label="{label}"/></manifest>')
            r = run(TOOLS / 'aapt2', 'link', '-o', stage / 'u.apk', '--manifest', stage / 'AndroidManifest.xml', '-I', JAR)
            if r.returncode: sys.exit(r.stderr)
            run(TOOLS / 'zipalign', '-f', '4', stage / 'u.apk', stage / 'a.apk')
            r = run(TOOLS / 'apksigner', 'sign', '--ks', t / f'{group}.p12', '--ks-key-alias', 'k', '--ks-pass', 'env:SERIES_TEST_PASS',
                    '--out', out, stage / 'a.apk', env=env)
            if r.returncode: sys.exit(r.stderr)
            shutil.rmtree(stage)

        def app_input(root, source, *, group, release_id=None, release_source=None, version='0.1.0', apk_version=None,
                      package=None, operations=(), descriptor_digest=None, label=None, commit=None, dirty=False):
            d = root / source; d.mkdir(parents=True)
            pid = 'network.itonami.' + source.replace('-', '')
            descriptor = json.dumps({'schema': 'kotoba.app.client-runtime.v1', 'operations': list(operations)}).encode()
            (d / 'descriptor.json').write_bytes(descriptor)
            release = {'schema': 'awai.app.artifact.v1', 'id': release_id or pid, 'source': release_source or 'cloud-itonami-' + source,
                       'version': version, 'files': {'descriptor.json': descriptor_digest or hashlib.sha256(descriptor).hexdigest()}}
            # As the series app build writes them: source_commit (40 hex, or null without git) and dirty (true/false/null).
            release['source_commit'] = commit
            if dirty != 'absent': release['dirty'] = dirty
            (d / 'release.json').write_text(json.dumps(release))
            apk(d / 'app-release.apk', package or pid, apk_version or version, label or f'Series test {source}', group)

        def generate(inputs, tab, out='raw.json', extra=()):
            return run(sys.executable, GEN, '--inputs', inputs, '--revision', '200', '--out', t / out, '--table', tab, '--report', t / (out + '.report'),
                       '--repos', t / 'repos', *extra)

        # A stand-in app repository: before, the commit that adds the ISCO-08 source text, and after.
        repo = t / 'repos/isco-2423'; repo.mkdir(parents=True)
        git = lambda *a: subprocess.run(['git', '-C', str(repo), *a], capture_output=True, text=True, check=True).stdout.strip()
        git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'series test')
        commits = {}
        for name in ('before', 'source', 'after'):
            (repo / 'x').write_text(name); git('add', 'x'); git('commit', '-q', '-m', name); commits[name] = git('rev-parse', 'HEAD')

        # Positive: two ISIC apps in different groups; one ISCO app without its source check; one app not built yet.
        good = t / 'good'
        app_input(good, 'isic-7810', group='isic-N')
        app_input(good, 'isic-6209', group='isic-J')
        app_input(good, 'isco-2423', group='isco-2')
        # The real table marks the four ISCO-08 apps with their repositories' commits; the basic run uses a copy
        # without the marks, and the marks have their own checks below.
        marks = {a['source']: a['iscoSource'] for a in table['apps'] if a['source'].startswith('isco-')}
        check('the real table marks the four ISCO-08 apps with the commits that added their source text',
              marks == {'isco-2423': {'commit': '5bf9ea32d105d679254d8f48f61c7cc8d5fb177e'}, 'isco-3333': {'commit': '29773278fee35c246dc7e0c4033d5e69f5734113'},
                        'isco-4311': {'commit': 'b796093e8996567909347036e9445f68034701ea'}, 'isco-2411': {'commit': '4e578b83efc0050a2de772f7736b7916e525808b'}}, str(marks))
        for a in table['apps']:
            if a['source'].startswith('isco-'): a['iscoSource'] = None
        tab = write_table(table)
        r = generate(good, tab)
        check('generator succeeds', r.returncode == 0, r.stderr)
        raw = json.loads((t / 'raw.json').read_text()) if r.returncode == 0 else {'apps': []}
        report = json.loads((t / 'raw.json.report').read_text()) if r.returncode == 0 else {'listed': [], 'excluded': []}
        check('lists the two ISIC apps in table order', [a['id'] for a in raw['apps']] == ['network.itonami.isic7810', 'network.itonami.isic6209'])
        excluded = {e['source']: e['reason'] for e in report['excluded']}
        check('leaves out the ISCO-08 app whose source is unchecked', excluded.get('isco-2423') == 'isco-source-unchecked')
        check('leaves out every unmarked ISCO-08 app',
              all(excluded.get(a['source']) == 'isco-source-unchecked' for a in table['apps'] if a['source'].startswith('isco-')))
        check('leaves out apps with no APK yet', excluded.get('isic-7820') == 'no-apk' and excluded.get('isic-8020') == 'no-apk')
        entry = next((a for a in raw['apps'] if a['id'] == 'network.itonami.isic7810'), {})
        apk_bytes = (good / 'isic-7810/app-release.apk').read_bytes()
        art = (entry.get('artifacts') or [{}])[0]
        check('entry carries the APK digest, size and the group signer', art.get('sha256') == hashlib.sha256(apk_bytes).hexdigest()
              and art.get('bytes') == len(apk_bytes) and art.get('signerSha256') == signer['isic-N'] and art.get('asset') == 'packages/isic7810.apk')
        check('entry name is the APK label, versions from the APK, no operations',
              entry.get('name') == 'Series test isic-7810' and entry.get('versionCode') == 1 and entry.get('versionName') == '0.1.0' and entry.get('operations') == [])

        # The catalog body is accepted by the Store's shared domain rules.
        domain = ROOT / 'android/client/generated/domain.js'
        js = ("const vm=require('vm'),fs=require('fs');const c=vm.createContext({window:{}});vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);"
              "const raw=fs.readFileSync(process.argv[2],'utf8');console.log(c.window.ItonamiDomain.validCatalog(raw,Math.floor(Date.now()/1000)));")
        r = run('node', '-e', js, domain, t / 'raw.json')
        check('the shared Store domain accepts the catalog body', r.stdout.strip() == 'true', r.stdout + r.stderr)

        # Signed with a catalog key from a key list, as the Store verifies it.
        for n in ('root', 'catalog', 'pointer'):
            run(JAVA / 'keytool', '-genkeypair', '-keystore', t / f'{n}.p12', '-storetype', 'PKCS12', '-alias', n, '-keyalg', 'RSA', '-keysize', '2048',
                '-validity', '2', '-dname', f'CN=series test {n}', '-storepass:env', 'SERIES_TEST_PASS', env=env)
            run(sys.executable, ROOT / 'android/key-list.py', 'export', '--keystore', t / f'{n}.p12', '--alias', n, '--pass-env', 'SERIES_TEST_PASS',
                '--out', t / f'{n}.der', env=env)
        p = json.loads(run(sys.executable, ROOT / 'android/key-list.py', 'prepare', '--sequence', '1', '--catalog-key', t / 'catalog.der',
                           '--pointer-key', t / 'pointer.der', '--lifetime-days', '2', '--out', t / 'keys.txt', '--allow-sequence').stdout)
        run(sys.executable, ROOT / 'android/key-list.py', 'sign', '--list', t / 'keys.txt', '--expected-sha256', p['sha256'], '--keystore', t / 'root.p12',
            '--alias', 'root', '--pass-env', 'SERIES_TEST_PASS', '--expected-root', hashlib.sha256((t / 'root.der').read_bytes()).hexdigest(),
            '--out-dir', t / 'list', env=env)
        r = run(sys.executable, ROOT / 'android/sign-catalog-envelope.py', '--raw', t / 'raw.json', '--key-list', t / 'list', '--keystore', t / 'catalog.p12',
                '--alias', 'catalog', '--pass-env', 'SERIES_TEST_PASS', '--out', t / 'envelope.json', env=env)
        check('the body is signed by the listed catalog key', r.returncode == 0 and json.loads(r.stdout)['apps'] == 2, r.stderr)

        # Carrying the current catalog forward.
        base = ROOT / 'store/distribution/dev-20261122-r110/catalog-rev110-raw.json'
        r = generate(good, tab, 'carried.json', ('--base', base))
        carried = json.loads((t / 'carried.json').read_text()) if r.returncode == 0 else {'apps': []}
        check('carries the base catalog entries and appends the series apps', r.returncode == 0 and len(carried['apps']) == 10
              and [a['id'] for a in carried['apps']][-2:] == ['network.itonami.isic7810', 'network.itonami.isic6209'], r.stderr)

        # A build from uncommitted changes, or with an unknown state, is left out, for every app.
        for label, dirty in (('dirty true', True), ('dirty null', None), ('no dirty field', 'absent')):
            root = t / ('dirty-' + label.replace(' ', '-'))
            app_input(root, 'isic-7810', group='isic-N', commit='1' * 40, dirty=dirty)
            out = 'dirty-' + label.replace(' ', '-') + '.json'
            r = generate(root, tab, out)
            rep = json.loads((t / (out + '.report')).read_text()) if r.returncode == 0 else {'listed': [], 'excluded': []}
            check(f'leaves out a release with {label} as release-dirty', r.returncode == 0 and rep['listed'] == []
                  and {e['source']: e['reason'] for e in rep['excluded']}.get('isic-7810') == 'release-dirty', r.stderr)

        # An ISCO-08 app marked with the commit that added its source text: listed only when its release.json records
        # that commit or a later one.
        checked = json.loads(json.dumps(table)); next(a for a in checked['apps'] if a['source'] == 'isco-2423')['iscoSource'] = {'commit': commits['source']}
        ctab = write_table(checked, 'checked.json')
        for label, commit, listed, reason in (('the marked commit', commits['source'], True, None), ('a later commit', commits['after'], True, None),
                                              ('an earlier commit', commits['before'], False, 'built-before-isco-source'),
                                              ('no source_commit in release.json', None, False, 'release-without-commit')):
            root = t / ('isco-' + label.replace(' ', '-'))
            app_input(root, 'isco-2423', group='isco-2', commit=commit)
            out = 'isco-' + label.replace(' ', '-') + '.json'
            r = generate(root, ctab, out)
            rep = json.loads((t / (out + '.report')).read_text()) if r.returncode == 0 else {'listed': [], 'excluded': []}
            got_listed = [x['id'] for x in rep['listed']] == ['network.itonami.isco2423']
            got_reason = {e['source']: e['reason'] for e in rep['excluded']}.get('isco-2423')
            check(f'marked ISCO-08 app built from {label}: ' + ('listed' if listed else reason),
                  r.returncode == 0 and got_listed == listed and (listed or got_reason == reason), r.stderr)

        # Refusals: each stops the whole run and writes nothing.
        def refused(name, setup, want, tab_override=None):
            root = t / ('neg-' + str(len(results)))
            setup(root)
            out = 'neg-' + str(len(results)) + '.json'
            r = generate(root, tab_override or tab, out)
            check(name, r.returncode != 0 and want in r.stderr and not (t / out).exists(), r.stderr)

        refused('APK signed by another group\'s key', lambda d: app_input(d, 'isic-7810', group='isic-J'), 'single signer of group isic-N')
        refused('release.json id is not the table id', lambda d: app_input(d, 'isic-7810', group='isic-N', release_id='network.itonami.isic7810x'), 'release.json id')
        refused('release.json source is another repository', lambda d: app_input(d, 'isic-7810', group='isic-N', release_source='cloud-itonami-isic-7820'), 'release.json source')
        refused('APK versionName differs from the release', lambda d: app_input(d, 'isic-7810', group='isic-N', apk_version='0.1.1'), 'versionName')
        refused('APK package differs from the table', lambda d: app_input(d, 'isic-7810', group='isic-N', package='network.itonami.isic7811'), 'APK package')
        refused('descriptor is not the pinned one', lambda d: app_input(d, 'isic-7810', group='isic-N', descriptor_digest='0' * 64), 'descriptor.json is not')
        refused('descriptor declares an external operation', lambda d: app_input(d, 'isic-7810', group='isic-N', operations=[{'operation': 'x'}]), 'external operations')
        refused('label over 80 characters', lambda d: app_input(d, 'isic-7810', group='isic-N', label='x' * 81), 'label')
        wrong_group = json.loads(json.dumps(table)); next(a for a in wrong_group['apps'] if a['source'] == 'isic-7810')['group'] = 'isic-J'
        refused('table puts an app in the wrong group', lambda d: app_input(d, 'isic-6209', group='isic-J'), 'its code puts it in isic-N', write_table(wrong_group, 'wg.json'))
        wrong_id = json.loads(json.dumps(table)); next(a for a in wrong_id['apps'] if a['source'] == 'isic-7120-cyberassurance')['id'] = 'network.itonami.isic7120'
        refused('table package id is not the series identifier', lambda d: app_input(d, 'isic-6209', group='isic-J'), 'the series build stamps', write_table(wrong_id, 'wi.json'))
        no_mark = json.loads(json.dumps(table)); del next(a for a in no_mark['apps'] if a['source'] == 'isco-4311')['iscoSource']
        refused('ISCO-08 app without a source mark', lambda d: app_input(d, 'isic-6209', group='isic-J'), 'no iscoSource mark', write_table(no_mark, 'nm.json'))
        bad_mark = json.loads(json.dumps(table)); next(a for a in bad_mark['apps'] if a['source'] == 'isco-4311')['iscoSource'] = True
        refused('ISCO-08 mark that is not a commit', lambda d: app_input(d, 'isic-6209', group='isic-J'), 'not {"commit"', write_table(bad_mark, 'bm.json'))
        unknown = json.loads(json.dumps(table)); next(a for a in unknown['apps'] if a['source'] == 'isco-2423')['iscoSource'] = {'commit': '0' * 40}
        refused('marked commit missing from the clone', lambda d: app_input(d, 'isco-2423', group='isco-2', commit=commits['after']), 'is not in the clone',
                write_table(unknown, 'uk.json'))
        r = generate(good, tab, 'collide.json', ('--base', t / 'raw.json', '--revision', '201'))
        check('refuses an app already in the base catalog', r.returncode != 0 and 'already in the base catalog' in (r.stderr + r.stdout), r.stderr)
        leaked = [str(p) for p in t.glob('*.report') if env['SERIES_TEST_PASS'] in p.read_text()]
        check('password is absent from the reports', not leaked)

    failed = [r for r in results if not r['ok']]
    print(json.dumps({'schema': 'awai.android.series-catalog-test.v1', 'checks': len(results), 'failed': len(failed), 'results': results},
                     ensure_ascii=False, indent=1))
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
