#!/usr/bin/env python3
"""Install one digest-verified immutable Otehon source closure, never a profile/script import."""
import json, os, pathlib, sys, hashlib, tarfile, re
p=json.load(sys.stdin); node=p['node']; revision=p['revision']; digest=p['sha256']
assert node in ['levi','benjamin','joseph'] and re.fullmatch('[a-f0-9]{40}',revision) and re.fullmatch('[a-f0-9]{64}',digest)
r=pathlib.Path.home()/'.itonami/control-plane/etcd/awai-bots-v1'
w=pathlib.Path.home()/'github/workspaces/codex/awai-2795-etcd-control-plane'
assert json.loads((r/'deployment.json').read_text())['node']==node
archive=w/'itonami-runtime.tar'
assert hashlib.sha256(archive.read_bytes()).hexdigest()==digest
out=w/'runtime-src'/revision
if out.exists(): raise RuntimeError('existing runtime source: preserve and reconcile')
with tarfile.open(archive) as t:
    members=t.getmembers()
    assert len(members)<200 and sum(m.size for m in members)<8388608
    for m in members:
        path=pathlib.PurePosixPath(m.name)
        assert not path.is_absolute() and '..' not in path.parts and not m.issym() and not m.islnk()
        assert m.isdir() or m.isfile()
        assert m.name in ['otehon','otehon/src'] or m.name.startswith('otehon/src/')
    out.mkdir(parents=True,mode=0o700)
    t.extractall(out,members=members) # every member validated above; supports host Python3.9
meta={'schema':'awai.otehon.runtime-source.v1','repository':'cloud-itonami/app-itonami-itonami-agent',
      'revision':revision,'archiveSha256':digest,'source':str(out/'otehon/src')}
with (w/'config/runtime.json').open('x') as f: json.dump(meta,f); f.flush(); os.fsync(f.fileno())
os.chmod(w/'config/runtime.json',0o600)
print(json.dumps({'node':node,'installed':True,'revision':revision,'archiveSha256':digest}))
