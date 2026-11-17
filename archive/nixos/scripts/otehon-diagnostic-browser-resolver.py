#!/usr/bin/env python3
"""Inspect/repair DNS only in the explicitly created RAM desktop diagnostic.

Never repairs a normal installed root or opens user state. No resolver addresses,
search domains, browser inputs or credentials are printed.
"""
import argparse
import json
import os
import re
import stat
import time
from pathlib import Path


def ram_overlay(mountinfo):
    roots = []
    for line in mountinfo.splitlines():
        left, separator, right = line.partition(' - ')
        fields = left.split()
        if separator and len(fields) >= 6 and fields[4] == '/':
            roots.append(right)
    return len(roots) == 1 and roots[0].startswith('overlay ') and bool(re.search(
        r'(?:^|,)upperdir=/run/awai-ram-desktop-test-[A-Za-z0-9-]+/upper(?:,|$)', roots[0]))


def nameservers(data):
    return sum(line.split()[:1] == [b'nameserver'] for line in data.splitlines())


def inspect(pid, repair):
    if pid < 2:
        raise SystemExit('invalid diagnostic PID')
    proc = Path('/proc') / str(pid)
    root = proc / 'root'
    host = Path('/etc/resolv.conf').read_bytes()
    if len(host) > 16384:
        raise SystemExit('resolver configuration exceeds bound')
    browser = (root / 'etc/resolv.conf').read_bytes()
    allowed = ram_overlay((proc / 'mountinfo').read_text()) and (proc / 'comm').read_text().strip() == 'cosmic-comp'
    changed = False
    if repair and browser != host:
        if os.geteuid() != 0 or not allowed or not nameservers(host):
            raise SystemExit('refusing resolver repair outside approved RAM overlay')
        child = os.fork()
        if child == 0:
            try:
                os.chroot(root)
                os.chdir('/')
                # Absolute links stay within the target root. Reject a final
                # symlink and special file rather than writing through either.
                fd = os.open('/etc/resolv.conf', os.O_WRONLY | os.O_NOFOLLOW)
                if not stat.S_ISREG(os.fstat(fd).st_mode):
                    os._exit(2)
                os.ftruncate(fd, 0)
                with os.fdopen(fd, 'wb') as output:
                    output.write(host)
                    output.flush()
                    os.fsync(output.fileno())
                os._exit(0)
            except Exception:
                os._exit(2)
        _, status = os.waitpid(child, 0)
        if status != 0:
            raise SystemExit('RAM resolver repair failed')
        browser = (root / 'etc/resolv.conf').read_bytes()
        changed = True
    return {'schema':'awai.otehon.diagnostic-resolver.v1',
                      'hostNameServers':nameservers(host), 'browserNameServers':nameservers(browser),
                      'same':browser == host, 'ramRepairAllowed':allowed, 'changed':changed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', required=True, type=int)
    parser.add_argument('--repair-ram', action='store_true')
    parser.add_argument('--watch-seconds', type=int, default=0)
    args = parser.parse_args()
    if not 0 <= args.watch_seconds <= 1800:
        raise SystemExit('watch bound is 0..1800 seconds')
    deadline = time.monotonic() + args.watch_seconds
    previous = None
    while True:
        try:
            result = inspect(args.pid, args.repair_ram)
        except FileNotFoundError:
            raise SystemExit('diagnostic process unavailable')
        if result != previous:
            print(json.dumps(result), flush=True)
            previous = result
        if time.monotonic() >= deadline:
            break
        time.sleep(min(5, max(0, deadline - time.monotonic())))


if __name__ == '__main__': main()
