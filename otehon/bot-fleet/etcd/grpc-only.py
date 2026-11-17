#!/usr/bin/env python3
"""One-variable update of this task's own verified config; service control is separate."""
import json, os, pathlib, sys, hashlib
p=json.load(sys.stdin); node=p['node']; assert node in ['levi','benjamin','joseph']
r=pathlib.Path.home()/'.itonami/control-plane/etcd/awai-bots-v1'
w=pathlib.Path.home()/'github/workspaces/codex/awai-2795-etcd-control-plane'
m=json.loads((r/'deployment.json').read_text()); assert m['node']==node and m['deployment']=='AWAI-2795-awai-bots-v1'
f=w/'config/etcd.yml'; assert not f.is_symlink() and f.stat().st_uid==os.getuid()
before=f.read_bytes(); text=before.decode()
assert f'name: {node}\n' in text and f'data-dir: {r}/data\n' in text
assert f'  key-file: {r}/pki/server.key\n' in text and f'  key-file: {r}/pki/peer.key\n' in text
changed='enable-grpc-gateway: true\n' in text
if changed:
    assert text.count('enable-grpc-gateway: true\n')==1
    backup=w/'config'/('etcd-before-grpc-only-'+hashlib.sha256(before).hexdigest()[:16]+'.yml')
    with backup.open('xb') as out: out.write(before); out.flush(); os.fsync(out.fileno())
    os.chmod(backup,0o600)
    after=text.replace('enable-grpc-gateway: true\n','enable-grpc-gateway: false\n').encode()
    temp=w/'config/etcd-grpc-only.tmp'
    with temp.open('xb') as out: out.write(after); out.flush(); os.fsync(out.fileno())
    os.chmod(temp,0o600)
    assert f.read_bytes()==before
    os.replace(temp,f)
else:
    assert 'enable-grpc-gateway: false\n' in text
    after=before
print(json.dumps({'node':node,'grpcOnly':True,'changed':changed,'beforeSha256':hashlib.sha256(before).hexdigest(),'afterSha256':hashlib.sha256(after).hexdigest()}))
