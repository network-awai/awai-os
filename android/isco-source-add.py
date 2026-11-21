#!/usr/bin/env python3
"""Add a batch of source marks to store/catalog-source/isco-source.tsv and unspsc-source.tsv (AWAI-3629, AWAI-3771).

  python3 android/isco-source-add.py BATCH.tsv [--extra REPO=COMMIT ...] [--repos DIR]
                                     [--isco-tsv FILE] [--unspsc-tsv FILE] [--tsv FILE]

BATCH.tsv has a header `repo<TAB>commit<TAB>ja` (or the batch spelling `repo<TAB>merge_commit<TAB>ja_title`), then one
row per repository. ISCO-08 rows go to isco-source.tsv and UNSPSC rows to unspsc-source.tsv; --tsv names a single
file for a batch of one scheme. Every row is checked before anything is written; one failure writes nothing:
- the row is well formed (an ISCO-08 or UNSPSC series repository, a 40-hex commit, ja true or false);
- the commit is in the repository's history: an ancestor of (or equal to) HEAD of the clone in DIR/<source>
  when given, otherwise of the default branch of a temporary blobless clone from GitHub;
- a repository that already has a mark only moves forward: the old commit is an ancestor of the new one;
- with --extra REPO=COMMIT, a repository has two candidate commits (for example the README commit in the batch and the
  App Build commit for the app screen): one must be an ancestor of the other, and the later one becomes the mark;
  diverged branches are refused.
The same commit again is a no-op. Rows for repositories outside series-apps.json are kept; the generator uses only
the apps in the table.
"""
import argparse, importlib.util, json, pathlib, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location('series_catalog', ROOT / 'android/series-catalog.py')
assert _spec is not None and _spec.loader is not None
sc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sc)
HEADER = 'repo\tcommit\tja'


def git(clone, *args):
    return subprocess.run(['git', '-C', str(clone), *args], capture_output=True, text=True)


def scheme_of(repo):
    for scheme, (_, repo_re, _) in sc.MARKED_SCHEMES.items():
        if repo_re.match(repo):
            return scheme
    return None


def clone_for(repo, repos, scratch):
    source = sc.MARKED_SCHEMES[scheme_of(repo)][1].match(repo).group(1)
    if repos is not None and (repos / source / '.git').exists():
        return repos / source
    target = scratch / source
    r = subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', f'https://github.com/{repo}.git', str(target)],
                       capture_output=True, text=True)
    if r.returncode:
        raise sc.Refused(f'{repo}: could not clone ({r.stderr.strip()[:120]})')
    return target


def read_batch(text):
    """The batch, split by scheme and checked with each scheme's rules."""
    rows = [l for l in text.split('\n') if l.strip() and not l.startswith('#')]
    if rows and rows[0] == 'repo\tmerge_commit\tja_title':
        rows[0] = HEADER
    if not rows or rows[0] != HEADER:
        raise sc.Refused('batch: the first line must be the header repo<TAB>commit<TAB>ja (or repo<TAB>merge_commit<TAB>ja_title)')
    by_scheme = {}
    for line in rows[1:]:
        scheme = scheme_of(line.split('\t')[0])
        if scheme is None:
            raise sc.Refused(f'batch: {line.split(chr(9))[0]!r} is not an ISCO-08 or UNSPSC series repository')
        by_scheme.setdefault(scheme, []).append(line)
    return {s: sc.read_source_marks('\n'.join([HEADER] + lines) + '\n', s) for s, lines in by_scheme.items()}


def new_marks(batch, current, extras, repos, scratch):
    """The rows that change, after every check; raises Refused on the first failure."""
    changes = {}
    for repo, row in batch.items():
        candidates = [row['commit']] + ([extras[repo]] if repo in extras and extras[repo] != row['commit'] else [])
        clone = None
        if len(candidates) > 1 or current.get(repo) != row:
            clone = clone_for(repo, repos, scratch)
            for c in candidates:
                if git(clone, 'cat-file', '-e', c + '^{commit}').returncode:
                    raise sc.Refused(f'{repo}: commit {c[:12]} is not in the repository')
                if git(clone, 'merge-base', '--is-ancestor', c, 'HEAD').returncode:
                    raise sc.Refused(f'{repo}: commit {c[:12]} is not in the history of the default branch')
        commit = candidates[0]
        if len(candidates) == 2:
            first, second = candidates
            if not git(clone, 'merge-base', '--is-ancestor', first, second).returncode:
                commit = second
            elif not git(clone, 'merge-base', '--is-ancestor', second, first).returncode:
                commit = first
            else:
                raise sc.Refused(f'{repo}: {first[:12]} and {second[:12]} are on diverged branches; neither comes after the other')
        mark = {'commit': commit, 'ja': row['ja']}
        old = current.get(repo)
        if old == mark:
            continue
        if old and old['commit'] != commit and git(clone, 'merge-base', '--is-ancestor', old['commit'], commit).returncode:
            raise sc.Refused(f'{repo}: the new commit {commit[:12]} does not come after the current mark {old["commit"][:12]}')
        changes[repo] = mark
    return changes


def write(path, text, current, changes):
    merged = dict(current)
    merged.update(changes)
    head = [l for l in text.rstrip('\n').split('\n') if l.startswith('#')]
    order = list(current) + [r for r in changes if r not in current]
    rows = [f'{r}\t{merged[r]["commit"]}\t{"true" if merged[r]["ja"] else "false"}' for r in order]
    path.write_text('\n'.join(head + [HEADER] + rows) + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('batch', type=pathlib.Path)
    ap.add_argument('--extra', action='append', default=[], metavar='REPO=COMMIT',
                    help='a second candidate commit for a repository in the batch; the later of the two becomes the mark')
    ap.add_argument('--repos', type=pathlib.Path, help='directory of up-to-date clones, one per source (for example isco-2423)')
    ap.add_argument('--isco-tsv', type=pathlib.Path, default=sc.ISCO_SOURCE)
    ap.add_argument('--unspsc-tsv', type=pathlib.Path, default=sc.UNSPSC_SOURCE)
    ap.add_argument('--tsv', type=pathlib.Path, help='one target file, for a batch of a single scheme')
    a = ap.parse_args()
    try:
        batch = read_batch(a.batch.read_text(encoding='utf-8'))
        if a.tsv is not None:
            if len(batch) != 1:
                raise sc.Refused('--tsv takes a batch of a single scheme')
            targets = {next(iter(batch)): a.tsv}
        else:
            targets = {'isco': a.isco_tsv, 'unspsc': a.unspsc_tsv}
        rows = {r: m for marks in batch.values() for r, m in marks.items()}
        extras = {}
        for item in a.extra:
            repo, _, commit = item.partition('=')
            if repo not in rows:
                raise sc.Refused(f'--extra {item}: {repo or "?"} has no row in the batch')
            sc.read_source_marks(f'{HEADER}\n{repo}\t{commit}\tfalse\n', scheme_of(repo))
            if repo in extras:
                raise sc.Refused(f'--extra: {repo} is given twice')
            extras[repo] = commit
        plans = []
        with tempfile.TemporaryDirectory() as scratch:
            for scheme, marks in batch.items():
                path = targets[scheme]
                text = path.read_text(encoding='utf-8')
                current = sc.read_source_marks(text, scheme)
                plans.append((scheme, path, text, current, new_marks(marks, current, extras, a.repos, pathlib.Path(scratch))))
    except sc.Refused as e:
        sys.exit(f'refused, nothing written: {e}')
    written = []
    for scheme, path, text, current, changes in plans:
        if changes:
            write(path, text, current, changes)
            sc.read_source_marks(path.read_text(encoding='utf-8'), scheme)
            written += sorted(changes)
    print(json.dumps({'batchRows': len(rows), 'written': written, 'files': {s: str(p) for s, p, *_ in plans}}))


if __name__ == '__main__':
    main()
