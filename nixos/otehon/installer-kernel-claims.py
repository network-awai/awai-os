"""Fixed transient kernel metadata trace around read-only exclusive disk probes."""
import json
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
    if ($b->bd_holder_ops) {
      printf("OPS %u %s\n", $b->bd_dev, ksym((uint64)$b->bd_holder_ops));
    } else { printf("OPS %u none\n", $b->bd_dev); }
    if ($b->bd_holder && (uint64)$b->bd_holder_ops == kaddr("fs_holder_ops")) {
      $sb = (struct super_block *)$b->bd_holder;
      printf("FS %u %s\n", $b->bd_dev, str($sb->s_type->name, 32));
    }
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
        elif fields[0] in ('OPS', 'FS') and len(fields) == 3:
            value = fields[2] if re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.-]{0,95}', fields[2]) else 'unknown'
            item.setdefault('kernel', {})['holderOps' if fields[0] == 'OPS' else 'fileSystem'] = value
        elif fields[0] == 'RETURN' and len(fields) == 3:
            try: item.setdefault('kernel', {})['returnCode'] = int(fields[2])
            except ValueError: pass


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
