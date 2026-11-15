"""Fixed transient kernel metadata trace around read-only exclusive disk probes."""
import json
import itertools
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

MAX_OUTPUT = 16384


def partition_references(devices, proc=Path('/proc')):
    """Correlate retained kernel children with FD/mount metadata, not paths/data."""
    children = [p for d in devices for p in d.get('kernel', {}).get('partitions', [])]
    by_number = {p['majorMinor']: p for p in children}
    if not children: return
    for child in children: child['references'] = []
    namespaces = set(); scanned = 0; fds = 0; truncated = False
    deadline = time.monotonic() + 2
    for process in itertools.islice(proc.iterdir(), 2049):
        if not process.name.isdecimal(): continue
        if scanned >= 2048 or time.monotonic() >= deadline or fds >= 8192:
            truncated = True; break
        scanned += 1
        try:
            with os.scandir(process / 'fd') as entries:
                for index, entry in enumerate(itertools.islice(entries, 129)):
                    if index == 128: truncated = True; break
                    fds += 1
                    if fds >= 8192 or time.monotonic() >= deadline:
                        truncated = True; break
                    try: info = entry.stat()
                    except OSError: continue
                    number = info.st_rdev if stat.S_ISBLK(info.st_mode) else info.st_dev
                    child = by_number.get(str(os.major(number))+':'+str(os.minor(number)))
                    if child is not None and len(child['references']) < 32:
                        child['references'].append({'pid': int(process.name), 'kind': 'block-fd' if stat.S_ISBLK(info.st_mode) else 'file-fd', 'fd': int(entry.name)})
        except OSError: pass
        try:
            namespace = os.readlink(process / 'ns/mnt')
            if namespace in namespaces: continue
            if len(namespaces) >= 64: truncated = True; continue
            namespaces.add(namespace)
            with (process / 'mountinfo').open() as source: data = source.read(262145)
            if len(data) > 262144: truncated = True; continue
            for line in data.splitlines():
                fields = line.split()
                child = by_number.get(fields[2]) if len(fields) > 3 else None
                if child is not None and len(child['references']) < 32:
                    child['references'].append({'pid': int(process.name), 'kind': 'mount-namespace', 'namespace': namespace})
        except OSError: pass
    for device in devices:
        device.setdefault('kernel', {})['referenceScan'] = {'processesScanned': scanned, 'fdsScanned': fds,
            'namespacesScanned': len(namespaces), 'truncated': truncated, 'atomic': False}


def program(pid, devices):
    assert isinstance(pid, int) and pid > 0
    assert devices and len(devices) <= 4 and all(isinstance(n, int) and 0 < n < 2**32 for n in devices)
    source = r'''
BEGIN { printf("READY\n"); }
kprobe:bdev_open /pid == PID_FILTER/ {
  $b = (struct block_device *)arg0;
  if (DEVICE_FILTER) {
    @device[tid] = $b->bd_dev;
    $whole = $b->bd_disk->part0;
    printf("BDEV %u %d %d %d %d %d %u\n", $b->bd_dev,
      $b->bd_holder != 0, $b->bd_holders, $b->bd_openers.counter,
      $b->bd_writers, $whole->bd_holder != 0, arg1);
    if ((uint64)$b->bd_holder_ops == kaddr("fs_holder_ops")) {
      printf("OPS %u fs_holder_ops\n", $b->bd_dev);
      printf("KIND %u filesystem\n", $b->bd_dev);
      if ($b->bd_holder) {
        $sb = (struct super_block *)$b->bd_holder;
        printf("FS %u %s\n", $b->bd_dev, str($sb->s_type->name, 32));
      }
    } else if ($b->bd_holder_ops) {
      printf("OPS %u other\n", $b->bd_dev);
      if ($b->bd_holder_ops->mark_dead) {
        printf("CALLBACK %u %s\n", $b->bd_dev, ksym((uint64)$b->bd_holder_ops->mark_dead));
      }
    } else {
      printf("OPS %u none\n", $b->bd_dev);
      if ($b->bd_holder) {
        if ((uint64)$b->bd_holder == kaddr("bd_may_claim")) {
          printf("KIND %u partition-claim\n", $b->bd_dev);
        } else {
          $file = (struct file *)$b->bd_holder;
          if ((uint64)$file->f_op == kaddr("def_blk_fops")) {
            printf("KIND %u block-file\n", $b->bd_dev);
            printf("FILE %u %u %u\n", $b->bd_dev, $file->f_flags, $file->f_cred->uid.val);
          } else { printf("KIND %u unknown\n", $b->bd_dev); }
        }
      }
    }
    // Sysfs can omit an unhashed/deleted partition whose inode is still held.
    // Walk the bdev pseudo-filesystem's inode list, not the visible part_tbl.
    // This is an unlocked, bounded metadata snapshot, never a release action.
    $head = (struct list_head *)((uint64)$b->bd_mapping->host->i_sb + offsetof(struct super_block, s_inodes));
    $link = $head->next;
    $scanned = 0;
    $matched = 0;
    while ((uint64)$link != 0 && (uint64)$link != (uint64)$head && $scanned < 512 && $matched < 32) {
      $inode = (struct inode *)((uint64)$link - offsetof(struct inode, i_sb_list));
      $child = (struct block_device *)((uint64)$inode - offsetof(struct bdev_inode, vfs_inode));
      if ($child->bd_disk == $b->bd_disk && ($child->__bd_flags.counter & 255)) {
        $matched++;
        printf("PART %u %u %u %d %d %d %d\n", $b->bd_dev, $child->bd_dev,
          $child->__bd_flags.counter & 255, $child->bd_holders,
          $child->bd_openers.counter, $child->bd_writers, $inode->i_count.counter);
        if ((uint64)$child->bd_holder_ops == kaddr("fs_holder_ops") && (uint64)$child->bd_holder != 0) {
          $sb = (struct super_block *)$child->bd_holder;
          printf("PARTFS %u %u %s\n", $b->bd_dev, $child->bd_dev, str($sb->s_type->name, 32));
        } else if ((uint64)$child->bd_holder_ops == 0 && (uint64)$child->bd_holder != 0 &&
                   (uint64)$child->bd_holder != kaddr("bd_may_claim")) {
          $file = (struct file *)$child->bd_holder;
          if ((uint64)$file->f_op == kaddr("def_blk_fops")) {
            printf("PARTFILE %u %u %u %u\n", $b->bd_dev, $child->bd_dev,
              $file->f_flags, $file->f_cred->uid.val);
          }
        } else if ((uint64)$child->bd_holder_ops != 0 && (uint64)$child->bd_holder_ops->mark_dead != 0) {
          printf("PARTCALLBACK %u %u %s\n", $b->bd_dev, $child->bd_dev,
            ksym((uint64)$child->bd_holder_ops->mark_dead));
        }
      }
      $link = $link->next;
      $scanned++;
    }
    printf("SCAN %u %u %u %d %u\n", $b->bd_dev, $scanned, $matched,
      (uint64)$link != 0 && (uint64)$link != (uint64)$head, $b->bd_disk->open_partitions);
  }
}
kretprobe:bdev_open /pid == PID_FILTER && @device[tid]/ {
  printf("RETURN %u %d\n", @device[tid], (int32)retval);
  delete(@device[tid]);
}
interval:s:2 { exit(); }
'''
    return source.replace('PID_FILTER', str(pid)).replace('DEVICE_FILTER', ' || '.join('$b->bd_dev == ' + str(n) for n in devices))


def parse(output, devices):
    for line in output.splitlines():
        fields = line.split()
        if len(fields) < 3 or not fields[1].isdecimal(): continue
        item = devices.get(int(fields[1]))
        if item is None: continue
        if fields[0] == 'BDEV' and len(fields) == 8:
            try: values = [int(n) for n in fields[2:]]
            except ValueError: continue
            item['kernel'] = dict(zip(('hasHolder', 'holders', 'openers', 'writers', 'wholeHasHolder', 'openMode'), values))
        elif fields[0] in ('OPS', 'FS', 'KIND', 'CALLBACK') and len(fields) == 3:
            value = fields[2] if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,95}', fields[2]) else 'unknown'
            item.setdefault('kernel', {})[{'OPS':'holderOps','FS':'fileSystem','KIND':'holderKind','CALLBACK':'markDeadCallback'}[fields[0]]] = value
        elif fields[0] == 'FILE' and len(fields) == 4:
            try: item.setdefault('kernel', {}).update(holderFileFlags=int(fields[2]), holderUid=int(fields[3]))
            except ValueError: pass
        elif fields[0] == 'RETURN' and len(fields) == 3:
            try: item.setdefault('kernel', {})['returnCode'] = int(fields[2])
            except ValueError: pass
        elif fields[0] == 'PART' and len(fields) == 8:
            try: number, partno, holders, openers, writers, refs = map(int, fields[2:])
            except ValueError: continue
            if not 0 < number < 2**32 or not 1 <= partno <= 255: continue
            children = item.setdefault('kernel', {}).setdefault('partitions', [])
            if len(children) >= 32 or any(p['deviceNumber'] == number for p in children): continue
            children.append({'deviceNumber': number, 'majorMinor': str(number >> 20)+':'+str(number & (2**20-1)),
                             'partitionNumber': partno, 'holders': holders, 'openers': openers,
                             'writers': writers, 'inodeReferences': refs})
        elif fields[0] in ('PARTFS', 'PARTFILE', 'PARTCALLBACK'):
            if len(fields) not in (4, 5) or not fields[2].isdecimal(): continue
            child = next((p for p in item.get('kernel', {}).get('partitions', []) if p['deviceNumber'] == int(fields[2])), None)
            if child is None: continue
            if fields[0] == 'PARTFILE' and len(fields) == 5:
                try: child.update(holderKind='block-file', holderFileFlags=int(fields[3]), holderUid=int(fields[4]))
                except ValueError: pass
            elif len(fields) == 4:
                value = fields[3] if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,95}', fields[3]) else 'unknown'
                if fields[0] == 'PARTFS': child.update(holderKind='filesystem', fileSystem=value)
                else: child.update(holderKind='other', markDeadCallback=value)
        elif fields[0] == 'SCAN' and len(fields) == 6:
            try: scanned, matched, truncated, opened = map(int, fields[2:])
            except ValueError: continue
            item.setdefault('kernel', {})['partitionScan'] = {'inodesScanned': scanned, 'partitionsMatched': matched,
                'truncated': bool(truncated), 'openPartitions': opened, 'atomic': False}


def inspect(rows, tracer='bpftrace'):
    result = {'available': False, 'readOnly': True, 'transientKernelTrace': True,
              'kernelRelease': os.uname().release, 'devices': []}
    if not rows or len(rows) > 4:
        return {**result, 'reason': 'target-count-bound'}
    by_device = {}
    for row in rows:
        if not re.fullmatch(r'/dev/(?:nvme[0-9]+n[0-9]+|sd[a-z]+|vd[a-z]+)', row['path']):
            return {**result, 'reason': 'unsupported-target'}
        major, minor = map(int, row['majorMinor'].split(':'))
        number = (major << 20) | minor
        if not 0 < major < 4096 or not 0 <= minor < 2**20 or number in by_device:
            return {**result, 'reason': 'invalid-device-identity'}
        item = {key: row[key] for key in ('id', 'path', 'majorMinor')}
        by_device[number] = item; result['devices'].append(item)
    process = None
    captured = bytearray()
    try:
        process = subprocess.Popen([tracer, '-q', '-B', 'line', '-e', program(os.getpid(), list(by_device))],
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            deadline = time.monotonic() + 15
            while b'READY\n' not in captured:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not selector.select(remaining): raise TimeoutError('tracer startup')
                block = os.read(process.stdout.fileno(), 4096)
                if not block: raise RuntimeError('tracer exited before ready')
                captured.extend(block)
                if len(captured) > MAX_OUTPUT: raise RuntimeError('tracer output bound')
        for row, item in zip(rows, result['devices']):
            fd = None
            try:
                fd = os.open(row['path'], os.O_RDONLY | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC)
                info = os.fstat(fd)
                item['probe'] = {'opened': stat.S_ISBLK(info.st_mode) and info.st_rdev == row['rdev']}
            except OSError as error: item['probe'] = {'opened': False, 'errno': error.errno}
            finally:
                if fd is not None: os.close(fd)
        tail, _ = process.communicate(timeout=5)
        captured.extend(tail)
        if process.returncode or len(captured) > MAX_OUTPUT: raise RuntimeError('tracer completion')
        parse(captured.decode('utf-8', 'replace'), by_device)
        partition_references(result['devices'])
        result['available'] = all('returnCode' in item.get('kernel', {}) for item in result['devices'])
        if not result['available']: result['reason'] = 'no-matching-kernel-event'
    except (OSError, RuntimeError, TimeoutError, subprocess.SubprocessError) as error:
        result['reason'] = type(error).__name__
        # Only this fixed program's diagnostics; never return kernel addresses.
        result['tracerDiagnostic'] = re.sub(r'0x[0-9a-fA-F]+', '<address>', captured.decode('utf-8', 'replace'))[-1600:]
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=2)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
        if process is not None and process.stdout is not None: process.stdout.close()
    return result


if __name__ == '__main__':
    if os.geteuid() != 0: sys.exit(64)
    data = sys.stdin.buffer.read(16385)
    if len(data) > 16384: sys.exit(64)
    print(json.dumps(inspect(json.loads(data))))
