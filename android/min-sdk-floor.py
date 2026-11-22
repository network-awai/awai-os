#!/usr/bin/env python3
"""List the Android APIs a host's Java classes reference, with the API level each was introduced at.

Read-only measurement (AWAI-3762). It compiles android/shared/src and android/<kind>/src against the
platform jar, reads every method, field and class reference from the class files with javap, and looks
each one up in the SDK's api-versions.xml. It does not build an APK and does not change minSdkVersion.

What it cannot see: behaviour differences inside an API that exists on both levels, permissions and
manifest attributes, resources and themes, and anything the WebView content needs.
"""
import argparse, collections, json, pathlib, re, subprocess, sys, tempfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1]
REF = re.compile(r'= (Methodref|InterfaceMethodref|Fieldref|Class)\s+\S+\s+// +(.+)$')
PLATFORM = ('android/', 'java/', 'javax/', 'org/json/', 'org/w3c/', 'org/xml/', 'dalvik/', 'libcore/')


def level(text):
    """api-versions.xml writes whole levels as '35' and minor SDK releases as '36.1'."""
    value = float(text)
    return int(value) if value == int(value) else value


def load_api(path):
    classes = {}
    for c in ET.parse(path).getroot().iter('class'):
        since = level(c.get('since', '1'))
        members = {}
        for m in c:
            if m.tag in ('method', 'field'):
                members[(m.tag, m.get('name'))] = level(m.get('since', since))
        supers = [e.get('name') for e in c if e.tag in ('extends', 'implements')]
        classes[c.get('name')] = (since, members, supers)
    return classes


def member_since(api, owner, kind, name):
    """Level of the member as declared on owner or the nearest supertype; None when not found."""
    seen, queue = set(), [owner]
    while queue:
        cls = queue.pop(0)
        if cls in seen or cls not in api:
            continue
        seen.add(cls)
        _, members, supers = api[cls]
        if (kind, name) in members:
            return max(members[(kind, name)], api[owner][0]) if owner in api else members[(kind, name)]
        queue.extend(supers)
    return None


def references(classes_dir, javap):
    out = collections.defaultdict(set)
    for f in sorted(classes_dir.rglob('*.class')):
        text = subprocess.run([javap, '-v', '-p', f], check=True, capture_output=True, text=True).stdout
        user = str(f.relative_to(classes_dir))[:-6]
        for line in text.splitlines():
            m = REF.search(line)
            if not m:
                continue
            kind, body = m.group(1), m.group(2).strip().strip('"')
            if kind == 'Class':
                cls = body.lstrip('[').removeprefix('L').removesuffix(';')
                out[('class', cls, '')].add(user)
            else:
                owner, _, rest = body.partition('.')
                name, _, desc = rest.partition(':')
                name = name.strip('"')
                owner = owner.lstrip('[').removeprefix('L').removesuffix(';')
                if kind == 'Fieldref':
                    out[('field', owner, name)].add(user)
                else:
                    out[('method', owner, name + desc)].add(user)
    return out


def main():
    ap = argparse.ArgumentParser(description='List the Android APIs a host references, with their API levels.')
    ap.add_argument('--kind', default='store', help='android/<kind>/src is compiled together with android/shared/src')
    ap.add_argument('--sdk', type=pathlib.Path, default=pathlib.Path.home() / 'Library/Android/sdk')
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'))
    ap.add_argument('--platform', default='android-37.0', help='platform whose android.jar the sources compile against')
    ap.add_argument('--api-versions', type=pathlib.Path, help='api-versions.xml; default: the newest one in the SDK')
    ap.add_argument('--out', type=pathlib.Path)
    ap.add_argument('--max', type=float, help='exit 1 when a referenced API is newer than this level')
    a = ap.parse_args()
    jar = a.sdk / 'platforms' / a.platform / 'android.jar'
    xml = a.api_versions or max((a.sdk / 'platforms').glob('*/data/api-versions.xml'),
                                key=lambda p: [int(x) for x in re.findall(r'\d+', p.parts[-3])])
    for f in (jar, xml, a.java / 'javac', a.java / 'javap'):
        if not f.is_file():
            sys.exit(f'missing prerequisite: {f}')
    sources = sorted((ROOT / 'android/shared/src').rglob('*.java')) + sorted((ROOT / 'android' / a.kind / 'src').rglob('*.java'))
    api = load_api(xml)
    with tempfile.TemporaryDirectory() as tmp:
        classes = pathlib.Path(tmp)
        subprocess.run([a.java / 'javac', '--release', '8', '-encoding', 'UTF-8', '-nowarn', '-cp', jar, '-d', classes, *sources],
                       check=True, capture_output=True)
        refs = references(classes, a.java / 'javap')
    rows, unknown = [], []
    for (kind, owner, name), users in sorted(refs.items()):
        if not owner.startswith(PLATFORM):
            continue
        if owner not in api:
            unknown.append({'kind': kind, 'owner': owner, 'name': name, 'usedBy': sorted(users)})
            continue
        since = api[owner][0] if kind == 'class' else member_since(api, owner, kind, name)
        if since is None:
            unknown.append({'kind': kind, 'owner': owner, 'name': name, 'usedBy': sorted(users)})
            continue
        rows.append({'since': since, 'kind': kind, 'owner': owner, 'name': name, 'usedBy': sorted(users)})
    rows.sort(key=lambda r: (-r['since'], r['owner'], r['name']))
    by_level = collections.Counter(r['since'] for r in rows)
    report = {'schema': 'awai.android.min-sdk-floor.v1', 'kind': a.kind, 'platformJar': a.platform,
              'apiVersions': str(xml.relative_to(a.sdk)), 'sources': len(sources), 'references': len(rows),
              'floor': rows[0]['since'] if rows else None,
              'countBySince': {str(k): by_level[k] for k in sorted(by_level, reverse=True)},
              'above23': [r for r in rows if r['since'] > 23], 'notInApiVersions': unknown}
    text = json.dumps(report, ensure_ascii=False, indent=1) + '\n'
    if a.out:
        a.out.write_text(text)
    else:
        sys.stdout.write(text)
    if a.max is not None and rows and rows[0]['since'] > a.max:
        newer = [f"{r['owner']}.{r['name']} (API {r['since']})" for r in rows if r['since'] > a.max]
        sys.exit(f'{len(newer)} referenced APIs are newer than API {a.max:g}: ' + '; '.join(newer[:5]))


if __name__ == '__main__':
    main()
