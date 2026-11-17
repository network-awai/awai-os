#!/usr/bin/env python3
"""Export a verified installer ISO as a read-only network block device."""
import argparse
import hashlib
from pathlib import Path
import re
import subprocess


def command(iso, digest, size, bind, port):
    if bind not in ('127.0.0.1', '10.77.0.1') or not 1024 <= port <= 65535:
        raise ValueError('unsupported endpoint')
    if not re.fullmatch('[0-9a-f]{64}', digest) or size <= 0:
        raise ValueError('invalid pinned identity')
    if iso.is_symlink() or not iso.is_file() or iso.stat().st_size != size:
        raise ValueError('ISO size or file type mismatch')
    h = hashlib.sha256()
    with iso.open('rb') as stream:
        while block := stream.read(1024 * 1024): h.update(block)
    if h.hexdigest() != digest:
        raise ValueError('ISO digest mismatch')
    return ['qemu-nbd', '--read-only', '--persistent', '--shared=1',
            '--format=raw', '--bind=' + bind, '--port=' + str(port), str(iso.resolve())]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--iso', type=Path, required=True)
    p.add_argument('--sha256', required=True)
    p.add_argument('--bytes', type=int, required=True)
    p.add_argument('--bind', default='127.0.0.1', choices=['127.0.0.1', '10.77.0.1'])
    p.add_argument('--port', type=int, default=10809)
    a = p.parse_args()
    subprocess.run(command(a.iso, a.sha256, a.bytes, a.bind, a.port), check=True)


if __name__ == '__main__': main()
