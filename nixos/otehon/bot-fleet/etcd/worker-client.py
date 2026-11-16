#!/usr/bin/env python3
"""Create one host-owned worker key, or install its signed public certificate.
No private key is returned, copied to a peer, or passed to a Bot/model.
"""
import json, os, pathlib, subprocess, sys, hashlib
p=json.load(sys.stdin); node=p['node']; assert node in ['levi','benjamin','joseph']
r=pathlib.Path.home()/'.itonami/control-plane/etcd/awai-bots-v1'
m=json.loads((r/'deployment.json').read_text()); assert m['node']==node and m['deployment']=='AWAI-2795-awai-bots-v1'
assert not r.is_symlink() and r.stat().st_uid==os.getuid() and r.stat().st_mode & 0o077 == 0
key=r/'pki/client.key'; csr=r/'pki/client.csr'; cert=r/'pki/client.pem'
if p['mode']=='request':
    if key.exists() or csr.exists(): raise RuntimeError('existing worker key: preserve and reconcile')
    subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True,capture_output=True)
    os.chmod(key,0o600)
    subprocess.run(['openssl','req','-new','-key',str(key),'-out',str(csr),'-subj','/CN='+node],check=True,capture_output=True)
    print(json.dumps({'node':node,'clientPrepared':True,'csr':csr.read_text()}))
elif p['mode']=='install':
    if cert.exists(): raise RuntimeError('existing worker cert: preserve and reconcile')
    with cert.open('xb') as f: f.write(p['cert'].encode()); f.flush(); os.fsync(f.fileno())
    os.chmod(cert,0o600)
    keypub=subprocess.run(['openssl','pkey','-in',str(key),'-pubout'],check=True,capture_output=True).stdout
    certpub=subprocess.run(['openssl','x509','-in',str(cert),'-pubkey','-noout'],check=True,capture_output=True).stdout
    assert keypub==certpub
    cfg=dict(p['config']); cfg.update({'authenticated-node':node,'ca':str(r/'pki/client-ca.pem'),
        'cert':str(cert),'key':str(key),'etcdctl':str(r/'bin/etcdctl'),
        'etcdctl-sha256':hashlib.sha256((r/'bin/etcdctl').read_bytes()).hexdigest()})
    config=r/'worker-client.json'
    with config.open('x') as f: json.dump(cfg,f); f.flush(); os.fsync(f.fileno())
    os.chmod(config,0o600)
    print(json.dumps({'node':node,'clientInstalled':True,'privateKeyStayedOnHost':True,'binarySha256':cfg['etcdctl-sha256']}))
else: raise RuntimeError('unknown phase')
