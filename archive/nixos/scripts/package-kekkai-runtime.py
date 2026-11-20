#!/usr/bin/env python3
"""Freeze existing Kekkai/SCI sources for offline installation (no npm at boot)."""
import hashlib,json,shutil,tarfile,tempfile,subprocess,gzip
from pathlib import Path
import sys
manifest=json.loads(Path(sys.argv[1]).read_text())
engine=Path(sys.argv[2]);out=Path(__file__).resolve().parents[1]/'archive/nixos'
with tempfile.TemporaryDirectory() as d:
 root=Path(d);(root/'src').mkdir();pins=[]
 for ns,src in manifest['namespaces'].items():
  src=Path(src);p=root/'src'/Path(ns.replace('.','/').replace('-','_')+src.suffix);p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,p)
  pins.append({'namespace':ns,'sha256':hashlib.sha256(src.read_bytes()).hexdigest()})
 for name in ['lib','cli.js','package.json','LICENSE']:
  src=engine/name;dst=root/'engine'/name;dst.parent.mkdir(parents=True,exist_ok=True)
  if src.is_dir():shutil.copytree(src,dst)
  else:shutil.copyfile(src,dst)
 shutil.copytree(engine/'node_modules/import-meta-resolve',root/'engine/node_modules/import-meta-resolve')
 for ns,src in manifest['namespaces'].items():
  p=Path(src)
  for parent in p.parents:
   if parent.name=='src':
    for license in parent.parent.glob('LICENSE*'):
     if license.is_file():
      dst=root/'licenses'/parent.parent.name/license.name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(license,dst)
    break
 with (out/'kekkai-runtime.tar.gz').open('wb') as archive, gzip.GzipFile(filename='',fileobj=archive,mode='wb',mtime=0) as compressed, tarfile.open(fileobj=compressed,mode='w') as t:
  for p in sorted(root.rglob('*')):
   if p.is_file():
    info=t.gettarinfo(str(p),str(p.relative_to(root)));info.mtime=0;info.uid=info.gid=0;info.uname=info.gname='';info.mode=0o644
    with p.open('rb') as f:t.addfile(info,f)
 proof={'schema':'murakumo.kekkai-runtime.v1','engineRepository':'https://github.com/kotoba-lang/org-babashka-nbb','engineCommit':subprocess.check_output(['git','-C',str(engine),'rev-parse','HEAD'],text=True).strip(),'sources':pins,'bundleSha256':hashlib.sha256((out/'kekkai-runtime.tar.gz').read_bytes()).hexdigest()}
 (out/'kekkai-runtime-sources.json').write_text(json.dumps(proof,indent=2)+'\n')
