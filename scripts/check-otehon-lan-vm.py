#!/usr/bin/env python3
"""Boot the real read-only LAN diagnostic image on isolated QEMU scratch hardware."""
import argparse
from functools import partial
import http.server
import json
import os
from pathlib import Path
import re
import shutil
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
    args = p.parse_args()
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
    http = Server(('127.0.0.1', 8080), partial(Quiet, directory=str(serve)))
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    command = [
        'qemu-system-x86_64', '-machine', 'q35', '-accel', 'kvm:tcg', '-cpu', 'max',
        '-smp', '4', '-m', '8192', '-display', 'none', '-no-reboot',
        '-drive', f'if=pflash,format=raw,readonly=on,file={args.ovmf_code}',
        '-drive', f'if=pflash,format=raw,file={out / "vars.fd"}',
        '-drive', f'if=none,id=target,format=qcow2,file={target},snapshot=on',
        '-device', 'nvme,drive=target,serial=VM-SCRATCH',
        '-netdev', f'user,id=n,net=10.77.0.0/24,host=10.77.0.1,dhcpstart=10.77.0.2,tftp={serve},bootfile=ipxe.efi,hostfwd=tcp:127.0.0.1:22222-10.77.0.2:2222',
        '-device', 'virtio-net-pci,netdev=n,bootindex=1', '-serial', f'file:{serial}',
    ]
    proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=(out / 'qemu.log').open('wb'))
    proof = {'schema': 'awai.otehon.netboot-vm.v1', 'physicalDisks': False, 'checks': []}
    try:
        deadline = time.monotonic() + args.timeout
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
        valid = run(ssh + ['-i', args.key, 'otehon-installer@127.0.0.1', 'id'])
        if valid.returncode:
            raise RuntimeError('approved key rejected: ' + valid.stderr[-1000:])
        value = json.loads(valid.stdout)
        if value.get('readOnly') is not True or value.get('status', {}).get('readOnly') is not True:
            raise RuntimeError('broker did not establish read-only mode')
        if not value.get('journal', {}).get('available'):
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
        http.shutdown()
        http.server_close()
        (out / 'proof.json').write_text(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
