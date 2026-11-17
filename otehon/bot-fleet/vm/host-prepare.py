#!/usr/bin/env python3
"""Prepare this task's additive VM only. Keys never leave their owning host."""
import hashlib, io, json, os, pathlib, plistlib, socket, subprocess, sys, tarfile
p=json.load(sys.stdin); host=p['host']; assert host in ['levi','benjamin']
node='vm-'+host; root=pathlib.Path.home()/'.itonami/vm-workers/awai-2820'
work=pathlib.Path.home()/'github/workspaces/codex/awai-2820-bot-vm'
def run(*args):
    return subprocess.run(args,check=True,capture_output=True,text=True).stdout.strip()
def digest_file(path):
    digest=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): digest.update(block)
    return digest.hexdigest()
def put(path,data,mode=0o600):
    if path.exists():
        if path.is_symlink() or path.read_bytes()!=data: raise RuntimeError('preserve existing '+path.name)
        return
    with path.open('xb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    path.chmod(mode)
if p['mode']=='prepare':
    root.mkdir(parents=True,mode=0o700,exist_ok=True); work.mkdir(parents=True,mode=0o700,exist_ok=True)
    assert not root.is_symlink() and root.stat().st_uid==os.getuid() and root.stat().st_mode & 0o077==0
    put(root/'owner.json',json.dumps({'issue':'AWAI-2820','node':node}).encode())
    if not (root/'client.key').exists():
        run('openssl','ecparam','-name','prime256v1','-genkey','-noout','-out',str(root/'client.key'))
        (root/'client.key').chmod(0o600)
        run('openssl','req','-new','-key',str(root/'client.key'),'-out',str(root/'client.csr'),'-subj','/CN='+node)
    if not (root/'ssh_host_ed25519_key').exists():
        run('/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-C',node,'-f',str(root/'ssh_host_ed25519_key'))
    hardware=json.loads(run('system_profiler','SPHardwareDataType','-json'))['SPHardwareDataType'][0]
    print(json.dumps({'node':node,'csr':(root/'client.csr').read_text(),
       'sshHostPublicKey':(root/'ssh_host_ed25519_key.pub').read_text().strip(),
       'physicalIdentitySha256':hashlib.sha256(hardware['platform_UUID'].encode()).hexdigest(),
       'uid':os.getuid(),'keyStayedOnHost':True}))
elif p['mode']=='install':
    assert json.loads((root/'owner.json').read_text())=={'issue':'AWAI-2820','node':node}
    put(root/'client.pem',p['certificate'].encode());put(root/'client-ca.pem',p['ca'].encode())
    assert run('openssl','pkey','-in',str(root/'client.key'),'-pubout')==run('openssl','x509','-in',str(root/'client.pem'),'-pubkey','-noout')
    run('openssl','verify','-CAfile',str(root/'client-ca.pem'),str(root/'client.pem'))
    assert len(p['endpoints'])==3 and all(x.startswith('https://100.') and x.endswith(':23979') for x in p['endpoints'])
    quote=json.dumps
    cfg='{:node '+quote(node)+' :etcd {:authenticated-node '+quote(node)+' :cluster-id '+quote(p['clusterId'])
    cfg+=' :endpoints ['+' '.join(quote(x) for x in p['endpoints'])+']'
    cfg+=' :ca "/run/itonami-vm-keys/client-ca.pem" :cert "/run/itonami-vm-keys/client.pem" :key "/run/itonami-vm-keys/client.key"}}'
    put(root/'node.edn',cfg.encode())
    keydisk=root/'key-disk.tar'
    if not keydisk.exists():
        with keydisk.open('xb') as stream:
            with tarfile.open(fileobj=stream,mode='w') as tar:
                for name in ['node.edn','client.key','client.pem','client-ca.pem','ssh_host_ed25519_key']:
                    data=(root/name).read_bytes(); entry=tarfile.TarInfo(name);entry.mode=0o600;entry.size=len(data)
                    tar.addfile(entry,io.BytesIO(data))
            stream.flush();os.fsync(stream.fileno())
        keydisk.chmod(0o600)
    print(json.dumps({'node':node,'installed':True,'keyStayedOnHost':True,'certificateNotAfter':run('openssl','x509','-in',str(root/'client.pem'),'-noout','-enddate')}))
elif p['mode']=='activate':
    base=work/'bot-vm-base.qcow2'
    assert base.is_file() and not base.is_symlink()
    assert digest_file(base)==p['imageSha256']
    disk=root/'vm-disk.qcow2'; label='network.awai.itonami.bot-vm.awai2820'
    target='user/'+str(os.getuid())+'/'+label
    assert subprocess.run(['launchctl','print',target],capture_output=True).returncode!=0, 'owned service already present'
    assert not disk.exists(), 'existing disk: preserve and reconcile'
    sock=socket.socket();sock.bind(('127.0.0.1',22280));sock.close()
    run('/opt/homebrew/bin/qemu-img','create','-f','qcow2','-F','qcow2','-b',str(base),str(disk))
    args=['/opt/homebrew/bin/qemu-system-aarch64','-name','Awai Itonami Bot VM AWAI-2820',
       '-machine','virt,accel=hvf','-cpu','host','-smp','2','-m','1024',
       '-bios','/opt/homebrew/share/qemu/edk2-aarch64-code.fd',
       '-drive','if=virtio,format=qcow2,file='+str(disk),
       '-drive','if=none,id=keys,format=raw,readonly=on,file='+str(root/'key-disk.tar'),
       '-device','virtio-blk-pci,drive=keys,serial=itonami-vm-key',
       '-nic','user,model=virtio-net-pci,hostfwd=tcp:127.0.0.1:22280-:22',
       '-display','none','-monitor','none','-serial','file:'+str(root/'serial.log')]
    blob=plistlib.dumps({'Label':label,'ProgramArguments':args,'WorkingDirectory':str(work),
       'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':15,'LimitLoadToSessionType':'Background',
       'StandardOutPath':str(root/'qemu.stdout.log'),'StandardErrorPath':str(root/'qemu.stderr.log')})
    plist=pathlib.Path.home()/'Library/LaunchAgents'/ (label+'.plist')
    plist.parent.mkdir(parents=True,exist_ok=True);put(plist,blob)
    run('plutil','-lint',str(plist));run('launchctl','bootstrap','user/'+str(os.getuid()),str(plist))
    print(json.dumps({'node':node,'activated':True,'label':label,'imageSha256':p['imageSha256'],
       'scope':'additive VM; old guests untouched; user-domain restart only, cold boot unqualified'}))
elif p['mode'] in ['stop','start']:
    assert json.loads((root/'owner.json').read_text())=={'issue':'AWAI-2820','node':node}
    label='network.awai.itonami.bot-vm.awai2820';domain='user/'+str(os.getuid());target=domain+'/'+label
    plist=pathlib.Path.home()/'Library/LaunchAgents'/(label+'.plist')
    job=plistlib.loads(plist.read_bytes())
    assert job['Label']==label and job['ProgramArguments'][0]=='/opt/homebrew/bin/qemu-system-aarch64'
    assert 'if=virtio,format=qcow2,file='+str(root/'vm-disk.qcow2') in job['ProgramArguments']
    assert job['WorkingDirectory']==str(work)
    run('launchctl', 'bootout' if p['mode']=='stop' else 'bootstrap',target if p['mode']=='stop' else domain,
        *([] if p['mode']=='stop' else [str(plist)]))
    print(json.dumps({'node':node,'controlled':p['mode'],'label':label,'scope':'owned additive VM only'}))
else: raise RuntimeError('fixed phase required')
