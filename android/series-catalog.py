#!/usr/bin/env python3
"""Build the body of a Store catalog from the series apps' release.json files and APKs (AWAI-3771).

  python3 android/series-catalog.py --inputs DIR --revision N --out catalog-revN-raw.json \
      [--base EXISTING_RAW.json] [--table store/catalog-source/series-apps.json] [--expires-days 60] [--report report.json]

DIR holds one directory per series app, named by its source (for example DIR/isco-2423/), with the app's
release.json and descriptor.json (from `app/dist/` of the app repository) and its APK (one *.apk file).

The table (store/catalog-source/series-apps.json) is the authority for which apps may be listed, in App Cycle
order: package id, repository, APK signing-key group and, for ISCO-08 apps, the commit that added the ISCO-08
source text (`iscoSource`, null until checked). release.json carries no APK signer, so the expected signer comes from the app's group.

An app is listed only when all of these hold; otherwise the run stops with the reason:
- release.json is awai.app.artifact.v1, its id is the table's package id, and its source is the repository's;
- descriptor.json has the digest release.json pins, and declares no external operation;
- the APK's package, versionName and single signer are the table id, the release version and the group's signer;
- the APK fits the table's byte ceiling, and its label fits the catalog's 80 characters.
Left out, without stopping the run (the report says why): an ISCO-08 app whose source is not yet checked
(isco-source-unchecked), an ISCO-08 app whose release.json records no commit (release-without-commit) or a commit
before the marked one (built-before-isco-source, checked in a clone under --repos), and an app with no input
directory (its APK is not built yet, no-apk).

The output is the catalog body (itonami.store.bundled.v1). Sign it with a catalog key from the Store's key list:
`python3 android/sign-catalog-envelope.py --raw OUT ...`. Nothing is signed, committed or published here.
"""
import argparse, hashlib, json, pathlib, re, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
TABLE = ROOT / 'store/catalog-source/series-apps.json'
SDK_TOOLS = pathlib.Path.home() / 'Library/Android/sdk/build-tools/36.1.0'
ISIC_SECTIONS = [('A', 1, 3), ('B', 5, 9), ('C', 10, 33), ('D', 35, 35), ('E', 36, 39), ('F', 41, 43), ('G', 45, 47),
                 ('H', 49, 53), ('I', 55, 56), ('J', 58, 63), ('K', 64, 66), ('L', 68, 68), ('M', 69, 75), ('N', 77, 82),
                 ('O', 84, 84), ('P', 85, 85), ('Q', 86, 88), ('R', 90, 93), ('S', 94, 96), ('T', 97, 98), ('U', 99, 99)]
SOURCE = re.compile(r'^(isic|isco)-([0-9]{2,4})((?:-[0-9a-z]+)*)$')


class Refused(Exception):
    pass


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def group_of(source):
    """The signing-key group a series source belongs to: its ISIC Rev.4 section or its ISCO-08 major group."""
    m = SOURCE.match(source)
    if not m:
        raise Refused(f'{source}: not a series source (isic-NNNN or isco-NNNN, optional -suffix)')
    scheme, code = m.group(1), m.group(2)
    if scheme == 'isco':
        return 'isco-' + code[0]
    division = int(code[:2])
    for section, low, high in ISIC_SECTIONS:
        if low <= division <= high:
            return 'isic-' + section
    raise Refused(f'{source}: ISIC division {division:02d} has no section')


def package_of(source):
    """network.itonami.<scheme><code><suffix>, the identifier the series build stamps (scripts/identity.mjs)."""
    return 'network.itonami.' + source.replace('-', '')


def check_table(table):
    if table.get('schema') != 'awai.store.series-apps.v1':
        raise Refused('table: not awai.store.series-apps.v1')
    groups, seen, ranks = table['groups'], set(), []
    for g, v in groups.items():
        if not re.fullmatch(r'[0-9a-f]{64}', v.get('signerSha256', '')):
            raise Refused(f'table: group {g} has no signer')
    for a in table['apps']:
        s = a['source']
        if a['id'] != package_of(s):
            raise Refused(f'table: {s} has package id {a["id"]}, the series build stamps {package_of(s)}')
        if a['repo'] != 'cloud-itonami/app-itonami-cloud-itonami-' + s:
            raise Refused(f'table: {s} has repository {a["repo"]}')
        if a['group'] != group_of(s):
            raise Refused(f'table: {s} is in group {a["group"]}, its code puts it in {group_of(s)}')
        if a['group'] not in groups:
            raise Refused(f'table: {s} names group {a["group"]}, which has no signer')
        if s.startswith('isco-'):
            if 'iscoSource' not in a:
                raise Refused(f'table: ISCO-08 app {s} has no iscoSource mark (null until its source text is checked)')
            mark = a['iscoSource']
            if mark is not None and not (isinstance(mark, dict) and set(mark) == {'commit'} and re.fullmatch(r'[0-9a-f]{40}', mark['commit'])):
                raise Refused(f'table: ISCO-08 app {s} has an iscoSource mark that is not {{"commit": <40 hex>}}')
        if a['id'] in seen:
            raise Refused(f'table: {a["id"]} is listed twice')
        seen.add(a['id'])
        ranks.append(a['rank'])
    if ranks != sorted(ranks) or len(set(ranks)) != len(ranks):
        raise Refused('table: ranks must be unique and in order')


def tool(name, *args):
    r = subprocess.run([str(SDK_TOOLS / name), *map(str, args)], capture_output=True, text=True)
    if r.returncode != 0:
        raise Refused(f'{name} failed: {r.stderr.strip()[:200]}')
    return r.stdout


def apk_facts(apk):
    badging = tool('aapt2', 'dump', 'badging', apk)
    m = re.search(r"package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", badging)
    # A label from resources is printed as application-label:'…'; a plain manifest label only as application: label='…'.
    label = re.search(r"application-label:'([^']*)'", badging) or re.search(r"application: label='([^']*)'", badging)
    signers = re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]{64})', tool('apksigner', 'verify', '--print-certs', apk))
    data = apk.read_bytes()
    return {'package': m and m.group(1), 'versionCode': m and int(m.group(2)), 'versionName': m and m.group(3),
            'label': label.group(1) if label else None, 'signers': signers, 'bytes': len(data), 'sha256': sha256(data),
            'permissions': sorted(set(re.findall(r"uses-permission: name='([^']+)'", badging)))}


def entry(app, directory, table):
    s = app['source']
    release = json.loads((directory / 'release.json').read_text())
    if release.get('schema') != 'awai.app.artifact.v1':
        raise Refused(f'{s}: release.json is not awai.app.artifact.v1')
    if release.get('id') != app['id']:
        raise Refused(f'{s}: release.json id {release.get("id")} is not {app["id"]}')
    if release.get('source') != 'cloud-itonami-' + s:
        raise Refused(f'{s}: release.json source {release.get("source")} is not cloud-itonami-{s}')
    descriptor_bytes = (directory / 'descriptor.json').read_bytes()
    if release.get('files', {}).get('descriptor.json') != sha256(descriptor_bytes):
        raise Refused(f'{s}: descriptor.json is not the one release.json pins')
    if json.loads(descriptor_bytes).get('operations') != []:
        raise Refused(f'{s}: the descriptor declares external operations; the generator lists only apps without them')
    apks = sorted(directory.glob('*.apk'))
    if len(apks) != 1:
        raise Refused(f'{s}: expected one APK, found {len(apks)}')
    f = apk_facts(apks[0])
    if f['package'] != app['id']:
        raise Refused(f'{s}: APK package {f["package"]} is not {app["id"]}')
    if f['versionName'] != release.get('version'):
        raise Refused(f'{s}: APK versionName {f["versionName"]} is not the release version {release.get("version")}')
    if not f['versionCode'] or f['versionCode'] < 1:
        raise Refused(f'{s}: APK has no positive versionCode')
    expected = table['groups'][app['group']]['signerSha256']
    if f['signers'] != [expected]:
        raise Refused(f'{s}: APK signers {f["signers"]} are not the single signer of group {app["group"]} ({expected[:8]}…)')
    if f['bytes'] > table['maxApkBytes']:
        raise Refused(f'{s}: APK is {f["bytes"]} bytes, over {table["maxApkBytes"]}')
    if not f['label'] or len(f['label']) > 80:
        raise Refused(f'{s}: APK label is missing or longer than 80 characters')
    slug = app['id'].split('.')[-1]
    return {
        'id': app['id'], 'name': f['label'], 'description': app['description'], 'publisher': table['publisher'],
        'versionCode': f['versionCode'], 'versionName': f['versionName'], 'operations': [],
        'artifacts': [{'platform': 'android', 'runtime': 'android', 'kind': 'apk', 'asset': f'packages/{slug}.apk',
                       'bytes': f['bytes'], 'sha256': f['sha256'], 'signerSha256': expected}],
    }, {'source': s, 'id': app['id'], 'group': app['group'], 'versionCode': f['versionCode'],
        'sha256': f['sha256'], 'bytes': f['bytes'], 'permissions': f['permissions']}


def built_after_source(app, release, repos):
    """None when the ISCO-08 app's APK was built from the marked commit or a later one; otherwise the reason to leave it out."""
    commit = release.get('commit')
    if not (isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit)):
        return 'release-without-commit'
    if repos is None:
        raise Refused(f'{app["source"]}: checking the ISCO-08 source commit needs --repos with a clone of {app["repo"]}')
    clone = repos / app['source']
    if not (clone / '.git').exists():
        raise Refused(f'{app["source"]}: no clone at {clone}')
    for c in (app['iscoSource']['commit'], commit):
        if subprocess.run(['git', '-C', str(clone), 'cat-file', '-e', c + '^{commit}'], capture_output=True).returncode:
            raise Refused(f'{app["source"]}: commit {c[:12]} is not in the clone; fetch the history')
    r = subprocess.run(['git', '-C', str(clone), 'merge-base', '--is-ancestor', app['iscoSource']['commit'], commit], capture_output=True)
    return None if r.returncode == 0 else 'built-before-isco-source'


def generate(table, inputs, revision, expires_at, base=None, repos=None):
    check_table(table)
    listed, excluded, apps = [], [], []
    if base:
        apps = list(base['apps'])
    present = {a['id'] for a in apps}
    for app in table['apps']:
        s = app['source']
        if s.startswith('isco-') and app['iscoSource'] is None:
            excluded.append({'source': s, 'id': app['id'], 'reason': 'isco-source-unchecked'})
            continue
        directory = inputs / s
        if not directory.is_dir():
            excluded.append({'source': s, 'id': app['id'], 'reason': 'no-apk'})
            continue
        if s.startswith('isco-'):
            reason = built_after_source(app, json.loads((directory / 'release.json').read_text()), repos)
            if reason:
                excluded.append({'source': s, 'id': app['id'], 'reason': reason})
                continue
        if app['id'] in present:
            raise Refused(f'{s}: {app["id"]} is already in the base catalog')
        e, facts = entry(app, directory, table)
        apps.append(e)
        listed.append(facts)
    catalog = {'schema': 'itonami.store.bundled.v1', 'revision': revision, 'expiresAt': expires_at, 'apps': apps}
    return catalog, {'schema': 'awai.store.series-catalog-report.v1', 'revision': revision, 'listed': listed, 'excluded': excluded,
                     'carried': len(apps) - len(listed)}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--inputs', type=pathlib.Path, required=True)
    ap.add_argument('--revision', type=int, required=True)
    ap.add_argument('--out', type=pathlib.Path, required=True)
    ap.add_argument('--base', type=pathlib.Path, help='a catalog body whose entries are carried forward (for example the current raw catalog)')
    ap.add_argument('--table', type=pathlib.Path, default=TABLE)
    ap.add_argument('--expires-days', type=int, default=60)
    ap.add_argument('--report', type=pathlib.Path)
    ap.add_argument('--repos', type=pathlib.Path, help='directory of app repository clones, one per source, for the ISCO-08 source commit check')
    a = ap.parse_args()
    if a.revision < 1 or not 1 <= a.expires_days <= 365:
        ap.error('--revision must be positive and --expires-days 1..365')
    base = json.loads(a.base.read_text()) if a.base else None
    if base and a.revision <= base['revision']:
        ap.error(f'--revision must be above the base revision {base["revision"]}')
    try:
        catalog, report = generate(json.loads(a.table.read_text()), a.inputs, a.revision, int(time.time()) + a.expires_days * 86400, base, a.repos)
    except Refused as e:
        sys.exit(f'refused: {e}')
    a.out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    text = json.dumps(report, ensure_ascii=False, indent=1) + '\n'
    if a.report:
        a.report.write_text(text, encoding='utf-8')
    print(text, end='')


if __name__ == '__main__':
    main()
