#!/usr/bin/env python3
"""Boot the real read-only LAN diagnostic image on isolated QEMU scratch hardware."""
import argparse
from functools import partial
import http.server
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import socketserver
import subprocess
import threading
import time


def run(command, **kwargs):
    return subprocess.run(command, text=True, capture_output=True, timeout=15, **kwargs)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--image', required=True)
    p.add_argument('--output', required=True)
    p.add_argument('--key', required=True)
    p.add_argument('--bad-key', required=True)
    p.add_argument('--ovmf-code', required=True)
    p.add_argument('--ovmf-vars', required=True)
    p.add_argument('--timeout', type=int, default=1200)
    p.add_argument('--source-revision', required=True)
    p.add_argument('--memory-mib', type=int, default=8192)
    args = p.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.source_revision):
        raise ValueError('invalid source revision')
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    image = Path(args.image).resolve()
    serve = out / 'serve'
    serve.mkdir()
    for name in ('ipxe.efi', 'kernel', 'initrd'):
        shutil.copyfile(image / name, serve / name)
    shutil.copyfile(args.ovmf_vars, out / 'vars.fd')
    os.chmod(out / 'vars.fd', 0o600)
    target = out / 'target.qcow2'
    subprocess.run(['qemu-img', 'create', '-f', 'qcow2', str(target), '32G'], check=True)
    serial = out / 'serial.log'
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_): pass
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True
    httpd = Server(('127.0.0.1', 8080), partial(Quiet, directory=str(serve)))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as port_reservation:
        port_reservation.bind(('127.0.0.1', 0))
        serial_port = port_reservation.getsockname()[1]
    command = [
        'qemu-system-x86_64', '-machine', 'q35', '-accel',
        'kvm' if os.access('/dev/kvm', os.R_OK | os.W_OK) else 'tcg', '-cpu', 'max',
        '-smp', '4', '-m', str(args.memory_mib), '-display', 'none', '-no-reboot',
        '-drive', f'if=pflash,format=raw,readonly=on,file={args.ovmf_code}',
        '-drive', f'if=pflash,format=raw,file={out / "vars.fd"}',
        '-drive', f'if=none,id=target,format=qcow2,file={target},snapshot=on',
        '-device', 'nvme,drive=target,serial=VM-SCRATCH',
        '-netdev', f'user,id=n,net=10.77.0.0/24,host=10.77.0.1,dhcpstart=10.77.0.2,tftp={serve},bootfile=ipxe.efi,hostfwd=tcp:127.0.0.1:22222-10.77.0.2:2222',
        '-device', 'virtio-net-pci,netdev=n,bootindex=1',
        '-serial', f'tcp:127.0.0.1:{serial_port},server=on,wait=off',
    ]
    artifacts = {}
    for name in ('ipxe.efi', 'kernel', 'initrd'):
        digest = hashlib.sha256()
        with (serve / name).open('rb') as source:
            while block := source.read(1024 * 1024): digest.update(block)
        artifacts[name] = digest.hexdigest()
    proof = {'schema': 'awai.otehon.netboot-vm.v1', 'physicalDisks': False,
             'sourceRevision': args.source_revision, 'artifacts': artifacts, 'checks': []}
    proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=(out / 'qemu.log').open('wb'))
    serial_conn = None
    serial_reader = None
    try:
        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            try:
                serial_conn = socket.create_connection(('127.0.0.1', serial_port), timeout=2)
                serial_conn.settimeout(None)
                break
            except OSError:
                if proc.poll() is not None: raise RuntimeError('QEMU exited before serial console')
                time.sleep(1)
        if serial_conn is None: raise RuntimeError('serial console unavailable')
        def record_serial():
            with serial.open('wb') as output:
                while True:
                    try: data = serial_conn.recv(8192)
                    except OSError: break
                    if not data: break
                    output.write(data)
                    output.flush()
        serial_reader = threading.Thread(target=record_serial, daemon=True)
        serial_reader.start()
        fingerprint = None
        scanned = ''
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                raise RuntimeError('QEMU stopped before diagnostics became available')
            screen = serial.read_text(errors='replace') if serial.exists() else ''
            match = re.search(r'SHA256:[A-Za-z0-9+/]{43}', screen)
            scan = run(['ssh-keyscan', '-T', '2', '-t', 'ed25519', '-p', '22222', '127.0.0.1'])
            if match and scan.returncode == 0 and scan.stdout:
                fingerprint, scanned = match.group(), scan.stdout
                break
            time.sleep(3)
        if not fingerprint:
            raise RuntimeError('Timed out waiting for local fingerprint and SSH')
        # The real installer console talks to the same broker as USB. Selecting
        # the scratch NVMe must be rejected by diagnostic read-only mode.
        while time.monotonic() < deadline:
            if '保存先の番号を入力して Enter' in serial.read_text(errors='replace'):
                break
            time.sleep(2)
        else: raise RuntimeError('installer console did not reach disk selection')
        serial_conn.sendall(b'1\n')
        while time.monotonic() < deadline:
            if '診断モードのため、ディスクの選択や書込みはできません' in serial.read_text(errors='replace'):
                break
            time.sleep(2)
        else: raise RuntimeError('read-only broker did not reject console selection')
        proof['checks'].append('scratch NVMe selection refused by read-only broker')
        scanned_key = run(['ssh-keygen', '-lf', '-', '-E', 'sha256'], input=scanned)
        if scanned_key.returncode or fingerprint not in scanned_key.stdout:
            raise RuntimeError('Local console and network host key do not match')
        known = out / 'known_hosts'
        known.write_text(scanned)
        proof['checks'].append('console host key matches SSH host key')
        ssh = ['ssh', '-F', '/dev/null', '-p', '22222', '-o', 'BatchMode=yes',
               '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', f'UserKnownHostsFile={known}', '-o', 'GlobalKnownHostsFile=/dev/null',
               '-o', 'ConnectTimeout=5', '-o', 'LogLevel=ERROR']
        bad = run(ssh + ['-i', args.bad_key, 'otehon-installer@127.0.0.1'])
        if bad.returncode == 0:
            raise RuntimeError('unapproved key unexpectedly authenticated')
        proof['checks'].append('unapproved key rejected')
        password = run(ssh + ['-o', 'PubkeyAuthentication=no', '-o', 'PreferredAuthentications=password',
                              'otehon-installer@127.0.0.1'])
        if password.returncode == 0:
            raise RuntimeError('password authentication unexpectedly permitted')
        proof['checks'].append('password authentication rejected')
        valid = run(ssh + ['-i', args.key, 'otehon-installer@127.0.0.1', 'id'])
        if valid.returncode:
            raise RuntimeError('approved key rejected: ' + valid.stderr[-1000:])
        value = json.loads(valid.stdout)
        if value.get('readOnly') is not True or value.get('status', {}).get('readOnly') is not True:
            raise RuntimeError('broker did not establish read-only mode')
        if not all(value.get('journal', {}).get(source, {}).get('available') for source in ('broker', 'kernel')):
            raise RuntimeError('installer journal not available')
        if not any(row.get('path', '').startswith('/dev/nvme') for row in value.get('inventory', {}).get('devices', [])):
            raise RuntimeError('scratch NVMe not present in inventory')
        (out / 'diagnostics.json').write_text(json.dumps(value, indent=2))
        proof['checks'].append('approved key sees bounded read-only diagnostics, not shell output')
        forwarded = run(ssh + ['-i', args.key, '-W', '10.77.0.1:22', 'otehon-installer@127.0.0.1'])
        if forwarded.returncode == 0:
            raise RuntimeError('forwarding unexpectedly permitted')
        proof['checks'].append('forwarding rejected')
        proof['passed'] = True
    finally:
        proc.terminate()
        try: proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        if serial_conn is not None: serial_conn.close()
        if serial_reader is not None: serial_reader.join(timeout=5)
        httpd.shutdown()
        httpd.server_close()
        (out / 'proof.json').write_text(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
