"""Read-only, bounded diagnostics for the installer SSH forced command.

This program accepts no commands or paths from the client. Authentication and
host identity are the transport's responsibility; it never grants write access.
"""
import json
import os
from pathlib import Path
import selectors
import socket
import subprocess
import sys
import time

SOCKET = '/run/otehon-install/control.sock'
MAX_RESPONSE = 262144
MAX_LOG = 131072


def broker(op):
    if op not in ('STATUS', 'LIST', 'INSPECT', 'KERNEL_INSPECT', 'INSTALLED_LOGS'):
        raise ValueError('unsupported operation')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(38 if op == 'INSTALLED_LOGS' else 30 if op == 'KERNEL_INSPECT' else 5)
        conn.connect(SOCKET)
        conn.sendall(('JSON\t' + op + '\n').encode('ascii'))
        with conn.makefile('rb') as stream:
            result = stream.readline(MAX_RESPONSE + 1)
    if not result.endswith(b'\n') or len(result) > MAX_RESPONSE:
        raise ValueError('invalid broker response')
    value = json.loads(result)
    if value.get('ok') is not True:
        raise ValueError('broker refused request')
    return value['value']


def read_bounded(command):
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    selector = selectors.DefaultSelector()
    try:
        selector.register(proc.stdout, selectors.EVENT_READ)
        data = bytearray()
        deadline = time.monotonic() + 10
        truncated = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not selector.select(remaining):
                raise subprocess.TimeoutExpired(command, 10)
            chunk = os.read(proc.stdout.fileno(), min(32768, MAX_LOG + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
            if len(data) > MAX_LOG:
                truncated = True
                break
        if truncated:
            proc.kill()
        status = proc.wait(timeout=max(0.1, deadline - time.monotonic()))
        if status and not truncated:
            raise subprocess.CalledProcessError(status, command)
        return bytes(data[:MAX_LOG]), truncated
    finally:
        selector.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        proc.stdout.close()


def journal(source):
    if source not in ('broker', 'kernel', 'source'):
        raise ValueError('unsupported journal source')
    command = ['journalctl', '--no-pager', '--output=cat', '--lines=100']
    command += (['--dmesg', '--priority=warning'] if source == 'kernel'
                else ['--unit=otehon-installer-source.service' if source == 'source' else '--unit=otehon-install-broker.service'])
    try:
        output, truncated = read_bounded(command)
    except (OSError, subprocess.SubprocessError):
        return {'available': False, 'text': '', 'truncated': False}
    # Escape control characters in the JSON encoder; bound transfer even when
    # a device error or journal line contains an unexpectedly long string.
    return {'available': True, 'text': output.decode('utf-8', 'replace'),
            'truncated': truncated}


def main():
    result = {'schema': 'awai.otehon.installer-diagnostics.v1', 'readOnly': True}
    try:
        info_path = Path(os.environ['OTEHON_INSTALLER_INFO'])
        result['installer'] = json.loads(info_path.read_text(encoding='utf-8'))
        if os.environ.get('OTEHON_ALLOW_INSTALL_OBSERVATION') == '1':
            result['journal'] = {source: journal(source) for source in ('source', 'broker', 'kernel')}
            try:
                result['status'] = broker('STATUS')
                result['inventory'] = broker('LIST')
            except (OSError, ValueError):
                result['status'] = {'available': False}
                result['inventory'] = {'available': False}
                result['error'] = 'broker-unavailable'
            try:
                result['deviceUsage'] = broker('INSPECT')
            except (OSError, ValueError):
                result['deviceUsage'] = {'available': False}
            if os.environ.get('OTEHON_ALLOW_KERNEL_CLAIMS') == '1':
                try: result['kernelClaims'] = broker('KERNEL_INSPECT')
                except (OSError, ValueError): result['kernelClaims'] = {'available': False}
            print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
            return 0
        result['status'] = broker('STATUS')
        if result['status'].get('readOnly') is not True and os.environ.get('OTEHON_ALLOW_INSTALL_OBSERVATION') != '1':
            raise ValueError('broker is not read-only')
        result['inventory'] = broker('LIST')
        result['journal'] = {source: journal(source) for source in ('broker', 'kernel')}
        if os.environ.get('OTEHON_ALLOW_INSTALLED_BOOT_LOGS') == '1':
            result['installedBoot'] = broker('INSTALLED_LOGS')
    except (KeyError, OSError, ValueError, json.JSONDecodeError):
        print(json.dumps({'schema': result['schema'], 'error': 'diagnostics-unavailable'}))
        return 1
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
