#!/usr/bin/env python3
"""Admit operator-delivered bytes before any Nix import. No network calls."""
import hashlib,json,pathlib,subprocess,sys,tarfile
root=pathlib.Path(sys.argv[1]).resolve(); expected=sys.argv[2]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(8*1024*1024):h.update(b)
 return h.hexdigest()
if len(expected)!=64 or sha(root/'inputs.json')!=expected:raise SystemExit('input lock SHA256 refused')
lock=json.loads((root/'inputs.json').read_text())
if lock['schema']!='awai.ci.local-inputs.v1' or set(lock['files'])!={'source.tar.gz','nixpkgs.tar.gz'}:raise SystemExit('input lock schema refused')
for name,ref in lock['files'].items():
 p=root/name
 if p.is_symlink() or not p.is_file() or p.stat().st_size!=ref['bytes'] or sha(p)!=ref['sha256']:raise SystemExit('input artifact SHA256 refused')
source=root/'source'
if source.exists():raise SystemExit('fresh source extraction required')
with tarfile.open(root/'source.tar.gz','r:gz') as t:
 for m in t.getmembers():
  if not m.name.startswith('source/') and m.name!='source':raise SystemExit('archive root refused')
  if '..' in pathlib.PurePosixPath(m.name).parts:raise SystemExit('archive path refused')
 t.extractall(root,filter='data')
revision=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
if revision!=lock['sourceRevision']:raise SystemExit('source revision refused')
if subprocess.check_output(['git','-C',str(source),'status','--porcelain'],text=True).strip():raise SystemExit('dirty source refused')
print(json.dumps({'admitted':True,'sourceRevision':revision,'lockSha256':expected,'inputs':lock['files']}))
