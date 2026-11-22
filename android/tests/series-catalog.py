#!/usr/bin/env python3
"""Checks android/series-catalog.py with placeholder APKs and release.json files made here (AWAI-3771).

No series APK exists yet, so each test APK is a minimal package (manifest and label only) linked with aapt2 and
signed with a throwaway key per signing-key group. Keys live in a temporary directory with a random password held
in this process's environment, and are deleted at the end. Nothing is installed, committed or published.

  python3 android/tests/series-catalog.py
"""
import hashlib, json, os, pathlib, re, secrets, shutil, subprocess, sys, tempfile

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
        for g in ('isic-N', 'isic-J', 'isco-2', 'unspsc-10', 'isic-Q'):
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
            # An ISIC app without an explicit commit is built from a stand-in repository whose blueprint.edn says isic-rev5.
            if commit is None and source.startswith('isic-'):
                commit = isic_repo(source)
            release['source_commit'] = None if commit == 'none' else commit
            if dirty != 'absent': release['dirty'] = dirty
            (d / 'release.json').write_text(json.dumps(release))
            apk(d / 'app-release.apk', package or pid, apk_version or version, label or f'Series test {source}', group)

        # Stand-in ISIC repositories: blueprint.edn with the classification key; one commit per distinct blueprint text.
        def isic_repo(source, blueprint=None):
            code = source.split('-')[1]
            text = blueprint if blueprint is not None else (
                f'{{:itonami.blueprint/id "cloud-itonami-{source}"\n :itonami.blueprint/isic-rev5 "{code}"\n :itonami.blueprint/name "Test"}}\n')
            clone = t / 'repos' / source
            g = lambda *a: subprocess.run(['git', '-C', str(clone), *a], capture_output=True, text=True, check=True).stdout.strip()
            if not clone.exists():
                clone.mkdir(parents=True)
                g('init', '-q'); g('config', 'user.email', 'test@example.invalid'); g('config', 'user.name', 'series test')
            (clone / 'blueprint.edn').write_text(text)
            g('add', 'blueprint.edn')
            g('commit', '-q', '--allow-empty', '-m', 'blueprint')
            return g('rev-parse', 'HEAD')

        ISIC_7810_DESC = 'ISIC Rev.5 7810 の系列アプリ（開発版）。記録と判断はこの端末の中だけで行い、外部への送信はありません。'

        # ISCO-08 source marks: repo, commit, ja (store/catalog-source/isco-source.tsv form).
        def write_marks(rows, name='marks.tsv'):
            (t / name).write_text('repo\tcommit\tja\n' + ''.join(f'{r}\t{c}\t{j}\n' for r, c, j in rows))
            return t / name
        no_marks = write_marks([], 'no-marks.tsv')
        REPO = 'cloud-itonami/app-itonami-cloud-itonami-isco-2423'

        def generate(inputs, tab, out='raw.json', extra=(), marks=None, hold=None, unspsc=None):
            return run(sys.executable, GEN, '--inputs', inputs, '--revision', '200', '--out', t / out, '--table', tab, '--report', t / (out + '.report'),
                       '--repos', t / 'repos', '--isco-source', marks or no_marks, '--hold', hold or ROOT / 'store/catalog-source/hold.json',
                       '--unspsc-source', unspsc or no_marks, *extra)

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
        # The marks live in isco-source.tsv. The four earlier marks pointed at the earlier wording and were cleared, so
        # the real file holds the header only until the final text is added (batches via android/isco-source-add.py).
        real = (ROOT / 'store/catalog-source/isco-source.tsv').read_text(encoding='utf-8')
        count = lambda path, scheme: run(sys.executable, '-c',
            'import importlib.util,sys;s=importlib.util.spec_from_file_location("m",sys.argv[1]);m=importlib.util.module_from_spec(s);'
            's.loader.exec_module(m);print(len(m.read_source_marks(open(sys.argv[2]).read(),sys.argv[3])))', GEN, path, scheme).stdout.strip()
        check('the real isco-source.tsv parses', count(ROOT / 'store/catalog-source/isco-source.tsv', 'isco').isdigit(), real)
        check('the real unspsc-source.tsv parses', count(ROOT / 'store/catalog-source/unspsc-source.tsv', 'unspsc').isdigit())
        check('the table carries no iscoSource field', all('iscoSource' not in a for a in table['apps']))
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
        # AWAI-3882: defined once, artifacts carry the resolved value — every generated entry's
        # publisher equals the single top-level definition, never a per-entry copy.
        check('every generated entry carries the single-definition publisher',
              bool(raw['apps']) and all(a.get('publisher') == table['publisher'] for a in raw['apps']),
              json.dumps([a.get('publisher') for a in raw['apps']]))
        check('the table carries no per-entry publisher field',
              all('publisher' not in a for a in table['apps']))

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
        ctab = tab
        marked = write_marks([(REPO, commits['source'], 'false')], 'marked.tsv')
        for label, commit, listed, reason in (('the marked commit', commits['source'], True, None), ('a later commit', commits['after'], True, None),
                                              ('an earlier commit', commits['before'], False, 'built-before-isco-source'),
                                              ('no source_commit in release.json', None, False, 'release-without-commit')):
            root = t / ('isco-' + label.replace(' ', '-'))
            app_input(root, 'isco-2423', group='isco-2', commit=commit)
            out = 'isco-' + label.replace(' ', '-') + '.json'
            r = generate(root, ctab, out, marks=marked)
            rep = json.loads((t / (out + '.report')).read_text()) if r.returncode == 0 else {'listed': [], 'excluded': []}
            got_listed = [x['id'] for x in rep['listed']] == ['network.itonami.isco2423']
            got_reason = {e['source']: e['reason'] for e in rep['excluded']}.get('isco-2423')
            check(f'marked ISCO-08 app built from {label}: ' + ('listed' if listed else reason),
                  r.returncode == 0 and got_listed == listed and (listed or got_reason == reason), r.stderr)
            if reason == 'built-before-isco-source':
                # As with an App Build APK made before the README commit became the mark (isco-2423 2102ed33).
                e = next((x for x in rep['excluded'] if x['source'] == 'isco-2423'), {})
                check('an APK built before the source mark says which commits and what to do',
                      e.get('mark') == commits['source'] and e.get('sourceCommit') == commits['before']
                      and e.get('detail') == f'APK built from {commits["before"][:12]}, which is before the source mark '
                                             f'{commits["source"][:12]} (isco-source.tsv); rebuild from {commits["source"][:12]} or a later commit',
                      json.dumps(e))

        # The ILO reference (AWAI-3629): exactly this text, once, at the end of the ISCO-08 app's description;
        # Japanese only when ja is true; nothing on ISIC apps.
        EN = ('Occupation reference: ISCO-08 (International Labour Organization, 2012), code 2423. '
              'This app is not produced, reviewed or endorsed by the ILO.')
        JA = ('職業の参照: ISCO-08（国際労働機関 ILO、2012 年）のコード 2423。日本語の名称は当方の訳です。'
              'この app は ILO が作成・確認・推奨したものではありません。')
        base_desc = next(a['description'] for a in table['apps'] if a['source'] == 'isco-2423')
        attr = t / 'attribution'
        app_input(attr, 'isco-2423', group='isco-2', commit=commits['source'])
        app_input(attr, 'isic-7810', group='isic-N')
        for ja, want in (('false', base_desc + '\n\n' + EN), ('true', base_desc + '\n\n' + EN + '\n' + JA)):
            out = f'attr-{ja}.json'
            r = generate(attr, tab, out, marks=write_marks([(REPO, commits['source'], ja)], f'attr-{ja}.tsv'))
            apps = {a['id']: a for a in json.loads((t / out).read_text())['apps']} if r.returncode == 0 else {}
            got = apps.get('network.itonami.isco2423', {}).get('description')
            check(f'ISCO-08 description ends with the exact ILO reference (ja {ja})', got == want, repr(got))
            check(f'the ILO reference appears once (ja {ja})', got is not None and got.count('Occupation reference') == 1
                  and got.count('職業の参照') == (1 if ja == 'true' else 0))
            isic = apps.get('network.itonami.isic7810', {}).get('description')
            check(f'no ILO reference on an ISIC app (ja {ja})', isic == ISIC_7810_DESC, repr(isic))
        r = generate(attr, tab, 'attr-other.json', marks=write_marks([(REPO, commits['source'], 'false'),
                     ('cloud-itonami/app-itonami-cloud-itonami-isco-9111', '1' * 40, 'true')], 'attr-other.tsv'))
        check('a mark for a repository outside the table changes nothing', r.returncode == 0
              and [a['id'] for a in json.loads((t / 'attr-other.json').read_text())['apps']] == ['network.itonami.isco2423', 'network.itonami.isic7810'], r.stderr)

        # Refusals: each stops the whole run and writes nothing.
        def refused(name, setup, want, tab_override=None, marks=None):
            root = t / ('neg-' + str(len(results)))
            setup(root)
            out = 'neg-' + str(len(results)) + '.json'
            r = generate(root, tab_override or tab, out, marks=marks)
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
        with_field = json.loads(json.dumps(table)); next(a for a in with_field['apps'] if a['source'] == 'isco-4311')['iscoSource'] = {'commit': '1' * 40}
        refused('a mark in the table instead of isco-source.tsv', lambda d: app_input(d, 'isic-6209', group='isic-J'), 'live in isco-source.tsv',
                write_table(with_field, 'wf.json'))
        for name, rows, want in (('a short commit', [(REPO, commits['source'][:12], 'false')], 'not 40 lowercase hex'),
                                 ('an upper-case commit', [(REPO, commits['source'].upper(), 'false')], 'not 40 lowercase hex'),
                                 ('a ja that is not true or false', [(REPO, commits['source'], 'yes')], 'ja must be true or false'),
                                 ('an ISIC repository', [('cloud-itonami/app-itonami-cloud-itonami-isic-7810', commits['source'], 'false')], 'not an ISCO-08'),
                                 ('a repository listed twice', [(REPO, commits['source'], 'false'), (REPO, commits['after'], 'false')], 'listed twice')):
            refused(f'isco-source.tsv with {name}', lambda d: app_input(d, 'isic-6209', group='isic-J'), want, marks=write_marks(rows, 'bad.tsv'))
        (t / 'nohead.tsv').write_text(f'{REPO}\t{commits["source"]}\tfalse\n')
        refused('isco-source.tsv without its header', lambda d: app_input(d, 'isic-6209', group='isic-J'), 'header', marks=t / 'nohead.tsv')
        refused('marked commit missing from the clone', lambda d: app_input(d, 'isco-2423', group='isco-2', commit=commits['after']), 'is not in the clone',
                marks=write_marks([(REPO, '0' * 40, 'false')], 'missing.tsv'))

        # ISIC revision: from blueprint.edn at the build commit, never written by hand (AWAI-3771).
        check('the real table has no hand-written ISIC description', all('description' not in a for a in table['apps'] if a['source'].startswith('isic-')))
        rev = t / 'rev'
        app_input(rev, 'isic-6209', group='isic-J', commit=isic_repo('isic-6209',
                  '{:itonami.blueprint/id "cloud-itonami-isic-6209"\n :itonami.blueprint/isic-rev4 "6209"}\n'))
        app_input(rev, 'isic-7810', group='isic-N')
        r = generate(rev, tab, 'rev.json')
        apps = {a['id']: a for a in json.loads((t / 'rev.json').read_text())['apps']} if r.returncode == 0 else {}
        check('isic-rev5 in blueprint.edn gives "ISIC Rev.5 7810 …" exactly', apps.get('network.itonami.isic7810', {}).get('description') == ISIC_7810_DESC, r.stderr)
        check('isic-rev4 in blueprint.edn gives "ISIC Rev.4 6209 …" exactly', apps.get('network.itonami.isic6209', {}).get('description') ==
              'ISIC Rev.4 6209 の系列アプリ（開発版）。記録と判断はこの端末の中だけで行い、外部への送信はありません。', r.stderr)
        check('no UN classification text (includes / excludes) in ISIC descriptions',
              all(not re.search(r'(?i)includ|exclud', a['description']) for a in apps.values()))
        fixed = json.loads(json.dumps(table))
        next(a for a in fixed['apps'] if a['source'] == 'isic-7810')['description'] = ISIC_7810_DESC
        r = generate(rev, write_table(fixed, 'fixed-ok.json'), 'fixed-ok.json')
        check('a table description that matches blueprint.edn is accepted', r.returncode == 0, r.stderr)
        next(a for a in fixed['apps'] if a['source'] == 'isic-7810')['description'] = ISIC_7810_DESC.replace('Rev.5', 'Rev.4')
        r = generate(rev, write_table(fixed, 'fixed-bad.json'), 'fixed-bad.json')
        check('a table description that disagrees with blueprint.edn is refused', r.returncode != 0 and 'disagrees with blueprint.edn' in r.stderr, r.stderr)
        for name, text, want in (
                ('both revisions', '{:itonami.blueprint/isic-rev4 "8020"\n :itonami.blueprint/isic-rev5 "8020"}\n', 'names 2 ISIC revisions'),
                ('no revision', '{:itonami.blueprint/id "cloud-itonami-isic-8020"}\n', 'names 0 ISIC revisions'),
                ('another code', '{:itonami.blueprint/isic-rev5 "8010"}\n', 'not the code of isic-8020')):
            d = t / ('bp-' + name.replace(' ', '-'))
            app_input(d, 'isic-8020', group='isic-N', commit=isic_repo('isic-8020', text))
            r = generate(d, tab, 'bp.json')
            check(f'blueprint.edn with {name} is refused', r.returncode != 0 and want in r.stderr, r.stderr)
        nocommit = t / 'isic-no-commit'
        app_input(nocommit, 'isic-7810', group='isic-N', commit='none')
        r = generate(nocommit, tab, 'isic-no-commit.json')
        x = {e['source']: e['reason'] for e in json.loads((t / 'isic-no-commit.json.report').read_text())['excluded']} if r.returncode == 0 else {}
        check('an ISIC release without source_commit is left out as release-without-commit', x.get('isic-7810') == 'release-without-commit', r.stderr)

        # App Cycle ranks 11-15 are in the table; --top N keeps a catalog to ranks 1..N.
        ranked = [(a['rank'], a['source'], a['id'], a['group']) for a in table['apps'] if a.get('rank') is not None]
        check('the real table has App Cycle ranks 1-15, with 11-15 as given',
              [x[0] for x in ranked] == list(range(1, 16)) and ranked[10:] == [
                  (11, 'isco-2221', 'network.itonami.isco2221', 'isco-2'), (12, 'isic-8810', 'network.itonami.isic8810', 'isic-Q'),
                  (13, 'isco-2634', 'network.itonami.isco2634', 'isco-2'), (14, 'isco-2320', 'network.itonami.isco2320', 'isco-2'),
                  (15, 'isco-9111', 'network.itonami.isco9111', 'isco-9')], str(ranked[10:]))
        topin = t / 'top'
        app_input(topin, 'isic-7810', group='isic-N')
        app_input(topin, 'isic-8810', group='isic-Q')
        r = generate(topin, tab, 'all.json')
        check('without --top, rank 12 (isic-8810) is listed', r.returncode == 0
              and [a['id'] for a in json.loads((t / 'all.json').read_text())['apps']] == ['network.itonami.isic7810', 'network.itonami.isic8810'], r.stderr)
        r = generate(topin, tab, 'top10.json', ('--top', '10'))
        trep = json.loads((t / 'top10.json.report').read_text()) if r.returncode == 0 else {'listed': [], 'excluded': []}
        tx = {e['source']: e for e in trep['excluded']}
        check('--top 10 lists rank 2 and leaves rank 12 out as outside-top', r.returncode == 0
              and [x['id'] for x in trep['listed']] == ['network.itonami.isic7810']
              and tx.get('isic-8810', {}).get('reason') == 'outside-top' and tx['isic-8810'].get('detail') == 'rank 12 is outside --top 10', r.stderr)
        check('--top 10 still reports held apps as held', all(tx.get(a['source'], {}).get('reason') == 'held'
                                                              for a in table['apps'] if a['source'].startswith('unspsc-')))
        r = generate(topin, tab, 'top0.json', ('--top', '0'))
        check('--top 0 is refused', r.returncode != 0 and '--top must be a positive rank' in r.stderr, r.stderr)

        # Holds (store/catalog-source/hold.json): UNSPSC apps stay out until the UNDP addendum is confirmed; Decision lifts it.
        real_hold = json.loads((ROOT / 'store/catalog-source/hold.json').read_text(encoding='utf-8'))
        check('the real hold list holds unspsc-* for the UNDP addendum, lifted by Decision',
              [(h['pattern'], h['decidedBy']) for h in real_hold['holds']] == [('unspsc-*', 'Decision')]
              and real_hold['holds'][0]['reason'] == 'Store での配布を広げる前に UNDP の addendum の確認が要る（申請の名義はオーナー、Legal が確認中）',
              json.dumps(real_hold, ensure_ascii=False))
        unspsc_apps = [a for a in table['apps'] if a['source'].startswith('unspsc-')]
        check('the real table has the five UNSPSC apps without a rank, one key group per segment',
              [(a['source'], a['id'], a['group'], a.get('rank')) for a in unspsc_apps] ==
              [(f'unspsc-{c}', f'network.itonami.unspsc{c}', f'unspsc-{c}', None) for c in ('10', '27', '39', '43', '73')])
        held = t / 'held'
        app_input(held, 'isic-7810', group='isic-N')
        app_input(held, 'unspsc-10', group='unspsc-10', commit='1' * 40)
        r = generate(held, tab, 'held.json')
        hrep = json.loads((t / 'held.json.report').read_text()) if r.returncode == 0 else {'listed': [], 'excluded': []}
        hx = {e['source']: e for e in hrep['excluded']}
        check('every UNSPSC app is left out as held, with the reason and who lifts it', r.returncode == 0
              and all(hx.get(a['source'], {}).get('reason') == 'held' and hx[a['source']].get('decidedBy') == 'Decision'
                      and 'addendum' in hx[a['source']].get('hold', '') for a in unspsc_apps)
              and [x['id'] for x in hrep['listed']] == ['network.itonami.isic7810'], r.stderr)

        # When the hold is lifted, the UNSPSC apps go through the same marks as ISCO-08 (unspsc-source.tsv).
        (t / 'no-hold.json').write_text(json.dumps({'schema': 'awai.store.catalog-hold.v1', 'holds': []}))
        urepo = t / 'repos/unspsc-10'; urepo.mkdir(parents=True)
        ugit = lambda *a: subprocess.run(['git', '-C', str(urepo), *a], capture_output=True, text=True, check=True).stdout.strip()
        ugit('init', '-q'); ugit('config', 'user.email', 'test@example.invalid'); ugit('config', 'user.name', 'series test')
        (urepo / 'x').write_text('unspsc'); ugit('add', 'x'); ugit('commit', '-q', '-m', 'unspsc source'); ucommit = ugit('rev-parse', 'HEAD')
        UREPO = 'cloud-itonami/app-itonami-cloud-itonami-unspsc-10'
        unheld = t / 'unheld'
        app_input(unheld, 'unspsc-10', group='unspsc-10', commit=ucommit)
        app_input(unheld, 'isic-7810', group='isic-N')
        r = generate(unheld, tab, 'unheld.json', hold=t / 'no-hold.json')
        ux = {e['source']: e['reason'] for e in json.loads((t / 'unheld.json.report').read_text())['excluded']} if r.returncode == 0 else {}
        check('without the hold, an unmarked UNSPSC app is left out as unspsc-source-unchecked', ux.get('unspsc-10') == 'unspsc-source-unchecked', r.stderr)
        UEN = ('Classification reference: UNSPSC® (United Nations Standard Products and Services Code), code 10000000. '
               '© United Nations Development Programme (UNDP). UNSPSC® is a registered trademark of UNDP. '
               'This app is not produced, reviewed or endorsed by UNDP.')
        UJA = ('分類の参照: UNSPSC®（国連標準製品・サービス分類）のコード 10000000。© 国連開発計画（UNDP）。'
               'UNSPSC® は UNDP の登録商標です。日本語の名称は当方の訳です。この app は UNDP が作成・確認・推奨したものではありません。')
        udesc = next(a['description'] for a in table['apps'] if a['source'] == 'unspsc-10')
        for ja, want in (('false', udesc + '\n\n' + UEN), ('true', udesc + '\n\n' + UEN + '\n' + UJA)):
            out = f'unspsc-{ja}.json'
            r = generate(unheld, tab, out, hold=t / 'no-hold.json', unspsc=write_marks([(UREPO, ucommit, ja)], f'unspsc-{ja}.tsv'))
            apps = {a['id']: a for a in json.loads((t / out).read_text())['apps']} if r.returncode == 0 else {}
            got = apps.get('network.itonami.unspsc10', {}).get('description')
            check(f'UNSPSC description ends with the exact UNDP reference and trademark line, code in 8 digits (ja {ja})', got == want, repr(got) + r.stderr)
            check(f'the UNDP reference appears once and no ILO reference (ja {ja})', got is not None and got.count('Classification reference') == 1
                  and got.count('分類の参照') == (1 if ja == 'true' else 0) and 'ILO' not in got)
            check(f'no UNDP reference on an ISIC app (ja {ja})', 'UNSPSC' not in apps.get('network.itonami.isic7810', {}).get('description', 'UNSPSC'))
        r = generate(unheld, tab, 'unspsc-in-isco.json', hold=t / 'no-hold.json', marks=write_marks([(UREPO, ucommit, 'false')], 'u-in-i.tsv'))
        check('a UNSPSC repository in isco-source.tsv is refused', r.returncode != 0 and 'not an ISCO-08 series repository' in r.stderr, r.stderr)
        r = generate(unheld, tab, 'isco-in-unspsc.json', hold=t / 'no-hold.json', unspsc=write_marks([(REPO, commits['source'], 'false')], 'i-in-u.tsv'))
        check('an ISCO-08 repository in unspsc-source.tsv is refused', r.returncode != 0 and 'not a UNSPSC series repository' in r.stderr, r.stderr)
        (t / 'bad-hold.json').write_text(json.dumps({'schema': 'awai.store.catalog-hold.v1', 'holds': [{'pattern': 'unspsc-*', 'reason': 'x'}]}))
        r = generate(held, tab, 'badhold.json', hold=t / 'bad-hold.json')
        check('a hold without decidedBy is refused', r.returncode != 0 and 'decidedBy' in r.stderr and not (t / 'badhold.json').exists(), r.stderr)

        # android/isco-source-add.py: adds a batch with the ancestry checks; one failure writes nothing.
        ADD = ROOT / 'android/isco-source-add.py'
        # A side branch merged back, so `side` and `source` are both in the history but neither comes after the other.
        git('checkout', '-q', '-b', 'side', commits['before']); (repo / 'y').write_text('side'); git('add', 'y'); git('commit', '-q', '-m', 'side')
        commits['side'] = git('rev-parse', 'HEAD'); git('checkout', '-q', '-'); git('merge', '-q', '--no-edit', 'side'); commits['merge'] = git('rev-parse', 'HEAD')
        target = t / 'isco-source.tsv'; target.write_text('# test marks\nrepo\tcommit\tja\n')

        def add(rows, *extra):
            before = target.read_text()
            r = run(sys.executable, ADD, write_marks(rows, 'batch.tsv'), '--repos', t / 'repos', '--tsv', target, *extra)
            return r, before, target.read_text()
        r, before, after = add([(REPO, commits['source'], 'true')])
        check('script adds a new mark', r.returncode == 0 and after == f'# test marks\nrepo\tcommit\tja\n{REPO}\t{commits["source"]}\ttrue\n', r.stderr + after)
        r, before, after = add([(REPO, commits['before'], 'true')])
        check('script refuses a mark that moves backward, writes nothing', r.returncode != 0 and 'does not come after' in r.stderr and after == before, r.stderr)
        r, before, after = add([(REPO, commits['source'], 'true')], '--extra', f'{REPO}={commits["after"]}')
        check('script takes the later of the batch commit and the --extra commit', r.returncode == 0 and f'\t{commits["after"]}\t' in after, r.stderr + after)
        r, before, after = add([(REPO, commits['merge'], 'true')], '--extra', f'{REPO}={commits["after"]}')
        check('script takes the later one when the --extra commit is the earlier', r.returncode == 0 and f'\t{commits["merge"]}\t' in after, r.stderr + after)
        target.write_text('# test marks\nrepo\tcommit\tja\n')
        r, before, after = add([(REPO, commits['source'], 'true')], '--extra', f'{REPO}={commits["side"]}')
        check('script refuses two candidates on diverged branches, writes nothing', r.returncode != 0 and 'diverged' in r.stderr and after == before, r.stderr)
        git('checkout', '-q', '-b', 'loose', commits['before']); (repo / 'z').write_text('loose'); git('add', 'z'); git('commit', '-q', '-m', 'loose')
        commits['loose'] = git('rev-parse', 'HEAD'); git('checkout', '-q', '-')
        r, before, after = add([(REPO, commits['loose'], 'true')])
        check('script refuses a commit outside the default branch, writes nothing', r.returncode != 0 and 'history of the default branch' in r.stderr and after == before, r.stderr)
        target.write_text('# test marks\nrepo\tcommit\tja\n')
        (t / 'alias.tsv').write_text(f'repo\tmerge_commit\tja_title\n{REPO}\t{commits["source"]}\tfalse\n')
        r = run(sys.executable, ADD, t / 'alias.tsv', '--repos', t / 'repos', '--tsv', target)
        check('script reads the batch spelling repo/merge_commit/ja_title', r.returncode == 0
              and target.read_text().endswith(f'{REPO}\t{commits["source"]}\tfalse\n') and target.read_text().count('repo\tcommit\tja\n') == 1, r.stderr)
        # A batch with both schemes: ISCO-08 rows to the ISCO file, UNSPSC rows to the UNSPSC file.
        itarget, utarget = t / 'mix-isco.tsv', t / 'mix-unspsc.tsv'
        for f in (itarget, utarget): f.write_text('repo\tcommit\tja\n')
        r = run(sys.executable, ADD, write_marks([(REPO, commits['source'], 'false'), (UREPO, ucommit, 'true')], 'mix.tsv'), '--repos', t / 'repos',
                '--isco-tsv', itarget, '--unspsc-tsv', utarget)
        check('script routes ISCO-08 and UNSPSC rows to their own files', r.returncode == 0
              and itarget.read_text() == f'repo\tcommit\tja\n{REPO}\t{commits["source"]}\tfalse\n'
              and utarget.read_text() == f'repo\tcommit\tja\n{UREPO}\t{ucommit}\ttrue\n', r.stderr)
        r = run(sys.executable, ADD, write_marks([(REPO, commits['source'], 'false'), (UREPO, ucommit, 'true')], 'mix.tsv'), '--repos', t / 'repos', '--tsv', itarget)
        check('script refuses --tsv for a batch of two schemes', r.returncode != 0 and 'single scheme' in r.stderr, r.stderr)
        r, before, after = add([(REPO, commits['source'][:12], 'true')])
        check('script refuses a malformed batch, writes nothing', r.returncode != 0 and 'not 40 lowercase hex' in r.stderr and after == before, r.stderr)
        r, before, after = add([(REPO, commits['source'], 'true')], '--extra', f'cloud-itonami/app-itonami-cloud-itonami-isco-3333={commits["after"]}')
        check('script refuses --extra for a repository without a batch row', r.returncode != 0 and 'no row in the batch' in r.stderr and after == before, r.stderr)

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
