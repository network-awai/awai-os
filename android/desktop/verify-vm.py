#!/usr/bin/env python3
"""Inspect an explicit Android VM, optionally install this task's verified APKs.

Never partitions, formats, selects a physical device, or changes its HOME role.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess


def admit(props):
    if props.get('ro.kernel.qemu') != '1':
        raise ValueError('refusing a non-emulator device')
    if int(props.get('ro.build.version.sdk', '0')) < 35:
        raise ValueError('Android API 35 or later required')
    if 'x86_64' not in props.get('ro.product.cpu.abilist', '').split(','):
        raise ValueError('x86_64 VM required; ARM emulation is a different claim')
    if props.get('sys.boot_completed') != '1':
        raise ValueError('VM boot is not complete')


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--adb', default='adb')
    ap.add_argument('--serial', required=True)
    ap.add_argument('--build-report', type=pathlib.Path)
    ap.add_argument('--install', action='store_true')
    args = ap.parse_args()

    def adb(*cmd):
        return subprocess.check_output(
            [args.adb, '-s', args.serial, *cmd], text=True, timeout=120).strip()

    props = {key: adb('shell', 'getprop', key) for key in (
        'ro.kernel.qemu', 'ro.build.version.sdk', 'ro.product.cpu.abilist',
        'sys.boot_completed', 'ro.build.fingerprint')}
    admit(props)
    evidence = {'schema': 'awai.android.desktop-vm.v1', 'properties': props,
                'installed': [], 'physicalBoot': 'unverified', 'lanBoot': 'unverified'}
    if args.install:
        if not args.build_report:
            raise ValueError('--install requires --build-report')
        report = json.loads(args.build_report.read_text())
        # Validate every APK before any installation. Never follow report paths.
        apks = []
        for kind in ('yotei', 'store', 'home'):
            name = f'{kind}-v{report["version"]}.apk'
            path = args.build_report.parent / name
            data = path.read_bytes()
            artifact = report['artifacts'][name]
            if len(data) != artifact['bytes'] or hashlib.sha256(data).hexdigest() != artifact['sha256']:
                raise ValueError(f'artifact mismatch: {name}')
            apks.append(path)
        for path in apks:
            result = adb('install', '-r', str(path))
            if 'Success' not in result:
                raise RuntimeError(f'install failed: {path.name}')
            evidence['installed'].append(path.name)
    print(json.dumps(evidence, indent=2))


if __name__ == '__main__':
    main()
