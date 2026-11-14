"""Otehon OS administration: fixed offline installer, AF_UNIX only, no shell/API origin."""
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import socket
import stat
import struct
import subprocess
import threading
import time

CHUNK = 4 * 1024 * 1024
SOURCE = Path('/iso/otehon/image.raw.zst')
RUNDIR = Path('/run/otehon-install')
LOCK = Path('/run/otehon-install.lock')

class Refused(Exception): pass
class Cancelled(Exception): pass

def command(args, **kw):
    return subprocess.check_output(args, text=True, **kw).strip()

def edn(value):
    if value is None: return 'nil'
    if isinstance(value, bool): return 'true' if value else 'false'
    if isinstance(value, (int, float)): return str(value)
    if isinstance(value, str): return json.dumps(value, ensure_ascii=True)
    if isinstance(value, list): return '[' + ' '.join(map(edn, value)) + ']'
    if isinstance(value, dict): return '{' + ' '.join(edn(str(k)) + ' ' + edn(v) for k, v in value.items()) + '}'
    raise TypeError('unsupported protocol value')

def decode(line):
    if len(line) > 4096 or not line.endswith(b'\n'): raise Refused('request-bound')
    fields = line[:-1].split(b'\t')
    op = fields[0].decode('ascii')
    arity = {'LIST':0, 'STATUS':0, 'SELECT':1, 'INSTALL':3, 'CANCEL':0, 'TEXT':0, 'REBOOT':0, 'POWEROFF':0}
    if op not in arity or len(fields)-1 != arity[op]: raise Refused('request-shape')
    values = []
    for field in fields[1:]:
        try: value = base64.b64decode(field, validate=True).decode('utf-8')
        except (ValueError, UnicodeError): raise Refused('request-encoding')
        if not value or len(value) > 256 or any(ord(c) < 32 for c in value): raise Refused('request-field')
        values.append(value)
    return op, values

def inventory():
    rows = json.loads(command(['lsblk','-J','-b','-o','PATH,TYPE,SIZE,MODEL,SERIAL,FSTYPE,LABEL,PARTLABEL,MOUNTPOINTS,MAJ:MIN,RO']))['blockdevices']
    swaps = {x.split()[0] for x in Path('/proc/swaps').read_text().splitlines()[1:]}
    def descendants(row):
        yield row
        for child in row.get('children', []): yield from descendants(child)
    result = []
    for row in rows:
        if row.get('type') != 'disk': continue
        nodes = list(descendants(row))
        used = any(any(n.get('mountpoints') or []) or n['path'] in swaps or
                   any((Path('/sys/class/block') / Path(n['path']).name / 'holders').iterdir()) for n in nodes)
        path = row['path']; info = os.stat(path)
        if not stat.S_ISBLK(info.st_mode): continue
        serial = (row.get('serial') or '').strip()
        identity = {'path':path,'serial':serial,'size':int(row['size']),'rdev':info.st_rdev,'majorMinor':row['maj:min'],
                    'diskseq':(Path('/sys/class/block') / Path(path).name / 'diskseq').read_text().strip()}
        ident = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        result.append({**identity, 'id':ident,'model':(row.get('model') or 'Disk').strip(),
                       'used':used,'readOnly':bool(row.get('ro')),
                       'partitions':[{'path':n['path'],'fstype':n.get('fstype') or '', 'label':n.get('label') or n.get('partlabel') or '', 'size':int(n['size'])} for n in nodes[1:]]})
    counts = {}
    for r in result: counts[r['serial']] = counts.get(r['serial'],0)+1
    for r in result: r['ambiguous'] = not r['serial'] or counts[r['serial']] != 1
    return result

def admit(rows, ident, raw_bytes):
    found = [r for r in rows if r['id'] == ident]
    if len(found) != 1: raise Refused('target-changed')
    row = found[0]
    if row['ambiguous']: raise Refused('missing-or-ambiguous-serial')
    if row['used'] or row['readOnly']: raise Refused('target-in-use')
    if row['size'] <= raw_bytes: raise Refused('target-too-small')
    return row

class Broker:
    def __init__(self, digests, rundir=RUNDIR):
        self.rundir = rundir
        self.expected_image = (digests/'image').read_text().strip()
        self.expected_raw = (digests/'raw').read_text().strip()
        self.raw_bytes = int((digests/'bytes').read_text())
        if not all(len(x)==64 and all(c in '0123456789abcdef' for c in x) for x in [self.expected_image,self.expected_raw]) or not 0 < self.raw_bytes <= 128*1024**3: raise Refused('invalid-pinned-digests')
        self.lock = threading.RLock(); self.cancel = threading.Event(); self.selected = None; self.ticket = None
        self.state = {'phase':'idle','done':0,'total':0,'writeStarted':False,'message':'USB から起動中です。保存先はまだ選択していません。'}
        self.started = time.monotonic(); self.last_saved = 0
        old = rundir/'state.json'
        if old.exists():
            previous=json.loads(old.read_text())
            if previous.get('writeStarted') and previous.get('phase') != 'complete':
                self.state={'phase':'failed','writeStarted':True,'done':0,'total':0,'message':'前の処理が途中で停止しました。保存先は一部変更された可能性があります。','error':'interrupted-write'}
    def snapshot(self):
        with self.lock: return {**self.state,'elapsed':int(time.monotonic()-self.started),'lastUpdateAgo':int(time.monotonic()-self.state.get('updated',self.started))}
    def update(self, **fields):
        with self.lock:
            self.state.update(fields); self.state['updated']=time.monotonic()
            if time.monotonic()-self.last_saved > 2 or 'phase' in fields:
                target=self.rundir/'state.json'; temp=self.rundir/'state.new'
                with temp.open('w') as out:
                    os.fchmod(out.fileno(),0o600); json.dump(self.state,out);out.flush();os.fsync(out.fileno())
                temp.replace(target); self.last_saved=time.monotonic()
    def busy(self): return self.state['phase'] in ('verify','write','readback')
    def select(self, ident):
        with self.lock:
            if self.busy(): raise Refused('install-in-progress')
            row=admit(inventory(),ident,self.raw_bytes)
            self.selected=row;self.ticket=secrets.token_urlsafe(32);self.selected_at=time.monotonic()
            return {'target':row,'ticket':self.ticket}
    def begin(self, ticket, serial, confirmation):
        with self.lock:
            if self.busy() or not self.ticket or not secrets.compare_digest(ticket,self.ticket): raise Refused('approval-stale')
            if time.monotonic()-self.selected_at > 600: self.ticket=None;raise Refused('approval-expired')
            if serial != self.selected['serial'] or confirmation != 'ERASE': raise Refused('approval-mismatch')
            row=admit(inventory(),self.selected['id'],self.raw_bytes)
            self.ticket=None;self.cancel.clear();self.started=time.monotonic()
            self.update(phase='verify',done=0,total=0,writeStarted=False,target=row,message='USB 内の OS データを照合しています。保存先はまだ変更していません。',error=None)
            threading.Thread(target=self.install,args=(row,),daemon=True).start()
    def install(self, row):
        process=None;fd=None
        try:
            with LOCK.open('a') as lock:
                try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError: raise Refused('another-installer-active')
                if SOURCE.is_symlink() or not SOURCE.is_file() or command(['findmnt','-n','-o','FSTYPE','--target',str(SOURCE)]) != 'iso9660': raise Refused('offline-source')
                if 'ro' not in command(['findmnt','-n','-o','OPTIONS','--target',str(SOURCE)]).split(','): raise Refused('source-not-read-only')
                source_fd=os.open(SOURCE,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
                with os.fdopen(source_fd,'rb') as source:
                    size=os.fstat(source.fileno()).st_size
                    if not 0 < size <= 8*1024**3: raise Refused('source-bound')
                    h=hashlib.sha256();done=0;self.update(total=size)
                    while chunk:=source.read(CHUNK):
                        if self.cancel.is_set(): raise Cancelled()
                        h.update(chunk);done+=len(chunk);self.update(done=done)
                if h.hexdigest()!=self.expected_image: raise Refused('image-digest-mismatch')
                current=admit(inventory(),row['id'],self.raw_bytes)
                fd=os.open(current['path'],os.O_RDWR|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC)
                info=os.fstat(fd)
                if not stat.S_ISBLK(info.st_mode) or info.st_rdev!=row['rdev']: raise Refused('target-changed')
                admit(inventory(),row['id'],self.raw_bytes)
                with self.lock:
                    if self.cancel.is_set(): raise Cancelled()
                    self.update(phase='write',done=0,total=self.raw_bytes,writeStarted=True,message='保存先を変更しています。電源と USB は接続したままにしてください。')
                # Operate on the already-admitted open device, never reopen a hotplug path.
                subprocess.run(['sgdisk','--zap-all',f'/proc/self/fd/{fd}'],pass_fds=(fd,),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                os.lseek(fd,0,os.SEEK_SET)
                process=subprocess.Popen(['zstd','-dc','--',str(SOURCE)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
                done=0
                while chunk:=process.stdout.read(CHUNK):
                    if done+len(chunk)>self.raw_bytes: raise Refused('raw-size-overflow')
                    view=memoryview(chunk)
                    while view:
                        count=os.write(fd,view)
                        if count<=0: raise OSError('short write')
                        view=view[count:]
                    done+=len(chunk);self.update(done=done)
                if process.wait()!=0 or done!=self.raw_bytes: raise Refused('raw-size-or-decode')
                os.fsync(fd);fcntl.ioctl(fd,0x1261) # BLKFLSBUF, fixed Linux block-device ABI.
                os.lseek(fd,0,os.SEEK_SET)
                self.update(phase='readback',done=0,total=self.raw_bytes,message='NVMe から全長を読み戻して照合しています。')
                h=hashlib.sha256();done=0
                while done<self.raw_bytes:
                    chunk=os.read(fd,min(CHUNK,self.raw_bytes-done))
                    if not chunk: raise Refused('readback-short')
                    h.update(chunk);done+=len(chunk);self.update(done=done)
                if h.hexdigest()!=self.expected_raw: raise Refused('raw-digest-mismatch')
                self.update(phase='complete',done=done,sha256=h.hexdigest(),message='NVMe へのインストールと全長照合が完了しました。')
        except Cancelled:
            self.update(phase='cancelled',message='この試行では保存先に書き込まずに中止しました。')
        except Exception as error:
            self.update(phase='failed',error=str(error) if isinstance(error,Refused) else type(error).__name__,message='書込みと照合を完了できませんでした。' if self.state.get('writeStarted') else '書込み前の確認に失敗しました。保存先は変更していません。')
        finally:
            if process and process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)
            if fd is not None: os.close(fd)
    def dispatch(self,op,args):
        if op=='LIST': return {'devices':inventory(),'rawBytes':self.raw_bytes,'state':self.snapshot()}
        if op=='STATUS': return self.snapshot()
        if op=='SELECT': return self.select(*args)
        if op=='INSTALL': self.begin(*args);return self.snapshot()
        if op=='CANCEL':
            with self.lock:
                if self.state['phase']!='verify' or self.state.get('writeStarted'): raise Refused('cannot-cancel-after-write')
                self.cancel.set()
            return self.snapshot()
        if op=='TEXT':
            if self.busy(): raise Refused('install-in-progress')
            subprocess.run(['systemctl','start','otehon-install@tty2.service'],check=True)
            subprocess.run(['chvt','2'],check=True);return {'ok':True}
        if op in ('REBOOT','POWEROFF'):
            with self.lock:
                if self.state['phase']!='complete': raise Refused('not-verified-complete')
                subprocess.Popen(['systemctl','reboot' if op=='REBOOT' else 'poweroff','--no-block'])
            return {'ok':True}
        raise Refused('operation')

def serve():
    if os.geteuid()!=0: raise Refused('root-service-required')
    user=pwd.getpwnam('otehon-installer')
    RUNDIR.mkdir(mode=0o750,exist_ok=True);os.chown(RUNDIR,0,user.pw_gid);os.chmod(RUNDIR,0o750)
    broker=Broker(Path(os.environ['DIGESTS']))
    path=RUNDIR/'control.sock'
    if path.exists():
        if not stat.S_ISSOCK(path.lstat().st_mode): raise Refused('socket-path')
        path.unlink()
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
        server.bind(str(path));os.chown(path,0,user.pw_gid);os.chmod(path,0o660);server.listen(4)
        while True:
            connection,_=server.accept()
            with connection:
                connection.settimeout(3)
                _,uid,_=struct.unpack('3i',connection.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12))
                if uid!=user.pw_uid: continue
                try:
                    with connection.makefile('rb') as stream: op,args=decode(stream.readline(4098))
                    response={'ok':True,'value':broker.dispatch(op,args)}
                except Exception as error: response={'ok':False,'error':str(error) if isinstance(error,Refused) else type(error).__name__}
                connection.sendall((edn(response)+'\n').encode())

if __name__=='__main__': serve()
