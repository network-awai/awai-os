#!/usr/bin/env python3
"""Control ONLY the newly owned etcd launchd label. Never reboot/stop the host or guests."""
import json, os, pathlib, subprocess, sys, re, socket, time
p=json.load(sys.stdin); node=p['node']; mode=p['mode']
assert node in ['levi','benjamin','joseph'] and mode in ['start','stop']
r=pathlib.Path.home()/'.itonami/control-plane/etcd/awai-bots-v1'
w=pathlib.Path.home()/'github/workspaces/codex/awai-2795-etcd-control-plane'
m=json.loads((r/'deployment.json').read_text()); assert m['node']==node and m['deployment']=='AWAI-2795-awai-bots-v1'
assert not r.is_symlink() and r.stat().st_uid==os.getuid()
label='network.awai.otehon.etcd'; domain='user/'+str(os.getuid()); target=domain+'/'+label
plist=pathlib.Path.home()/'Library/LaunchAgents'/f'{label}.plist'
ip=re.search(r'^advertise-client-urls: https://([0-9.]+):23979$',(w/'config/etcd.yml').read_text(),re.M).group(1)
def loaded(): return subprocess.run(['launchctl','print',target],capture_output=True).returncode==0
def listening():
    s=socket.socket(); s.settimeout(.3)
    try: return s.connect_ex((ip,23979))==0
    finally: s.close()
if mode=='stop' and loaded():
    subprocess.run(['launchctl','bootout',target],check=True,capture_output=True)
if mode=='start' and not loaded():
    subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True,capture_output=True)
for _ in range(60):
    active=loaded(); port=listening()
    if (mode=='start' and active and port) or (mode=='stop' and not active and not port): break
    time.sleep(.1)
ok=(mode=='start' and active and port) or (mode=='stop' and not active and not port)
print(json.dumps({'node':node,'mode':mode,'confirmed':ok,'loaded':active,'listening':port}))
if not ok: sys.exit(2)
