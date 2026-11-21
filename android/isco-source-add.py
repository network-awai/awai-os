#!/usr/bin/env python3
"""Add a batch of ISCO-08 source marks to store/catalog-source/isco-source.tsv (AWAI-3629).

  python3 android/isco-source-add.py BATCH.tsv [--extra REPO=COMMIT ...] [--repos DIR] [--tsv store/catalog-source/isco-source.tsv]

BATCH.tsv has the same form as isco-source.tsv: a header `repo<TAB>commit<TAB>ja` (or the batch spelling
`repo<TAB>merge_commit<TAB>ja_title`), then one row per repository.
Every row is checked before anything is written; one failure writes nothing:
- the row is well formed (an ISCO-08 series repository, a 40-hex commit, ja true or false);
- the commit is in the repository's history: an ancestor of (or equal to) HEAD of the clone in DIR/<source>
  when given, otherwise of the default branch of a temporary blobless clone from GitHub;
- a repository that already has a mark only moves forward: the old commit is an ancestor of the new one.
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


def git(clone, *args):
    return subprocess.run(['git', '-C', str(clone), *args], capture_output=True, text=True)


def clone_for(repo, repos, scratch):
    source = sc.ISCO_REPO.match(repo).group(1)
    if repos is not None and (repos / source / '.git').exists():
        return repos / source
    target = scratch / source
    r = subprocess.run(['git', 'clone', '-q', '--filter=blob:none', '--no-checkout', f'https://github.com/{repo}.git', str(target)],
                       capture_output=True, text=True)
    if r.returncode:
        raise sc.Refused(f'{repo}: could not clone ({r.stderr.strip()[:120]})')
    return target


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('batch', type=pathlib.Path)
    ap.add_argument('--extra', action='append', default=[], metavar='REPO=COMMIT',
                    help='a second candidate commit for a repository in the batch (for example the App Build commit when the '
                         'README commit is in the batch); the later of the two becomes the mark')
    ap.add_argument('--repos', type=pathlib.Path, help='directory of up-to-date clones, one per source (for example isco-2423)')
    ap.add_argument('--tsv', type=pathlib.Path, default=sc.ISCO_SOURCE)
    a = ap.parse_args()
    text = a.tsv.read_text(encoding='utf-8')
    try:
        current = sc.read_isco_marks(text)
        batch_text = a.batch.read_text(encoding='utf-8')
        # Batches from the attribution work name the columns repo, merge_commit, ja_title; same meaning.
        lines = batch_text.split('\n')
        lines = ['repo\tcommit\tja' if l == 'repo\tmerge_commit\tja_title' else l for l in lines]
        batch = sc.read_isco_marks('\n'.join(lines))
        extras = {}
        for item in a.extra:
            repo, _, commit = item.partition('=')
            # Same row rules as the TSV; ja comes from the batch row.
            if repo not in batch:
                raise sc.Refused(f'--extra {item}: {repo or "?"} has no row in the batch')
            sc.read_isco_marks(f'repo\tcommit\tja\n{repo}\t{commit}\tfalse\n')
            if repo in extras:
                raise sc.Refused(f'--extra: {repo} is given twice')
            extras[repo] = commit
        changes = {}
        with tempfile.TemporaryDirectory() as scratch:
            for repo, row in batch.items():
                candidates = [row['commit']] + ([extras[repo]] if repo in extras and extras[repo] != row['commit'] else [])
                clone = None
                if len(candidates) > 1 or current.get(repo) != row:
                    clone = clone_for(repo, a.repos, pathlib.Path(scratch))
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
    except sc.Refused as e:
        sys.exit(f'refused, nothing written: {e}')
    if changes:
        merged = dict(current)
        merged.update(changes)
        head = [l for l in text.rstrip('\n').split('\n') if l.startswith('#')]
        order = list(current) + [r for r in changes if r not in current]
        rows = [f'{r}\t{merged[r]["commit"]}\t{"true" if merged[r]["ja"] else "false"}' for r in order]
        a.tsv.write_text('\n'.join(head + ['repo\tcommit\tja'] + rows) + '\n', encoding='utf-8')
        sc.read_isco_marks(a.tsv.read_text(encoding='utf-8'))
    print(json.dumps({'tsv': str(a.tsv), 'batchRows': len(batch), 'written': sorted(changes)}))

if __name__ == '__main__':
    main()
