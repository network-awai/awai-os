#!/usr/bin/env python3
"""One-shot administrator activation of this task's exact new user-domain job."""
import json, os, pathlib, plistlib, subprocess, sys, ipaddress
p=json.load(sys.stdin); node=p['node']
assert node in ['levi','benjamin','joseph']
root=pathlib.Path.home()/'.itonami/control-plane/etcd/awai-circle-goals-v1'
work=pathlib.Path.home()/'github/workspaces/codex/awai-2864-circle-ledger'
manifest=json.loads((root/'deployment.json').read_text())
assert manifest['deployment']=='AWAI-2864-circle-goals-v1' and manifest['node']==node
assert not root.is_symlink() and root.stat().st_uid==os.getuid() and root.stat().st_mode & 0o077 == 0

def put(path,data,mode=0o600):
    if path.exists():
        if path.is_symlink() or path.read_bytes()!=data: raise RuntimeError('existing file differs: preserve '+str(path))
    else:
        with path.open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        os.chmod(path,mode)
for name,cert in p['certs'].items():
    assert name in ['server.pem','peer.pem','client-ca.pem','peer-ca.pem']
    put(root/'pki'/name,cert.encode())
cluster=','.join(f'{n}=https://{ip}:23990' for n,ip in p['members'].items())
assert set(p['members'])=={'levi','benjamin','joseph'}
assert len(set(p['members'].values()))==3
assert all(ipaddress.ip_address(a) in ipaddress.ip_network('100.64.0.0/10') for a in p['members'].values())
ip=p['members'][node]
assert ip.startswith('100.')
config=f'''name: {node}
data-dir: {root}/data
listen-client-urls: https://{ip}:23989
advertise-client-urls: https://{ip}:23989
listen-peer-urls: https://{ip}:23990
initial-advertise-peer-urls: https://{ip}:23990
initial-cluster: {cluster}
initial-cluster-state: new
initial-cluster-token: AWAI-2864-circle-goals-v1
client-transport-security:
  cert-file: {root}/pki/server.pem
  key-file: {root}/pki/server.key
  trusted-ca-file: {root}/pki/client-ca.pem
  client-cert-auth: true
peer-transport-security:
  cert-file: {root}/pki/peer.pem
  key-file: {root}/pki/peer.key
  trusted-ca-file: {root}/pki/peer-ca.pem
  client-cert-auth: true
strict-reconfig-check: true
enable-grpc-gateway: false
quota-backend-bytes: 2147483648
auto-compaction-mode: periodic
auto-compaction-retention: 24h
max-snapshots: 5
max-wals: 5
logger: zap
log-level: warn
'''
configfile=work/'config/etcd.yml'; put(configfile,config.encode())
label='network.awai.otehon.circle-ledger'
plist=pathlib.Path.home()/'Library/LaunchAgents'/f'{label}.plist'
plist.parent.mkdir(parents=True,exist_ok=True)
oldblob=plistlib.dumps({'Label':label,'ProgramArguments':[str(root/'bin/etcd'),'--config-file',str(configfile)],
 'WorkingDirectory':str(work),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,
 'EnvironmentVariables':{'GOMAXPROCS':'2','GOMEMLIMIT':'512MiB'},
 'StandardOutPath':str(root/'logs/stdout.log'),'StandardErrorPath':str(root/'logs/stderr.log')})
domain=f'user/{os.getuid()}'
state=subprocess.run(['launchctl','print',domain+'/'+label],capture_output=True)
if state.returncode==0: raise RuntimeError('service already present: reconcile instead of restarting')
job=plistlib.loads(oldblob); job['LimitLoadToSessionType']='Background'
blob=plistlib.dumps(job)
if plist.exists() and plist.read_bytes()==oldblob:
    # Only this unit's exact generated initial plist, with no loaded service.
    put(work/'config/etcd-plist-before-background.xml',oldblob)
    temporary=work/'config/etcd-plist-background.xml'; put(temporary,blob)
    os.replace(temporary,plist)
put(plist,blob)
boot=subprocess.run(['launchctl','bootstrap',domain,str(plist)],capture_output=True,text=True)
if boot.returncode:
    print(json.dumps({'node':node,'activated':False,'phase':'launchctl-bootstrap','exit':boot.returncode,'error':boot.stderr[:1200]}))
    sys.exit(2)
print(json.dumps({'node':node,'label':label,'domain':domain,'activated':True,
                  'bootQualification':'user-domain-only; machine cold boot unverified'}))
