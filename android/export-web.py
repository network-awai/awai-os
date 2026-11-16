#!/usr/bin/env python3
"""Export the exact Android build's static client, without Android payloads."""
import argparse, hashlib, json, pathlib, shutil
ap=argparse.ArgumentParser();ap.add_argument('build',type=pathlib.Path);ap.add_argument('destination',type=pathlib.Path);args=ap.parse_args()
source=args.build/'web';dest=args.destination
if dest.exists():raise SystemExit('destination must be new; preserve existing evidence')
shutil.copytree(source,dest,ignore=shutil.ignore_patterns('packages','catalog.json','catalog.sig','catalog-key.der'))
manifest={'schema':'awai.shared-web.v1','files':{str(p.relative_to(dest)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.rglob('*')) if p.is_file()}}
(dest/'bundle-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(manifest['files']),'androidPayloads':False}))
