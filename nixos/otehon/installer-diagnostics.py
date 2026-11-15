"""Read-only, bounded diagnostics for the installer SSH forced command.

This program accepts no commands or paths from the client. Authentication and
host identity are the transport's responsibility; it never grants write access.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys

SOCKET = '/run/otehon-install/control.sock'
MAX_RESPONSE = 262144
MAX_LOG = 131072


def broker(op):
    if op not in ('STATUS', 'LIST'):
        raise ValueError('unsupported operation')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
        conn.settimeout(5)
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


def journal():
    command = ['journalctl', '--no-pager', '--output=cat', '--lines=100',
               '--unit=otehon-install-broker.service']
    try:
        output = subprocess.run(command, check=True, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return {'available': False, 'text': '', 'truncated': False}
    # Escape control characters in the JSON encoder; bound transfer even when
    # a device error or journal line contains an unexpectedly long string.
    return {'available': True, 'text': output[-MAX_LOG:].decode('utf-8', 'replace'),
            'truncated': len(output) > MAX_LOG}


def main():
    result = {'schema': 'awai.otehon.installer-diagnostics.v1', 'readOnly': True}
    try:
        info_path = Path(os.environ['OTEHON_INSTALLER_INFO'])
        result['installer'] = json.loads(info_path.read_text(encoding='utf-8'))
        result['status'] = broker('STATUS')
        if result['status'].get('readOnly') is not True:
            raise ValueError('broker is not read-only')
        result['inventory'] = broker('LIST')
        result['journal'] = journal()
    except (KeyError, OSError, ValueError, json.JSONDecodeError):
        print(json.dumps({'schema': result['schema'], 'error': 'diagnostics-unavailable'}))
        return 1
    print(json.dumps(result, ensure_ascii=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    sys.exit(main())
