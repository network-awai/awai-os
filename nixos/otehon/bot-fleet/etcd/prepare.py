#!/usr/bin/env python3
"""One-shot administrator provisioning, not a bot/runtime or inference fallback.
Creates only a NEW task-owned etcd app-data root; private keys never leave host.
"""
import json, os, pathlib, subprocess, sys, hashlib
p=json.load(sys.stdin)
assert p['node'] in ['levi','benjamin','joseph']
assert p['version']=='3.6.14'
assert p['sha256']=='fd154573a1f4c098c214d8233507d2766c43a164f7e339c0385aae71d9a1afaf'
home=pathlib.Path.home()
root=home/'.itonami/control-plane/etcd/awai-bots-v1'
work=home/'github/workspaces/codex/awai-2795-etcd-control-plane'
if root.exists() or root.is_symlink() or work.exists() or work.is_symlink():
    raise RuntimeError('existing deployment paths: preserve and reconcile')
root.mkdir(parents=True,mode=0o700); os.chmod(root,0o700)
work.mkdir(parents=True,mode=0o700); (work/'config').mkdir(mode=0o700)
(root/'data').mkdir(mode=0o700); (root/'logs').mkdir(mode=0o700)
(root/'pki').mkdir(mode=0o700); (root/'bin').mkdir(mode=0o700)
manifest={'deployment':'AWAI-2795-awai-bots-v1','node':p['node'],'version':p['version'],'packageSha256':p['sha256']}
(root/'deployment.json').write_text(json.dumps(manifest)); os.chmod(root/'deployment.json',0o600)
csrs={}
for kind in ['server','peer']:
    key=root/'pki'/f'{kind}.key'; csr=root/'pki'/f'{kind}.csr'
    subprocess.run(['openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(key)],check=True,capture_output=True)
    os.chmod(key,0o600)
    subprocess.run(['openssl','req','-new','-key',str(key),'-out',str(csr),'-subj',f'/CN=awai-etcd-{p["node"]}-{kind}'],check=True,capture_output=True)
    csrs[kind]=csr.read_text()
# Download with system TLS and independently require the immutable source digest.
archive=work/'etcd.zip'
subprocess.run(['curl','--fail','--silent','--show-error','--location','--max-redirs','3','--proto','=https','--proto-redir','=https',
               '--max-time','120','https://github.com/etcd-io/etcd/releases/download/v3.6.14/etcd-v3.6.14-darwin-arm64.zip','-o',str(archive)],check=True)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=p['sha256']: raise RuntimeError('package digest mismatch; preserve evidence')
subprocess.run(['unzip','-q',str(archive),'-d',str(work/'package')],check=True)
for name in ['etcd','etcdctl','etcdutl']:
    source=work/'package/etcd-v3.6.14-darwin-arm64'/name
    target=root/'bin'/name
    with target.open('xb') as out: out.write(source.read_bytes())
    os.chmod(target,0o700)
version=subprocess.run([str(root/'bin/etcd'),'--version'],check=True,capture_output=True,text=True).stdout
if 'etcd Version: 3.6.14' not in version: raise RuntimeError('runtime version mismatch')
print(json.dumps({'node':p['node'],'root':str(root),'work':str(work),'uid':os.getuid(),'csrs':csrs,'version':'3.6.14',
                  'packageSha256':p['sha256'],'prepared':True}))
