#!/usr/bin/env python3
"""Read-only verification of a concatenated PC evaluation ISO, not ROM admission."""
import argparse
import hashlib
import json
import os
import pathlib
import stat


def verify(path, pins):
    # Refuse disk devices, FIFOs and symlinks; this tool never writes the image.
    if not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError('image must be a regular non-symlink file')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError('image must be a regular non-symlink file')
        whole = hashlib.sha256()
        total = 0
        for part in pins['parts']:
            remaining = part['size']
            digest = hashlib.sha256()
            while remaining:
                block = stream.read(min(1024 * 1024, remaining))
                if not block:
                    raise ValueError('truncated part: ' + part['name'])
                remaining -= len(block)
                total += len(block)
                digest.update(block)
                whole.update(block)
            if 'sha256:' + digest.hexdigest() != part['digest']:
                raise ValueError('digest mismatch: ' + part['name'])
        if stream.read(1):
            raise ValueError('unexpected trailing data')
    return {'schema': 'awai.android.pc-image-check.v1', 'bytes': total,
            'sha256': whole.hexdigest(), 'partsVerified': len(pins['parts']),
            'sourceClosureVerified': False, 'productionQualified': False,
            'physicalBootQualified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', type=pathlib.Path)
    parser.add_argument('--pins', type=pathlib.Path,
                        default=pathlib.Path(__file__).with_name('pc-evaluation-pins.json'))
    args = parser.parse_args()
    print(json.dumps(verify(args.image, json.loads(args.pins.read_text())), indent=2))
