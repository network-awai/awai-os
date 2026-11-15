#!/usr/bin/env python3
"""Verify the displayed guest host key before fetching LAN diagnostics."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

HOST = '10.77.0.2'
PORT = '2222'


def check_key(expected, scan, fingerprint):
    if not re.fullmatch(r'SHA256:[A-Za-z0-9+/]{43}', expected):
        raise ValueError('invalid fingerprint')
    if scan.returncode != 0 or not scan.stdout:
        raise ValueError('host key unavailable')
    keys = [line for line in scan.stdout.splitlines() if line and not line.startswith('#')]
    if len(keys) != 1 or not keys[0].startswith('[10.77.0.2]:2222 ssh-ed25519 '):
        raise ValueError('unexpected host key set')
    fingerprints = re.findall(r'SHA256:[A-Za-z0-9+/]{43}', fingerprint.stdout)
    if fingerprint.returncode != 0 or fingerprints != [expected]:
        raise ValueError('host fingerprint mismatch')


def collect(key, expected, output, scratch, installer_observer=False):
    scan = subprocess.run(['ssh-keyscan', '-T', '5', '-t', 'ed25519', '-p', PORT, HOST],
                          capture_output=True, text=True, timeout=10)
    fingerprint = subprocess.run(['ssh-keygen', '-lf', '-', '-E', 'sha256'], input=scan.stdout,
                                 capture_output=True, text=True, timeout=10)
    check_key(expected, scan, fingerprint)
    with tempfile.TemporaryDirectory(prefix='known-host-', dir=scratch) as directory:
        known = Path(directory) / 'known_hosts'
        known.write_text(scan.stdout)
        response = subprocess.run([
            'ssh', '-F', '/dev/null', '-p', PORT, '-i', str(key),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={known}',
            '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=10',
            'otehon-installer@' + HOST,
        ], capture_output=True, text=True, timeout=30)
    if response.returncode != 0 or len(response.stdout) > 1024 * 1024:
        raise ValueError('diagnostics failed or exceeded the response limit')
    result = json.loads(response.stdout)
    if result.get('schema') != 'awai.otehon.installer-diagnostics.v1' or result.get('readOnly') is not True or (not installer_observer and result.get('status', {}).get('readOnly') is not True):
        raise ValueError('unexpected or non-read-only diagnostics')
    # Preserve existing evidence: fail if the destination already exists.
    fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--key', type=Path, required=True)
    parser.add_argument('--fingerprint', required=True, help='SHA256 fingerprint displayed on the 6600H screen')
    parser.add_argument('--output', type=Path, required=True, help='new file for diagnostic evidence')
    parser.add_argument('--scratch', type=Path, required=True, help='existing task-local scratch directory')
    parser.add_argument('--installer-observer', action='store_true', help='observe writable installer through its read-only collector')
    args = parser.parse_args()
    collect(args.key, args.fingerprint, args.output, args.scratch, args.installer_observer)
    print('診断情報を保存しました: ' + str(args.output))


if __name__ == '__main__':
    main()
