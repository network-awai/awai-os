#!/usr/bin/env python3
"""Boot the actual live ISO in an unprivileged, isolated UEFI QEMU VM.

All writable VM files are newly created in --output. No physical disk, host
directory sharing, host forwarding or external network access is attached.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iso", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--qemu", default="qemu-system-x86_64")
    parser.add_argument("--ovmf-code", type=Path, default=Path("/usr/share/OVMF/OVMF_CODE_4M.fd"))
    parser.add_argument("--ovmf-vars", type=Path, default=Path("/usr/share/OVMF/OVMF_VARS_4M.fd"))
    parser.add_argument("--tesseract", required=True)
    args = parser.parse_args()
    if os.geteuid() == 0:
        parser.error("run as an unprivileged KVM user, never root")
    iso = args.iso.resolve(strict=True)
    if not iso.is_file():
        parser.error("ISO must be a regular file")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    disk = output / "blank.raw"
    with disk.open("xb") as stream:
        stream.write(b"MURAKUMO_VM_ONLY_DO_NOT_INSTALL\n")
        stream.truncate(64 * 1024 * 1024)
    before = sha256(disk)
    variables = output / "OVMF_VARS.fd"
    shutil.copyfile(args.ovmf_vars, variables)
    serial_path, qmp_path = output / "serial.sock", output / "qmp.sock"
    if max(len(str(serial_path)), len(str(qmp_path))) >= 104:
        parser.error("output path is too long for Unix sockets")
    command = [args.qemu, "-enable-kvm", "-m", "4096", "-smp", "2",
               "-drive", f"if=pflash,format=raw,readonly=on,file={args.ovmf_code}",
               "-drive", f"if=pflash,format=raw,file={variables}",
               "-drive", f"if=virtio,format=raw,file={disk}",
               "-cdrom", str(iso), "-boot", "order=d", "-display", "none",
               "-vga", "virtio", "-nic", "user,restrict=on,model=virtio-net-pci",
               "-serial", f"unix:{serial_path},server=on,wait=off",
               "-qmp", f"unix:{qmp_path},server=on,wait=off"]
    transcript = bytearray()
    started = time.monotonic()
    process = None
    serial = None
    qmp = None
    completed = False
    proof = {"schema": "murakumo.native-iso-vm.v1", "iso": str(iso),
             "isoSha256": sha256(iso), "isoBytes": iso.stat().st_size,
             "firmware": "OVMF UEFI", "externalNetwork": False,
             "firmwareCodeSha256": sha256(args.ovmf_code),
             "checkerSha256": sha256(Path(__file__)),
             "qemuVersion": subprocess.check_output([args.qemu, "--version"], text=True).splitlines()[0],
             "physicalDisksAttached": False, "qemuCommand": command}
    try:
        with (output / "qemu.log").open("wb") as log:
            process = subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True)
            print("Started isolated UEFI ISO VM", flush=True)
            deadline = time.monotonic() + 20
            while not serial_path.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("QEMU failed before creating serial socket")
                time.sleep(0.1)
            serial = socket.socket(socket.AF_UNIX)
            serial.connect(str(serial_path))
            serial.settimeout(1)

            def read_until(pattern, timeout):
                deadline = time.monotonic() + timeout
                begin = len(transcript)
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        raise RuntimeError("QEMU exited unexpectedly")
                    try:
                        data = serial.recv(65536)
                        if not data:
                            raise RuntimeError("serial socket closed")
                        transcript.extend(data)
                        (output / "console.txt").write_bytes(transcript)
                        text = transcript[begin:].decode(errors="replace")
                        if re.search(pattern, text):
                            return text
                    except socket.timeout:
                        pass
                raise TimeoutError(f"serial wait timed out: {pattern}")

            # The standard live media autologin account is nixos. Elevate
            # inside this disposable VM, without enabling any remote access.
            read_until(r"(?:nixos|root)@[^\r\n]*[$#]", 300)
            serial.sendall(b"sudo -n -i\n")
            read_until(r"root@[^\r\n]*[#]", 30)
            print("Live serial console is ready", flush=True)
            probe = r'''set -euo pipefail
test -d /sys/firmware/efi
test -b /dev/vda
! findmnt -rn -S /dev/vda
systemctl is-active --quiet murakumo-node-monitor.service nginx.service cage-tty1.service
for attempt in $(seq 1 60); do
  test -s /var/lib/murakumo-observe/observation.json && break
  sleep 1
done
jq -e '.signed == false and .enrollment == "unregistered" and .cellRuntime == false and .memoryTotalKiB > 0' /var/lib/murakumo-observe/observation.json
test ! -e /etc/murakumo/os-update.json
test ! -e /etc/systemd/system/murakumo-os-update-guard.timer
test ! -e /etc/systemd/system/murakumo-install.service
test ! -e /var/lib/murakumo-os-update
cd /etc/murakumo/native-profile
jq -e '.schema == "murakumo.native-media.v1" and .liveNetworkUpdates == false and .automaticDiskInstallation == false' media-manifest.json
jq -r '.files | to_entries[] | "\(.value)  \(.key)"' media-manifest.json | sha256sum -c -
jq -r '.qualifiedSourcesSha256 | to_entries[] | "\(.value)  \(.key)"' docs/evidence/native-network-update-20261024.json | sha256sum -c -
printf 'MURA_MANIFEST_JSON '
cat media-manifest.json
printf '\n'
test -r /etc/murakumo/network-update-guide.md
set +e
murakumo-os-update status >/tmp/update-refusal 2>&1
refusal=$?
murakumo-network-update >/tmp/client-usage 2>&1
usage=$?
set -e
test "$refusal" = 1
grep -F 'network updates are not configured' /tmp/update-refusal
test "$usage" = 2
grep -F 'usage: murakumo-network-update' /tmp/client-usage
test ! -e /var/lib/murakumo-os-update
curl --fail --silent http://127.0.0.1:18780/ | grep -q 'Itonami workspace'
curl --fail --silent http://127.0.0.1:18780/artifact-pins.js | grep -q '"liveSession":true'
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18780/observation.json)" = 404
test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18780/api/network-update)" = 404
! pgrep -x node
! pgrep -x java
! pgrep -x nbb
pgrep -u murakumo chromium >/dev/null
'''
            encoded = base64.b64encode(probe.encode()).decode()
            serial.sendall(b": >/tmp/media-probe.b64\n")
            # Keep each input line below Linux's canonical tty line limit.
            for offset in range(0, len(encoded), 900):
                serial.sendall((f"printf %s {encoded[offset:offset + 900]} >>/tmp/media-probe.b64\n").encode())
            serial.sendall(b"base64 -d /tmp/media-probe.b64 >/tmp/media-probe; bash /tmp/media-probe; printf '\\nMURA_PROBE_EXIT_%s\\n' $?\n")
            result = read_until(r"\r?\nMURA_PROBE_EXIT_[0-9]+", 180)
            if not re.search(r"\r?\nMURA_PROBE_EXIT_0\b", result):
                raise RuntimeError("guest media checks failed")
            print("Media hashes, update refusal and local services passed", flush=True)
            manifest = json.loads(re.search(r"MURA_MANIFEST_JSON (\{[^\r\n]+\})", result).group(1))
            qmp = socket.socket(socket.AF_UNIX)
            qmp.connect(str(qmp_path))
            qmp.settimeout(10)
            stream = qmp.makefile("rwb", buffering=0)
            json.loads(stream.readline())

            def qmp_command(name, arguments=None):
                stream.write((json.dumps({"execute": name, "arguments": arguments or {}}) + "\n").encode())
                while True:
                    reply = json.loads(stream.readline())
                    if "error" in reply:
                        raise RuntimeError(reply)
                    if "return" in reply:
                        return reply["return"]

            qmp_command("qmp_capabilities")
            screenshot = output / "desktop.ppm"
            text = ""
            for attempt in range(30):
                qmp_command("screendump", {"filename": str(screenshot)})
                text = subprocess.check_output([args.tesseract, str(screenshot), "stdout"], stderr=subprocess.DEVNULL, text=True)
                if "Local runtime ready" in text:
                    break
                time.sleep(2)
            (output / "desktop-ocr.txt").write_text(text)
            if "Local runtime ready" not in text:
                raise RuntimeError("desktop OCR did not confirm browser/Worker readiness")
            proof.update(guestProbePassed=True, browserRuntimeReady=True,
                         manifest=manifest, manifestFilesVerified=len(manifest["files"]),
                         priorQualifiedSourcesVerified=17,
                         liveUpdateRefused=True, localControlApiAbsent=True)
            qmp_command("quit")
            process.wait(timeout=20)
            completed = True
    finally:
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        if serial is not None:
            serial.close()
        if qmp is not None:
            qmp.close()
        (output / "console.txt").write_bytes(transcript)
        proof.update(seconds=round(time.monotonic() - started, 2),
                     blankDiskUnchanged=before == sha256(disk),
                     vmStopped=process is not None and process.poll() is not None)
        proof["passed"] = completed and proof["blankDiskUnchanged"] and proof["vmStopped"]
        (output / "proof.json").write_text(json.dumps(proof, indent=2) + "\n")
    assert proof["blankDiskUnchanged"]
    print(json.dumps(proof, indent=2))


if __name__ == "__main__":
    main()
