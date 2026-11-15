#!/usr/bin/env python3
"""Install over real PXE/HTTP + read-only NBD onto fresh QEMU NVMe only."""
import argparse
import codecs
from functools import partial
import hashlib
import http.server
from importlib.util import spec_from_file_location, module_from_spec
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


def load(name, path):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('image', 'iso', 'output', 'ovmf-code', 'ovmf-vars', 'bad-key'):
        p.add_argument('--' + name, type=Path, required=True)
    p.add_argument('--key', type=Path, help='optional private fixture key; omitted for operator-keyed artifact')
    p.add_argument('--source-revision', required=True)
    p.add_argument('--memory-mib', type=int, default=16384)
    a = p.parse_args()
    if os.geteuid() == 0 or not re.fullmatch('[0-9a-f]{40}', a.source_revision):
        p.error('run unprivileged with an exact source revision')
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    # Short socket paths, kept within the explicitly supplied task directory.
    sockets = out.parent / 'lan-install-sockets'
    sockets.mkdir(mode=0o700, exist_ok=False)
    if len(str(sockets / 'first-boot.serial')) >= 104:
        p.error('socket path too long')
    manifest = json.loads((Path(__file__).resolve().parents[1] / 'docs/evidence/otehon-installer-release-0.7.3.json').read_text())
    export = load('iso_export', Path(__file__).with_name('otehon-lan-iso.py'))
    nbd_command = export.command(a.iso, manifest['image']['isoSha256'], manifest['image']['isoBytes'], '127.0.0.1', 10809)
    proof = {'schema': 'awai.otehon.lan-install-vm.v1', 'sourceRevision': a.source_revision,
             'isoSha256': manifest['image']['isoSha256'], 'isoBytes': manifest['image']['isoBytes'],
             'physicalDisks': False, 'installerNetwork': 'QEMU user networking; external access not measured', 'installedNetwork': 'none', 'checks': [], 'passed': False}
    proof['artifacts'] = {}
    for name in ('ipxe.efi', 'kernel', 'initrd', 'installer-info.json'):
        h = hashlib.sha256()
        with (a.image / name).open('rb') as stream:
            while block := stream.read(1024 * 1024): h.update(block)
        proof['artifacts'][name] = h.hexdigest()
    variables = out / 'OVMF_VARS.fd'
    shutil.copyfile(a.ovmf_vars, variables)
    variables.chmod(0o600)
    for name, size in [('target', '64G'), ('decoy', '64G'), ('small', '2G')]:
        subprocess.run(['qemu-img', 'create', '-q', '-f', 'qcow2', str(out / (name + '.qcow2')), size], check=True)
    def written(name):
        rows = json.loads(subprocess.check_output(['qemu-img', 'map', '-U', '--output=json', str(out / (name + '.qcow2'))]))
        return sum(row['length'] for row in rows if row['data'])
    def untouched():
        if any(written(name) for name in ('target', 'decoy', 'small')):
            raise AssertionError('scratch target changed before approval')
    class Server(socketserver.ThreadingTCPServer):
        allow_reuse_address = True
        daemon_threads = True
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *_): pass
    httpd = Server(('127.0.0.1', 8080), partial(Quiet, directory=str(a.image.resolve())))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        serial_port = reservation.getsockname()[1]
    command = ['qemu-system-x86_64', '-machine', 'q35', '-accel', 'kvm', '-cpu', 'host',
               '-vga', 'virtio', '-smp', '4', '-m', str(a.memory_mib), '-display', 'none', '-no-reboot',
               '-drive', f'if=pflash,format=raw,readonly=on,file={a.ovmf_code}',
               '-drive', f'if=pflash,format=raw,file={variables}',
               '-netdev', f'user,id=n,net=10.77.0.0/24,host=10.77.0.1,dhcpstart=10.77.0.2,tftp={a.image.resolve()},bootfile=ipxe.efi,hostfwd=tcp:127.0.0.1:22222-10.77.0.2:2222',
               '-device', 'virtio-net-pci,netdev=n,bootindex=1',
               '-serial', f'tcp:127.0.0.1:{serial_port},server=on,wait=off',
               '-qmp', f'unix:{sockets / "installer.qmp"},server=on,wait=off']
    for index, name in enumerate(('target', 'decoy', 'small')):
        command += ['-drive', f'if=none,id=d{index},format=qcow2,file={out / (name + ".qcow2")},discard=unmap,detect-zeroes=unmap',
                    '-device', f'{"nvme" if index == 0 else "virtio-blk-pci"},drive=d{index},serial=OTEHON-USB-{name.upper()}']
    nbd = process = port = None
    transcript = bytearray()
    unread = ''
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    def capture_wait_screen():
        # Read the actual VGA console when the broker is not ready yet.
        try:
            with socket.socket(socket.AF_UNIX) as qmp:
                qmp.settimeout(10); qmp.connect(str(sockets / 'installer.qmp'))
                with qmp.makefile('rwb', buffering=0) as stream:
                    stream.readline()
                    for request in ({'execute': 'qmp_capabilities'}, {'execute': 'screendump', 'arguments': {'filename': str(out / 'waiting.ppm')}}):
                        stream.write((json.dumps(request) + '\n').encode())
                        while True:
                            reply = json.loads(stream.readline())
                            if 'error' in reply: raise RuntimeError(str(reply['error']))
                            if 'return' in reply: break
            with (out / 'waiting.png').open('wb') as png:
                subprocess.run(['pnmtopng', str(out / 'waiting.ppm')], stdout=png, stderr=subprocess.DEVNULL, check=True)
            screen = subprocess.check_output(['tesseract', str(out / 'waiting.ppm'), 'stdout', '-l', 'eng+jpn'], text=True, stderr=subprocess.DEVNULL, timeout=30)
            (out / 'waiting.txt').write_text(screen)
            print('LAN_VM waiting screen: ' + screen[-2000:], flush=True)
        except (OSError, subprocess.SubprocessError, RuntimeError) as error:
            print('LAN_VM waiting capture: ' + str(error), flush=True)
    def expect(text, timeout=1200):
        nonlocal unread
        end = time.monotonic() + timeout
        last_screen = time.monotonic()
        while time.monotonic() < end:
            if text in unread:
                unread = unread.split(text, 1)[1]
                print('LAN_VM ' + text, flush=True)
                return
            if 'インストールを完了できませんでした' in unread:
                raise RuntimeError('installer reported failure; see console.txt')
            if process.poll() is not None:
                raise RuntimeError('QEMU exited before ' + text)
            if time.monotonic() - last_screen >= 45:
                capture_wait_screen()
                last_screen = time.monotonic()
            try:
                block = port.recv(65536)
                if not block: raise RuntimeError('serial closed')
                transcript.extend(block)
                unread += decoder.decode(block)
                (out / 'console.txt').write_bytes(transcript)
            except socket.timeout: pass
        raise TimeoutError(text)
    def send(text): port.sendall((text + '\n').encode())
    def ssh(*args, key=None):
        return subprocess.run(['ssh', '-F', '/dev/null', '-p', '22222', '-i', str(key or a.key),
            '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', f'UserKnownHostsFile={out / "known_hosts"}', '-o', 'GlobalKnownHostsFile=/dev/null',
            '-o', 'ConnectTimeout=5', 'otehon-installer@127.0.0.1', *args], text=True, capture_output=True, timeout=30)
    try:
        nbd = subprocess.Popen(nbd_command, stdout=(out / 'nbd.log').open('wb'), stderr=subprocess.STDOUT)
        time.sleep(1)
        if nbd.poll() is not None: raise RuntimeError('NBD exporter failed')
        process = subprocess.Popen(command, stdout=(out / 'qemu.log').open('wb'), stderr=subprocess.STDOUT)
        for _ in range(30):
            try:
                port = socket.create_connection(('127.0.0.1', serial_port), timeout=2)
                port.settimeout(1)
                break
            except OSError: time.sleep(1)
        if port is None: raise RuntimeError('no serial console')
        expect('保存先の番号を入力して Enter')
        untouched()
        proof['checks'].append('LAN boots and verifies pinned read-only ISO over NBD before target writes')
        fingerprint = re.search(r'SHA256:[A-Za-z0-9+/]{43}', transcript.decode(errors='replace'))
        if not fingerprint: raise RuntimeError('console fingerprint not displayed')
        scan = subprocess.run(['ssh-keyscan', '-T', '5', '-t', 'ed25519', '-p', '22222', '127.0.0.1'], text=True, capture_output=True, timeout=15)
        check = subprocess.run(['ssh-keygen', '-lf', '-', '-E', 'sha256'], input=scan.stdout, text=True, capture_output=True, timeout=10)
        if scan.returncode or check.returncode or fingerprint.group() not in check.stdout:
            raise RuntimeError('console and SSH host identities differ')
        (out / 'known_hosts').write_text(scan.stdout)
        if ssh('diagnostics', key=a.bad_key).returncode == 0: raise RuntimeError('unauthorized key accepted')
        if a.key:
            if ssh('id').returncode == 0: raise RuntimeError('arbitrary command accepted')
            if ssh('console').returncode == 0: raise RuntimeError('console accepted without PTY')
            observed = ssh('diagnostics')
            if observed.returncode: raise RuntimeError('bounded observer failed: ' + observed.stderr)
            status = json.loads(observed.stdout)
            if status.get('readOnly') is not True or status.get('status', {}).get('readOnly') is not False:
                raise RuntimeError('unexpected installer observation')
            usage = status.get('deviceUsage', {})
            if usage.get('readOnly') is not True or not usage.get('available'):
                raise RuntimeError('bounded device usage observer unavailable')
            target_usage = [r for r in usage.get('devices', []) if r['path'] == '/dev/nvme0n1']
            if len(target_usage) != 1 or target_usage[0]['exclusiveReadOnlyOpen'].get('opened') is not True:
                raise RuntimeError('scratch NVMe not available to read-only exclusive probe')
            (out / 'before.json').write_text(json.dumps(status, indent=2))
            traced = ssh('kernel-claims')
            if traced.returncode: raise RuntimeError('fixed kernel claim observer failed')
            traced_value = json.loads(traced.stdout)
            claims = traced_value.get('kernelClaims', {})
            if not claims.get('available') or not claims.get('readOnly') or not claims.get('transientKernelTrace'):
                raise RuntimeError('kernel claim observer unavailable: ' + json.dumps(claims))
            target_claim = next(r for r in claims['devices'] if r['path']=='/dev/nvme0n1')
            if target_claim['kernel']['returnCode'] != 0 or traced_value['status']['writeStarted']:
                raise RuntimeError('kernel claim observation altered scratch state')
            (out / 'kernel-claims.json').write_text(json.dumps(traced_value, indent=2))
            proof['checks'].append('fixed transient kernel claim observer preserves idle scratch state')
            proof['checks'].append('shell and non-PTY console rejected; bounded observer available')
        proof['authenticatedObserverChecked'] = bool(a.key)
        proof['checks'].append('displayed host identity matched and unauthorized key rejected')
        send('99'); expect('表示されている番号'); expect('保存先の番号を入力して Enter'); untouched()
        send('1'); expect('すべて消去してインストール'); send('0'); expect('中止しました'); expect('保存先の番号を入力して Enter'); untouched()
        proof['checks'].append('invalid choice and cancelled overwrite leave all scratch disks untouched')
        send('1'); expect('すべて消去してインストール'); send('1')
        expect('INSTALL COMPLETE', timeout=2400)
        if not written('target') or written('decoy') or written('small'): raise AssertionError('wrong write scope')
        if a.key:
            completed = ssh('diagnostics')
            if completed.returncode: raise RuntimeError('completion evidence unavailable')
            final = json.loads(completed.stdout)
            if final['status']['phase'] != 'complete' or not final['status'].get('bootEntry'):
                raise RuntimeError('readback and UEFI completion not established')
            (out / 'complete.json').write_text(json.dumps(final, indent=2))
        proof['checks'].append('explicit NVMe approval writes actual bytes; full readback and UEFI registration succeed; decoys untouched')
        send('2'); process.wait(timeout=90)
        if process.returncode: raise RuntimeError('displayed reboot failed')
        port.close(); port = None
        nbd.terminate(); nbd.wait(timeout=10); nbd = None
        httpd.shutdown(); httpd.server_close(); httpd = None
        proof['checks'].append('displayed reboot exits installer; HTTP and NBD removed before installed boot')
        visual = load('installed_boot', Path(__file__).with_name('otehon-installed-boot.py'))
        visual.verify_installed(out, sockets, a.ovmf_code, variables, proof['checks'], 'nvme', graphical_state=True)
        proof['passed'] = True
    finally:
        if port: port.close()
        for proc in (process, nbd):
            if proc and proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=20)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait()
        if httpd: httpd.shutdown(); httpd.server_close()
        (out / 'proof.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps(proof), flush=True)


if __name__ == '__main__': main()
