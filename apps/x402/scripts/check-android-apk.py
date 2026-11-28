#!/usr/bin/env python3
"""Read back the x402 release APK before handoff to signing or Store QA."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import tempfile
import zipfile

PACKAGE = 'network.itonami.x402'
MAX_APK_BYTES = 64 * 1024 * 1024
PAGE_SIZE = 16 * 1024
ABI_MACHINES = {'arm64-v8a': 'AArch64', 'x86_64': 'Advanced Micro Devices X86-64'}


def read_tool(*args):
    return subprocess.check_output(args, text=True, env={**os.environ, 'LC_ALL': 'C'})


def verify(apk, sdk):
    size = apk.stat().st_size
    if not 0 < size <= MAX_APK_BYTES:
        raise ValueError('APK exceeds the Store byte budget or is empty')

    tools = sdk / 'build-tools/36.1.0'
    host = {'Darwin': 'darwin-x86_64', 'Linux': 'linux-x86_64'}.get(platform.system())
    if host is None:
        raise ValueError('the Android APK checker uses the macOS or Linux NDK')
    readelf = sdk / 'ndk/27.0.12077973/toolchains/llvm/prebuilt' / host / 'bin/llvm-readelf'

    badging = read_tool(tools / 'aapt2', 'dump', 'badging', apk)
    package = re.search(r"^package: name='([^']+)' versionCode='([1-9][0-9]*)'", badging, re.M)
    if not package or package[1] != PACKAGE:
        raise ValueError('unexpected package ID or version code')
    if 'application-debuggable' in badging:
        raise ValueError('a debuggable APK cannot be a release candidate')
    permissions = read_tool(tools / 'aapt2', 'dump', 'permissions', apk)
    if re.search(r"name='android\.permission\.INTERNET'", permissions):
        raise ValueError('the local drafts app requests INTERNET')
    manifest = read_tool(tools / 'aapt2', 'dump', 'xmltree', apk, '--file', 'AndroidManifest.xml')
    if not re.search(r':usesCleartextTraffic\(0x[0-9a-f]+\)=false\s*$', manifest, re.M):
        raise ValueError('release manifest must explicitly disable cleartext')
    read_tool(tools / 'zipalign', '-c', '-P', '16', '4', apk)

    with zipfile.ZipFile(apk) as bundle, tempfile.TemporaryDirectory() as scratch:
        entries = [name for name in bundle.namelist() if name.startswith('lib/') and name.endswith('.so')]
        if len(entries) != len(set(entries)):
            raise ValueError('duplicate native libraries')
        if {name.split('/')[1] for name in entries} != set(ABI_MACHINES):
            raise ValueError('expected exactly arm64-v8a and x86_64 native libraries')
        for abi in ABI_MACHINES:
            if f'lib/{abi}/libx402_lib.so' not in entries:
                raise ValueError(f'missing x402 library for {abi}')
        unpacked = Path(scratch) / 'library.so'
        for name in entries:
            unpacked.write_bytes(bundle.read(name))
            elf = read_tool(readelf, '--wide', '--file-header', '--program-headers', unpacked)
            abi = name.split('/')[1]
            machine = re.search(r'^\s*Machine:\s*(.*?)\s*$', elf, re.M)
            loads = [line.split() for line in elf.splitlines() if line.lstrip().startswith('LOAD ')]
            if not machine or machine[1] != ABI_MACHINES[abi] or not loads:
                raise ValueError(f'invalid ELF for {name}')
            for segment in loads:
                offset, address = int(segment[1], 16), int(segment[2], 16)
                if int(segment[-1], 16) < PAGE_SIZE or address % PAGE_SIZE != offset % PAGE_SIZE:
                    raise ValueError(f'LOAD segment is not 16 KiB aligned in {name}')

    return {'package': PACKAGE, 'versionCode': int(package[2]), 'bytes': size,
            'sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'abis': sorted(ABI_MACHINES),
            'nativeLibraries': len(entries), 'pageAlignmentBytes': PAGE_SIZE}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    sdk = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    parser.add_argument('--sdk', type=Path, default=Path(sdk) if sdk else Path.home() / 'Library/Android/sdk')
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.apk, args.sdk), indent=2))
    except (OSError, ValueError, subprocess.CalledProcessError, zipfile.BadZipFile) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
