"""Otehon OS administration: fixed offline installer, AF_UNIX only, no shell/API origin."""
import base64
import errno
import fcntl
import hashlib
import json
import itertools
import os
from pathlib import Path
import pwd
import re
import secrets
import socket
import stat
import struct
import subprocess
import sys
import threading
import time

CHUNK = 4 * 1024 * 1024
SOURCE = Path('/iso/otehon/image.raw.zst')
RUNDIR = Path('/run/otehon-install')
LOCK = Path('/run/otehon-install.lock')

def boot_check():
    result=subprocess.run(['otehon-install-boot','check'],capture_output=True,timeout=15)
    if result.returncode: raise Refused('USB を UEFI モードで起動し、起動情報へ書き込める状態にしてください。保存先は変更していません。')

class Refused(Exception): pass
class Cancelled(Exception): pass

def failure_diagnostic(error, operation, state):
    """Bounded metadata only: no filename, command, environment or payload."""
    clean=lambda value: ''.join(c if c.isprintable() else '?' for c in str(value))[:160]
    number=error.errno if isinstance(error,OSError) else None
    return {'operation':operation,'phase':state.get('phase','unknown'),
            'exception':type(error).__name__,'errno':number,
            'errnoName':errno.errorcode.get(number,'UNKNOWN') if number is not None else '',
            'detail':clean(error.strerror or 'OS operation failed') if isinstance(error,OSError) else '',
            'done':state.get('done',0),'total':state.get('total',0),
            'writeStarted':bool(state.get('writeStarted'))}

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
                       'used':used,'readOnly':bool(row.get('ro')),'fileSystem':row.get('fstype') or '',
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


def device_usage(rows, proc_root=Path('/proc'), sys_root=Path('/sys/class/block'), budget=3.0, max_pids=2048, max_fds=256):
    """Bounded metadata and O_RDONLY probes; never read payloads or write disks."""
    deadline = time.monotonic() + budget
    result = {'available': True, 'readOnly': True, 'truncated': len(rows) > 8,
              'processesScanned': 0, 'namespaceViewsScanned': 0, 'errors': 0, 'devices': []}
    owners = {}; paths = {}; seen_mounts = set(); seen_views = set()
    def small(path, limit):
        with path.open('rb') as stream: data = stream.read(limit + 1)
        if len(data) > limit: result['truncated'] = True
        return data[:limit].decode('utf-8', 'replace')
    def entries(path, maximum):
        with os.scandir(path) as scan: found = list(itertools.islice(scan, maximum + 1))
        if len(found) > maximum: result['truncated'] = True
        return [Path(entry.path) for entry in found[:maximum]]
    for row in rows[:8]:
        item = {'id': row['id'], 'path': row['path'], 'majorMinor': row['majorMinor'],
                'fileSystem': row.get('fileSystem', ''), 'holders': [], 'mountNamespaceReferences': [], 'openFdReferences': []}
        result['devices'].append(item)
        owners[row['majorMinor']] = item; paths[row['path']] = item
        node = sys_root / Path(row['path']).name
        try:
            item['holders'] = [p.name for p in entries(node / 'holders', 32)]
            for child in entries(node, 256):
                if (child / 'partition').is_file():
                    owners[small(child / 'dev', 64).strip()] = item
                    paths['/dev/' + child.name] = item
        except OSError: result['errors'] += 1
    try: processes = (p for p in entries(proc_root, max_pids + 64) if p.name.isdecimal())
    except OSError: result['available'] = False; return result
    for proc in processes:
        if result['processesScanned'] >= max_pids or time.monotonic() >= deadline:
            result['truncated'] = True; break
        result['processesScanned'] += 1
        try:
            comm = ''.join(c if c.isprintable() else '?' for c in small(proc / 'comm', 128).strip())[:32]
            namespace = os.readlink(proc / 'ns/mnt')
            unit = ''
            try:
                units = re.findall(r'(?:^|/)([A-Za-z0-9_.@:-]{1,128}\.service)(?:/|$)', small(proc / 'cgroup', 4096))
                unit = units[-1] if units else ''
            except OSError: pass
            mounts = {}
            for line in small(proc / 'mountinfo', 65536).splitlines():
                fields = line.split(); split = fields.index('-')
                if len(fields) < split + 3: continue
                if fields[2] not in owners: continue
                item = owners[fields[2]]; mounts[fields[0]] = item
                key = (namespace, fields[0], fields[2])
                if key not in seen_mounts and len(item['mountNamespaceReferences']) < 64:
                    item['mountNamespaceReferences'].append({'namespace': namespace, 'representativePid': int(proc.name),
                        'representativeComm': comm, 'unit': unit, 'majorMinor': fields[2], 'fsType': fields[split + 1]})
                    seen_mounts.add(key)
            seen_views.add(namespace); result['namespaceViewsScanned'] = len(seen_views)
            fds = (p for p in entries(proc / 'fd', max_fds) if p.name.isdecimal())
            for index, fd in enumerate(fds):
                if index >= max_fds or time.monotonic() >= deadline:
                    result['truncated'] = True; break
                try:
                    link = os.readlink(fd)
                    info = dict(line.split(':', 1) for line in small(proc / 'fdinfo' / fd.name, 4096).splitlines() if ':' in line)
                    item = paths.get(link) or mounts.get(info.get('mnt_id', '').strip())
                    if item is not None:
                        if len(item['openFdReferences']) >= 128: result['truncated'] = True; continue
                        item['openFdReferences'].append({'pid': int(proc.name), 'comm': comm, 'fd': int(fd.name),
                            'unit': unit, 'flags': info.get('flags', '').strip()[:16],
                            'reference': 'block-device-path' if link in paths else 'file-on-device-mount'})
                except OSError: result['errors'] += 1
        except (OSError, ValueError): result['errors'] += 1
    for item in result['devices']:
        if time.monotonic() >= deadline:
            result['truncated'] = True; item['exclusiveReadOnlyOpen'] = {'available': False}; continue
        fd = None
        try:
            fd = os.open(item['path'], os.O_RDONLY | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC)
            item['exclusiveReadOnlyOpen'] = {'available': True, 'opened': stat.S_ISBLK(os.fstat(fd).st_mode)}
        except OSError as error:
            item['exclusiveReadOnlyOpen'] = {'available': True, 'opened': False, 'errno': error.errno}
        finally:
            if fd is not None: os.close(fd)
    return result

class Broker:
    def __init__(self, digests, rundir=RUNDIR, read_only=False):
        self.rundir = rundir
        self.read_only = read_only
        self.expected_image = (digests/'image').read_text().strip()
        self.expected_raw = (digests/'raw').read_text().strip()
        self.raw_bytes = int((digests/'bytes').read_text())
        if not all(len(x)==64 and all(c in '0123456789abcdef' for c in x) for x in [self.expected_image,self.expected_raw]) or not 0 < self.raw_bytes <= 128*1024**3: raise Refused('invalid-pinned-digests')
        self.lock = threading.RLock(); self.cancel = threading.Event(); self.selected = None; self.ticket = None
        self.state = {'phase':'idle','done':0,'total':0,'writeStarted':False,'message':('LAN 診断モードです。書込みはできません。' if read_only else 'USB から起動中です。保存先はまだ選択していません。')}
        self.started = time.monotonic(); self.last_saved = 0
        old = rundir/'state.json'
        if old.exists():
            previous=json.loads(old.read_text())
            if previous.get('phase')=='failed':
                self.state=previous
            elif previous.get('writeStarted') and previous.get('phase') != 'complete':
                self.state={'phase':'failed','writeStarted':True,'done':0,'total':0,'message':'前の処理が途中で停止しました。保存先は一部変更された可能性があります。','error':'interrupted-write'}
    def snapshot(self):
        with self.lock: return {**self.state,'readOnly':self.read_only,'elapsed':int(time.monotonic()-self.started),'lastUpdateAgo':int(time.monotonic()-self.state.get('updated',self.started))}
    def update(self, **fields):
        with self.lock:
            self.state.update(fields); self.state['updated']=time.monotonic()
            if time.monotonic()-self.last_saved > 2 or 'phase' in fields:
                target=self.rundir/'state.json'; temp=self.rundir/'state.new'
                with temp.open('w') as out:
                    os.fchmod(out.fileno(),0o600); json.dump(self.state,out);out.flush();os.fsync(out.fileno())
                temp.replace(target); self.last_saved=time.monotonic()
    def busy(self): return self.state['phase'] in ('verify','write','readback','boot')
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
        operation='install-lock'
        try:
            with LOCK.open('a') as lock:
                try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError: raise Refused('another-installer-active')
                operation='source-check'
                if SOURCE.is_symlink() or not SOURCE.is_file() or command(['findmnt','-n','-o','FSTYPE','--target',str(SOURCE)]) != 'iso9660': raise Refused('offline-source')
                if 'ro' not in command(['findmnt','-n','-o','OPTIONS','--target',str(SOURCE)]).split(','): raise Refused('source-not-read-only')
                operation='source-open'
                source_fd=os.open(SOURCE,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
                with os.fdopen(source_fd,'rb') as source:
                    size=os.fstat(source.fileno()).st_size
                    if not 0 < size <= 8*1024**3: raise Refused('source-bound')
                    h=hashlib.sha256();done=0;self.update(total=size)
                    operation='source-read'
                    while chunk:=source.read(CHUNK):
                        if self.cancel.is_set(): raise Cancelled()
                        h.update(chunk);done+=len(chunk);self.update(done=done)
                if h.hexdigest()!=self.expected_image: raise Refused('image-digest-mismatch')
                operation='uefi-preflight'
                boot_check()
                operation='target-admission'
                current=admit(inventory(),row['id'],self.raw_bytes)
                operation='target-open'
                fd=os.open(current['path'],os.O_RDWR|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC)
                operation='target-identity'
                info=os.fstat(fd)
                if not stat.S_ISBLK(info.st_mode) or info.st_rdev!=row['rdev']: raise Refused('target-changed')
                operation='target-sector-size'
                if struct.unpack('I',fcntl.ioctl(fd,0x1268,struct.pack('I',0)))[0]!=512: raise Refused('unsupported-logical-sector-size')
                admit(inventory(),row['id'],self.raw_bytes)
                with self.lock:
                    if self.cancel.is_set(): raise Cancelled()
                    self.update(phase='write',done=0,total=self.raw_bytes,writeStarted=True,message='保存先を変更しています。電源と USB は接続したままにしてください。')
                # Operate on the already-admitted open device, never reopen a hotplug path.
                operation='target-erase'
                subprocess.run(['sgdisk','--zap-all',f'/proc/self/fd/{fd}'],pass_fds=(fd,),check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
                os.lseek(fd,0,os.SEEK_SET)
                operation='decode-start'
                process=subprocess.Popen(['zstd','-dc','--',str(SOURCE)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
                done=0
                while True:
                    operation='decode-read'
                    chunk=process.stdout.read(CHUNK)
                    if not chunk: break
                    if done+len(chunk)>self.raw_bytes: raise Refused('raw-size-overflow')
                    view=memoryview(chunk)
                    operation='target-write'
                    while view:
                        count=os.write(fd,view)
                        if count<=0: raise OSError('short write')
                        view=view[count:]
                        done+=count;self.update(done=done)
                operation='decode-finish'
                if process.wait()!=0 or done!=self.raw_bytes: raise Refused('raw-size-or-decode')
                operation='target-sync'
                os.fsync(fd)
                operation='target-cache-flush'
                fcntl.ioctl(fd,0x1261) # BLKFLSBUF, fixed Linux block-device ABI.
                operation='target-rewind'
                os.lseek(fd,0,os.SEEK_SET)
                self.update(phase='readback',done=0,total=self.raw_bytes,message='NVMe から全長を読み戻して照合しています。')
                h=hashlib.sha256();done=0
                operation='target-readback'
                while done<self.raw_bytes:
                    chunk=os.read(fd,min(CHUNK,self.raw_bytes-done))
                    if not chunk: raise Refused('readback-short')
                    h.update(chunk);done+=len(chunk);self.update(done=done)
                if h.hexdigest()!=self.expected_raw: raise Refused('raw-digest-mismatch')
                self.update(phase='boot',message='照合済みの NVMe を UEFI 起動一覧に登録しています。')
                operation='uefi-register'
                registered=subprocess.run(['otehon-install-boot','register',str(fd)],pass_fds=(fd,),check=True,capture_output=True,text=True,timeout=45)
                entry=json.loads(registered.stdout)
                self.update(phase='complete',done=done,sha256=h.hexdigest(),bootEntry=entry['bootEntry'],bootNumber=entry['bootNumber'],message='NVMe への書込み・全長照合・Awai Otehon の起動登録が完了しました。')
        except Cancelled:
            self.update(phase='cancelled',message='この試行では保存先に書き込まずに中止しました。')
        except Exception as error:
            diagnostic=failure_diagnostic(error,operation,self.state)
            message=('OS データの書込みと照合は済みましたが、UEFI 起動登録に失敗しました。導入完了ではありません。' if self.state.get('phase')=='boot' else '書込みと照合を完了できませんでした。') if self.state.get('writeStarted') else '書込み前の確認に失敗しました。保存先は変更していません。'
            detail=str(error) if isinstance(error,Refused) else type(error).__name__
            if isinstance(error,OSError):
                detail=operation+': '+type(error).__name__+': '+diagnostic['errnoName']+' ('+str(diagnostic['errno'])+') '+diagnostic['detail']
            if self.state.get('phase')=='boot' and isinstance(error,subprocess.CalledProcessError):
                detail += ': '+str(error.stderr or '')[:1800]
                print(detail,file=sys.stderr,flush=True)
            print(json.dumps({'installerFailure':diagnostic},ensure_ascii=True),file=sys.stderr,flush=True)
            self.update(phase='failed',error=detail,message=message,diagnostic=diagnostic)
        finally:
            if process and process.poll() is None:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill();process.wait(timeout=10)
            if fd is not None: os.close(fd)
    def dispatch(self,op,args):
        # Diagnostic boots must never turn a remote observer into a writer.
        # Reject before target selection, process creation, or power controls.
        if self.read_only and op not in ('LIST', 'STATUS', 'INSPECT'):
            raise Refused('diagnostic-read-only')
        if op=='LIST': return {'devices':inventory(),'rawBytes':self.raw_bytes,'state':self.snapshot()}
        if op=='STATUS': return self.snapshot()
        if op=='INSPECT':
            if args: raise Refused('fixed-inspection-operation')
            if self.busy(): return {'available': False, 'readOnly': True, 'reason': 'install-in-progress'}
            rows = [r for r in inventory() if not r['readOnly'] and r['size'] > self.raw_bytes]
            return device_usage(rows)
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

def send_response(connection, response, as_json=False):
    # A disappeared/timed-out GUI must not terminate the service and its active
    # write thread. The root-owned job continues independently of its observer.
    try:
        connection.sendall(((json.dumps(response, ensure_ascii=False) if as_json else edn(response))+'\n').encode())
        return True
    except OSError:
        return False

def serve():
    if os.geteuid()!=0: raise Refused('root-service-required')
    user=pwd.getpwnam('otehon-installer')
    RUNDIR.mkdir(mode=0o750,exist_ok=True);os.chown(RUNDIR,0,user.pw_gid);os.chmod(RUNDIR,0o750)
    debug_mode = os.environ.get('OTEHON_DIAGNOSTIC_READ_ONLY', '0')
    if debug_mode not in ('0', '1'): raise Refused('invalid-diagnostic-mode')
    broker=Broker(Path(os.environ['DIGESTS']), read_only=(debug_mode == '1'))
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
                as_json=False
                try:
                    with connection.makefile('rb') as stream: request=stream.readline(4098)
                    as_json=request.startswith(b'JSON\t')
                    op,args=decode(request[5:] if as_json else request)
                    response={'ok':True,'value':broker.dispatch(op,args)}
                except Exception as error: response={'ok':False,'error':str(error) if isinstance(error,Refused) else type(error).__name__}
                send_response(connection,response,as_json)

if __name__=='__main__': serve()
