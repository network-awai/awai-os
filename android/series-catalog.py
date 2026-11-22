#!/usr/bin/env python3
"""Build the body of a Store catalog from the series apps' release.json files and APKs (AWAI-3771).

  python3 android/series-catalog.py --inputs DIR --revision N --out catalog-revN-raw.json \
      [--base EXISTING_RAW.json] [--table store/catalog-source/series-apps.json] [--expires-days 60] [--report report.json]

DIR holds one directory per series app, named by its source (for example DIR/isco-2423/), with the app's
release.json and descriptor.json (from `app/dist/` of the app repository) and its APK (one *.apk file).

The table (store/catalog-source/series-apps.json) is the authority for which apps may be listed, in App Cycle
order: package id, repository and APK signing-key group. ISCO-08 source marks are in a separate file,
store/catalog-source/isco-source.tsv (repo, commit that added the ISCO-08 source text, ja), and apply only to apps
in the table. Each listed ISCO-08 app's description ends with the ILO reference built from its code (AWAI-3629):
English always, Japanese as well when ja is true. release.json carries no APK signer, so the expected signer comes from the app's group.

An app is listed only when all of these hold; otherwise the run stops with the reason:
- release.json is awai.app.artifact.v1, its id is the table's package id, and its source is the repository's;
- descriptor.json has the digest release.json pins, and declares no external operation;
- the APK's package, versionName and single signer are the table id, the release version and the group's signer;
- the APK fits the table's byte ceiling, and its label fits the catalog's 80 characters.
Left out, without stopping the run (the report says why): an app matching a hold in store/catalog-source/hold.json
(held, with the hold's reason and who lifts it; checked first), an ISCO-08 app whose source is not yet checked
(isco-source-unchecked), an app whose release.json does not say dirty false (release-dirty: built from uncommitted
changes, or unknown), an ISCO-08 app whose release.json has no source_commit (release-without-commit) or one before
the marked commit (built-before-isco-source, checked in a clone under --repos), and an app with no input directory
(its APK is not built yet, no-apk).

release.json fields read here: schema, id, source, version, files["descriptor.json"], source_commit (40 hex, or
null when the build had no git) and dirty (true, false or null), as written by the series app build.

The output is the catalog body (itonami.store.bundled.v1). Sign it with a catalog key from the Store's key list:
`python3 android/sign-catalog-envelope.py --raw OUT ...`. Nothing is signed, committed or published here.
"""
import argparse, fnmatch, hashlib, json, pathlib, re, subprocess, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
TABLE = ROOT / 'store/catalog-source/series-apps.json'
ISCO_SOURCE = ROOT / 'store/catalog-source/isco-source.tsv'
HOLD = ROOT / 'store/catalog-source/hold.json'
ISCO_REPO = re.compile(r'^cloud-itonami/app-itonami-cloud-itonami-(isco-[0-9]{4}(?:-[0-9a-z]+)*)$')
UNSPSC_SOURCE = ROOT / 'store/catalog-source/unspsc-source.tsv'
UNSPSC_REPO = re.compile(r'^cloud-itonami/app-itonami-cloud-itonami-(unspsc-[0-9]{2,8}(?:-[0-9a-z]+)*)$')
# Source-mark files per scheme: which repositories each may name. Marked schemes are left out until marked.
MARKED_SCHEMES = {'isco': ('isco-source.tsv', ISCO_REPO, 'an ISCO-08'), 'unspsc': ('unspsc-source.tsv', UNSPSC_REPO, 'a UNSPSC')}

# AWAI-3629 (Legal, Decision): the ILO reference shown with each ISCO-08 app, one per app, built from its code.
# No list of codes and names, and no ILO logo.
ISCO_ATTRIBUTION_EN = ('Occupation reference: ISCO-08 (International Labour Organization, 2012), code {code}. '
                       'This app is not produced, reviewed or endorsed by the ILO.')
ISCO_ATTRIBUTION_JA = ('職業の参照: ISCO-08（国際労働機関 ILO、2012 年）のコード {code}。日本語の名称は当方の訳です。'
                       'この app は ILO が作成・確認・推奨したものではありません。')
SDK_TOOLS = pathlib.Path.home() / 'Library/Android/sdk/build-tools/36.1.0'
ISIC_SECTIONS = [('A', 1, 3), ('B', 5, 9), ('C', 10, 33), ('D', 35, 35), ('E', 36, 39), ('F', 41, 43), ('G', 45, 47),
                 ('H', 49, 53), ('I', 55, 56), ('J', 58, 63), ('K', 64, 66), ('L', 68, 68), ('M', 69, 75), ('N', 77, 82),
                 ('O', 84, 84), ('P', 85, 85), ('Q', 86, 88), ('R', 90, 93), ('S', 94, 96), ('T', 97, 98), ('U', 99, 99)]
SOURCE = re.compile(r'^(isic|isco)-([0-9]{2,4})((?:-[0-9a-z]+)*)$|^(unspsc)-([0-9]{2,8})((?:-[0-9a-z]+)*)$')

# Legal memo unspsc-redistribution.md §2 and "出典の文言" (2026-11-22), copied verbatim: one code per app, no list of
# codes and names, no UNDP emblem. The Japanese line is shown only when the app has a Japanese name (our translation).
UNSPSC_ATTRIBUTION_EN = ('Classification reference: UNSPSC® (United Nations Standard Products and Services Code), code {code}. '
                         '© United Nations Development Programme (UNDP). UNSPSC® is a registered trademark of UNDP. '
                         'This app is not produced, reviewed or endorsed by UNDP.')
UNSPSC_ATTRIBUTION_JA = ('分類の参照: UNSPSC®（国連標準製品・サービス分類）のコード {code}。© 国連開発計画（UNDP）。'
                         'UNSPSC® は UNDP の登録商標です。日本語の名称は当方の訳です。'
                         'この app は UNDP が作成・確認・推奨したものではありません。')


def scheme_code(source):
    m = SOURCE.match(source)
    if not m:
        return None, None
    return (m.group(1), m.group(2)) if m.group(1) else (m.group(4), m.group(5))


class Refused(Exception):
    pass


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def group_of(source):
    """The signing-key group a series source belongs to: its ISIC Rev.4 section, its ISCO-08 major group, or its
    UNSPSC segment (the first two digits; the AWAI-3771 decision names ISIC and ISCO only, so this is provisional)."""
    scheme, code = scheme_code(source)
    if not scheme:
        raise Refused(f'{source}: not a series source (isic-NNNN, isco-NNNN or unspsc-NNNNNNNN, optional -suffix)')
    if scheme == 'isco':
        return 'isco-' + code[0]
    if scheme == 'unspsc':
        return 'unspsc-' + code[:2]
    division = int(code[:2])
    for section, low, high in ISIC_SECTIONS:
        if low <= division <= high:
            return 'isic-' + section
    raise Refused(f'{source}: ISIC division {division:02d} has no section')


def package_of(source):
    """network.itonami.<scheme><code><suffix>, the identifier the series build stamps (scripts/identity.mjs)."""
    return 'network.itonami.' + source.replace('-', '')


def read_holds(value):
    """hold.json: patterns of sources kept out of the catalog, each with its reason and who decides to lift it."""
    if not isinstance(value, dict) or value.get('schema') != 'awai.store.catalog-hold.v1' or not isinstance(value.get('holds'), list):
        raise Refused('hold.json: not awai.store.catalog-hold.v1')
    for h in value['holds']:
        if not (isinstance(h, dict) and isinstance(h.get('pattern'), str) and re.fullmatch(r'[a-z0-9*-]{1,64}', h['pattern'])
                and all(isinstance(h.get(k), str) and h[k].strip() for k in ('reason', 'decidedBy'))):
            raise Refused(f'hold.json: each hold needs a pattern (a-z, 0-9, -, *), a reason and decidedBy: {h!r}')
    return value['holds']


def held_by(source, holds):
    return next((h for h in holds if fnmatch.fnmatchcase(source, h['pattern'])), None)


def check_table(table, holds=()):
    if table.get('schema') != 'awai.store.series-apps.v1':
        raise Refused('table: not awai.store.series-apps.v1')
    groups, seen, ranks = table['groups'], set(), []
    for g, v in groups.items():
        if not re.fullmatch(r'[0-9a-f]{64}', v.get('signerSha256', '')):
            raise Refused(f'table: group {g} has no signer')
    for a in table['apps']:
        s = a['source']
        if held_by(s, holds):
            # A held app is left out before anything else; its other fields are not checked while it is held.
            if a['id'] in seen:
                raise Refused(f'table: {a["id"]} is listed twice')
            seen.add(a['id'])
            if a.get('rank') is not None: ranks.append(a['rank'])
            continue
        if a['id'] != package_of(s):
            raise Refused(f'table: {s} has package id {a["id"]}, the series build stamps {package_of(s)}')
        if a['repo'] != 'cloud-itonami/app-itonami-cloud-itonami-' + s:
            raise Refused(f'table: {s} has repository {a["repo"]}')
        if a['group'] != group_of(s):
            raise Refused(f'table: {s} is in group {a["group"]}, its code puts it in {group_of(s)}')
        if a['group'] not in groups:
            raise Refused(f'table: {s} names group {a["group"]}, which has no signer')
        if 'iscoSource' in a or 'sourceMark' in a or 'ja' in a:
            raise Refused(f'table: {s} has a source mark or ja; they live in isco-source.tsv and unspsc-source.tsv')
        if a['id'] in seen:
            raise Refused(f'table: {a["id"]} is listed twice')
        seen.add(a['id'])
        # rank is the App Cycle order; an app without a rank (such as a held one) has no place in it yet.
        if a.get('rank') is not None: ranks.append(a['rank'])
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
        'id': app['id'], 'name': f['label'], 'publisher': table['publisher'],
        'description': app['description'] + attribution(app),
        'versionCode': f['versionCode'], 'versionName': f['versionName'], 'operations': [],
        'artifacts': [{'platform': 'android', 'runtime': 'android', 'kind': 'apk', 'asset': f'packages/{slug}.apk',
                       'bytes': f['bytes'], 'sha256': f['sha256'], 'signerSha256': expected}],
    }, {'source': s, 'id': app['id'], 'group': app['group'], 'versionCode': f['versionCode'],
        'sha256': f['sha256'], 'bytes': f['bytes'], 'permissions': f['permissions']}


def built_after_source(app, release, repos):
    """None when the marked app's APK was built from the marked commit or a later one; otherwise the reason to leave it out."""
    commit = release.get('source_commit')
    if not (isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit)):
        return 'release-without-commit'
    if repos is None:
        raise Refused(f'{app["source"]}: checking the source commit needs --repos with a clone of {app["repo"]}')
    clone = repos / app['source']
    if not (clone / '.git').exists():
        raise Refused(f'{app["source"]}: no clone at {clone}')
    for c in (app['sourceMark']['commit'], commit):
        if subprocess.run(['git', '-C', str(clone), 'cat-file', '-e', c + '^{commit}'], capture_output=True).returncode:
            raise Refused(f'{app["source"]}: commit {c[:12]} is not in the clone; fetch the history')
    r = subprocess.run(['git', '-C', str(clone), 'merge-base', '--is-ancestor', app['sourceMark']['commit'], commit], capture_output=True)
    return None if r.returncode == 0 else f'built-before-{scheme_code(app["source"])[0]}-source'


ISIC_REVISIONS = {'isic-rev4': 'ISIC Rev.4', 'isic-rev5': 'ISIC Rev.5'}
SERIES_DESCRIPTION = '{classification} の系列アプリ（開発版）。記録と判断はこの端末の中だけで行い、外部への送信はありません。'


def isic_description(app, commit, repos):
    """The listed description of an ISIC app. The revision is not written by hand: it is the classification key of
    the app's blueprint.edn at the commit the APK was built from (`:itonami.blueprint/isic-rev4` or `isic-rev5`), which
    must name exactly one revision and the app's own code. No text from the UN classification (includes, excludes)
    goes into the description."""
    if repos is None:
        raise Refused(f'{app["source"]}: reading the ISIC revision needs --repos with a clone of {app["repo"]}')
    clone = repos / app['source']
    if not (clone / '.git').exists():
        raise Refused(f'{app["source"]}: no clone at {clone}')
    r = subprocess.run(['git', '-C', str(clone), 'show', f'{commit}:blueprint.edn'], capture_output=True, text=True)
    if r.returncode:
        raise Refused(f'{app["source"]}: blueprint.edn is not readable at {commit[:12]}; fetch the history')
    keys = re.findall(r':itonami\.blueprint/(isic-rev[0-9]+)\s+"([^"]*)"', r.stdout)
    if len(keys) != 1:
        raise Refused(f'{app["source"]}: blueprint.edn at {commit[:12]} names {len(keys)} ISIC revisions '
                      f'({", ".join(k for k, _ in keys) or "none"}); exactly one of isic-rev4 / isic-rev5 is expected')
    key, code = keys[0]
    if key not in ISIC_REVISIONS:
        raise Refused(f'{app["source"]}: blueprint.edn at {commit[:12]} uses {key}, which the Store does not know')
    if code != scheme_code(app['source'])[1]:
        raise Refused(f'{app["source"]}: blueprint.edn at {commit[:12]} gives {key} {code}, not the code of {app["source"]}')
    return SERIES_DESCRIPTION.format(classification=f'{ISIC_REVISIONS[key]} {code}')


def read_source_marks(text, scheme):
    """isco-source.tsv or unspsc-source.tsv: a header `repo<TAB>commit<TAB>ja`, then one row per repository of that
    scheme whose source text is checked. commit is the 40-hex commit that added it; ja is true when the app has a
    Japanese name (our translation). Lines starting with # and blank lines are ignored. Anything else malformed
    refuses the whole file."""
    name, repo_re, kind = MARKED_SCHEMES[scheme]
    rows = [l for l in text.split('\n') if l.strip() and not l.startswith('#')]
    if not rows or rows[0] != 'repo\tcommit\tja':
        raise Refused(f'{name}: the first line must be the header repo<TAB>commit<TAB>ja')
    marks = {}
    for n, line in enumerate(rows[1:], 2):
        f = line.split('\t')
        if len(f) != 3:
            raise Refused(f'{name} row {n}: expected 3 tab-separated fields')
        repo, commit, ja = f
        if not repo_re.match(repo):
            raise Refused(f'{name} row {n}: {repo!r} is not {kind} series repository')
        if not re.fullmatch(r'[0-9a-f]{40}', commit):
            raise Refused(f'{name} row {n}: commit {commit!r} is not 40 lowercase hex characters')
        if ja not in ('true', 'false'):
            raise Refused(f'{name} row {n}: ja must be true or false')
        if repo in marks:
            raise Refused(f'{name} row {n}: {repo} is listed twice')
        marks[repo] = {'commit': commit, 'ja': ja == 'true'}
    return marks


def read_isco_marks(text):
    return read_source_marks(text, 'isco')


def unspsc_code(source):
    """The code as the UNSPSC reference shows it: eight digits, so segment 10 is 10000000 (owner answer 2026-11-22).
    Change this one line if the repositories' README uses another spelling."""
    return scheme_code(source)[1].ljust(8, '0')


def unspsc_attribution(source, ja):
    """The UNDP reference and trademark line for one UNSPSC app, in English, and in Japanese too when ja is true."""
    code = unspsc_code(source)
    text = UNSPSC_ATTRIBUTION_EN.format(code=code)
    return text + '\n' + UNSPSC_ATTRIBUTION_JA.format(code=code) if ja else text


def attribution(app):
    """The classification reference appended to a listed app's description: ISCO-08 and UNSPSC apps only."""
    s = app['source']
    if s.startswith('isco-'):
        return '\n\n' + isco_attribution(s, app['sourceMark']['ja'])
    if s.startswith('unspsc-'):
        return '\n\n' + unspsc_attribution(s, app['sourceMark']['ja'])
    return ''


def isco_attribution(source, ja):
    """The ILO reference for one ISCO-08 app, in English, and in Japanese too when the app has a Japanese name."""
    code = scheme_code(source)[1]
    text = ISCO_ATTRIBUTION_EN.format(code=code)
    return text + '\n' + ISCO_ATTRIBUTION_JA.format(code=code) if ja else text


def generate(table, inputs, revision, expires_at, base=None, repos=None, marks=None, holds=(), unspsc_marks=None, top=None):
    """top: list only apps of App Cycle rank 1..top (None: every ranked and unranked app in the table)."""
    check_table(table, holds)
    by_scheme = {'isco': marks or {}, 'unspsc': unspsc_marks or {}}
    # Marks apply only to apps in the table; a row for any other repository changes nothing.
    table = json.loads(json.dumps(table))
    for app in table['apps']:
        scheme = scheme_code(app['source'])[0]
        app['sourceMark'] = by_scheme[scheme].get(app['repo']) if scheme in by_scheme else None
    listed, excluded, apps = [], [], []
    if base:
        apps = list(base['apps'])
    present = {a['id'] for a in apps}
    for app in table['apps']:
        s = app['source']
        hold = held_by(s, holds)
        if hold:
            excluded.append({'source': s, 'id': app['id'], 'reason': 'held', 'hold': hold['reason'], 'decidedBy': hold['decidedBy']})
            continue
        if top is not None and (app.get('rank') is None or app['rank'] > top):
            excluded.append({'source': s, 'id': app['id'], 'reason': 'outside-top',
                             'detail': f'rank {app.get("rank")} is outside --top {top}'})
            continue
        scheme = scheme_code(s)[0]
        if scheme in MARKED_SCHEMES and app['sourceMark'] is None:
            excluded.append({'source': s, 'id': app['id'], 'reason': f'{scheme}-source-unchecked'})
            continue
        directory = inputs / s
        if not directory.is_dir():
            excluded.append({'source': s, 'id': app['id'], 'reason': 'no-apk'})
            continue
        release = json.loads((directory / 'release.json').read_text())
        # A build from a working tree with uncommitted changes (dirty true), or with unknown state (null), is not
        # the source it names.
        if release.get('dirty') is not False:
            excluded.append({'source': s, 'id': app['id'], 'reason': 'release-dirty'})
            continue
        if scheme in MARKED_SCHEMES:
            reason = built_after_source(app, release, repos)
            if reason:
                item = {'source': s, 'id': app['id'], 'reason': reason}
                if reason.startswith('built-before-'):
                    mark, built = app['sourceMark']['commit'], release['source_commit']
                    item.update({'mark': mark, 'sourceCommit': built,
                                 'detail': f'APK built from {built[:12]}, which is before the source mark {mark[:12]} '
                                           f'({MARKED_SCHEMES[scheme][0]}); rebuild from {mark[:12]} or a later commit'})
                excluded.append(item)
                continue
        if scheme == 'isic':
            if not (isinstance(release.get('source_commit'), str) and re.fullmatch(r'[0-9a-f]{40}', release['source_commit'])):
                excluded.append({'source': s, 'id': app['id'], 'reason': 'release-without-commit',
                                 'detail': 'the ISIC revision is read from blueprint.edn at the build commit'})
                continue
            generated = isic_description(app, release['source_commit'], repos)
            if 'description' in app and app['description'] != generated:
                raise Refused(f'{s}: the table description {app["description"]!r} disagrees with blueprint.edn, which gives {generated!r}')
            app['description'] = generated
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
    ap.add_argument('--hold', type=pathlib.Path, default=HOLD, help='hold list (patterns, reasons, who lifts them)')
    ap.add_argument('--isco-source', type=pathlib.Path, default=ISCO_SOURCE, help='ISCO-08 source marks (repo, commit, ja)')
    ap.add_argument('--unspsc-source', type=pathlib.Path, default=UNSPSC_SOURCE, help='UNSPSC source marks (repo, commit, ja)')
    ap.add_argument('--repos', type=pathlib.Path, help='directory of app repository clones, one per source, for the ISCO-08 source commit check')
    ap.add_argument('--top', type=int, help='list only App Cycle ranks 1..N (the first catalog uses --top 10)')
    a = ap.parse_args()
    if a.revision < 1 or not 1 <= a.expires_days <= 365:
        ap.error('--revision must be positive and --expires-days 1..365')
    if a.top is not None and a.top < 1:
        ap.error('--top must be a positive rank')
    base = json.loads(a.base.read_text()) if a.base else None
    if base and a.revision <= base['revision']:
        ap.error(f'--revision must be above the base revision {base["revision"]}')
    try:
        catalog, report = generate(json.loads(a.table.read_text()), a.inputs, a.revision, int(time.time()) + a.expires_days * 86400, base, a.repos,
                                   read_isco_marks(a.isco_source.read_text(encoding='utf-8')), read_holds(json.loads(a.hold.read_text(encoding='utf-8'))),
                                   read_source_marks(a.unspsc_source.read_text(encoding='utf-8'), 'unspsc'), a.top)
    except Refused as e:
        sys.exit(f'refused: {e}')
    a.out.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    text = json.dumps(report, ensure_ascii=False, indent=1) + '\n'
    if a.report:
        a.report.write_text(text, encoding='utf-8')
    print(text, end='')


if __name__ == '__main__':
    main()
