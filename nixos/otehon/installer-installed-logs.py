"""Fixed offline boot-journal reader. Run in a private mount namespace.

No client arguments, passwords, arbitrary paths, repairs or writable mounts.
Only a unique, unused ext4 otehon-root partition is eligible. Encrypted user
state is never opened. Missing persistent logs are reported as missing.
"""
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import sys
import tempfile
import time

LIMIT = 49152
UNITS = ('otehon-state.service', 'greetd.service', 'nginx.service',
         'systemd-logind.service', 'user@1000.service', 'otehon-boot-report.service')


def bounded(args, limit=LIMIT, timeout=8):
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    data = bytearray()
    end = time.monotonic() + timeout
    truncated = False
    try:
        selector.register(process.stdout, selectors.EVENT_READ)
        while True:
            remaining = end - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise TimeoutError('journal-time-bound')
            chunk = os.read(process.stdout.fileno(), min(8192, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > limit:
                truncated = True
                process.kill()
                break
        status = process.wait(timeout=max(.1, end-time.monotonic()))
        if status and not truncated:
            raise ValueError('command-failed')
        return bytes(data[:limit]).decode('utf-8', 'replace'), truncated
    finally:
        selector.close()
        if process.poll() is None:
            process.kill()
            process.wait()
        process.stdout.close()


def target_from_tree(tree):
    candidates = []
    count = 0

    def walk(rows, disk=None):
        nonlocal count
        for row in rows:
            count += 1
            if count > 128:
                raise ValueError('inventory-bound')
            parent = row if row.get('type') == 'disk' else disk
            if row.get('partlabel') == 'otehon-root':
                if (row.get('type') != 'part' or row.get('fstype') != 'ext4' or not parent
                    or parent.get('tran') == 'usb'
                    or not re.fullmatch(r'/dev/(?:nvme[0-9]+n[0-9]+p[0-9]+|vd[a-z][0-9]+)', row.get('path', ''))
                    or not re.fullmatch(r'[0-9]+:[0-9]+', row.get('maj:min', ''))):
                    raise ValueError('ineligible-root')
                candidates.append(row)
            walk(row.get('children', []), parent)
    walk(tree.get('blockdevices', []))
    if len(candidates) != 1:
        raise ValueError('root-not-unique' if candidates else 'root-not-found')
    return candidates[0]


def latest_boot(text):
    boots = re.findall(r'^\s*-?[0-9]+\s+([0-9a-f]{32})(?:\s|$)', text, re.MULTILINE)
    if not boots:
        raise ValueError('no-persistent-boots')
    return boots[-1]


def clean_log(text):
    text = re.sub(r'https?://[^\s]+', '<url>', text)
    text = re.sub(r'/home/[^/\s]+', '/home/<user>', text)
    text = re.sub(r'(?i)(token|password|passphrase|authorization|secret)([=: ]+)[^\s]+', r'\1\2<redacted>', text)
    return '\n'.join(''.join(c if c.isprintable() else '?' for c in line)[:600]
                     for line in text.splitlines()[:200])


def read_journal(root):
    directory = root / 'var/log/journal'
    if not directory.is_dir():
        return {'available': False, 'reason': 'no-persistent-journal'}
    if not directory.resolve().is_relative_to(root.resolve()):
        raise ValueError('journal-path-escape')
    base = ['journalctl', '--directory=' + str(directory), '--no-pager']
    listing, truncated = bounded(base + ['--list-boots', '--no-legend'], limit=8192)
    if truncated:
        raise ValueError('boot-list-bound')
    boot = latest_boot(listing)
    args = base + ['--boot=' + boot, '--output=short-monotonic', '--lines=200']
    for unit in UNITS:
        args += ['--unit=' + unit]
    output, truncated = bounded(args, limit=32768)
    kernel, kernel_truncated = bounded(base + ['--boot=' + boot, '--dmesg', '--priority=warning',
                                               '--output=short-monotonic', '--lines=60'], limit=8192)
    return {'available': True, 'bootId': boot, 'units': list(UNITS),
            'text': clean_log(output), 'truncated': truncated,
            'kernelWarnings': clean_log(kernel), 'kernelTruncated': kernel_truncated}


def collect():
    text, truncated = bounded(['lsblk', '-b', '-J', '--tree', '-o',
                              'PATH,TYPE,MAJ:MIN,PARTLABEL,FSTYPE,TRAN'], limit=65536)
    if truncated:
        raise ValueError('inventory-bound')
    row = target_from_tree(json.loads(text))
    path = Path(row['path'])
    info = path.lstat()
    expected = f'{os.major(info.st_rdev)}:{os.minor(info.st_rdev)}'
    if not stat.S_ISBLK(info.st_mode) or expected != row['maj:min']:
        raise ValueError('root-identity-changed')
    mounted, _ = bounded(['findmnt', '-rn', '-o', 'MAJ:MIN'], limit=16384)
    if expected in mounted.splitlines():
        raise ValueError('root-already-mounted')
    # noload prevents ext4 journal replay even on an unclean previous boot.
    # The caller's private mount namespace also cleans up on timeout/kill.
    with tempfile.TemporaryDirectory(prefix='otehon-installed-', dir='/run') as temp:
        root = Path(temp)
        subprocess.run(['mount', '-t', 'ext4', '-o', 'ro,noload,nodev,nosuid,noexec,nosymfollow',
                        str(path), temp], check=True, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=10)
        try:
            observed, _ = bounded(['findmnt', '-rn', '-o', 'MAJ:MIN,OPTIONS', '--target', temp], limit=4096)
            fields = observed.split()
            if len(fields) != 2 or fields[0] != expected or 'ro' not in fields[1].split(','):
                raise ValueError('read-only-mount-not-confirmed')
            return {'rootDevice': str(path), 'majorMinor': expected, 'journal': read_journal(root)}
        finally:
            subprocess.run(['umount', temp], check=True, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10)


def main():
    result = {'schema': 'awai.otehon.installed-boot-journal.v1', 'readOnly': True}
    try:
        if len(sys.argv) != 1:
            raise ValueError('arguments-refused')
        result.update(collect())
        result['available'] = True
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        result.update(available=False, reason=str(error) if isinstance(error, ValueError) else type(error).__name__)
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))


if __name__ == '__main__':
    main()
