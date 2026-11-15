#!/usr/bin/env python3
"""Serve only a source-pinned, independently hash-checked LAN boot candidate."""
import argparse
import functools
import hashlib
import http.server
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

FILES = ('ipxe.efi', 'kernel', 'initrd', 'installer-info.json')


def validate(directory, expected_revision, vm_proof):
    if not re.fullmatch(r'[0-9a-f]{40}', expected_revision):
        raise ValueError('invalid source revision')
    if (directory / 'SOURCE_REVISION').read_text().strip() != expected_revision:
        raise ValueError('source revision mismatch')
    lines = (directory / 'SHA256SUMS').read_text().splitlines()
    expected = {}
    for line in lines:
        match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_.-]+)', line)
        if not match or match.group(2) not in FILES or match.group(2) in expected:
            raise ValueError('invalid checksum manifest')
        expected[match.group(2)] = match.group(1)
    if set(expected) != set(FILES):
        raise ValueError('incomplete checksum manifest')
    proof = json.loads(vm_proof.read_text())
    schema = proof.get('schema')
    if schema not in ('awai.otehon.netboot-vm.v1', 'awai.otehon.lan-install-vm.v1') or proof.get('passed') is not True or proof.get('physicalDisks') is not False or proof.get('sourceRevision') != expected_revision:
        raise ValueError('matching successful VM proof required')
    checked_files = FILES if schema == 'awai.otehon.lan-install-vm.v1' else ('ipxe.efi', 'kernel', 'initrd')
    if proof.get('artifacts') != {name: expected[name] for name in checked_files}:
        raise ValueError('VM checked different boot artifacts')
    for name in FILES:
        path = directory / name
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024**3:
            raise ValueError('invalid boot artifact')
        digest = hashlib.sha256()
        with path.open('rb') as source:
            while block := source.read(1024 * 1024):
                digest.update(block)
        if digest.hexdigest() != expected[name]:
            raise ValueError('boot artifact digest mismatch')


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path not in ('/ipxe.efi', '/kernel', '/initrd'):
            self.send_error(404)
            return
        return super().do_GET()

    def do_HEAD(self):
        if urlsplit(self.path).path not in ('/ipxe.efi', '/kernel', '/initrd'):
            self.send_error(404)
            return
        return super().do_HEAD()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--expected-revision', required=True)
    parser.add_argument('--vm-proof', type=Path, required=True)
    args = parser.parse_args()
    directory = args.directory.resolve(strict=True)
    validate(directory, args.expected_revision, args.vm_proof)
    handler = functools.partial(Handler, directory=str(directory))
    with http.server.ThreadingHTTPServer(('10.77.0.1', 8080), handler) as server:
        print('LAN boot HTTP: 10.77.0.1:8080', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()
