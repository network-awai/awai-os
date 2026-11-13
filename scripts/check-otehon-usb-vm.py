#!/usr/bin/env python3
"""Boot the actual ISO as read-only USB, with newly-created scratch target disks only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import time


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--iso", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--ovmf-code", type=Path, required=True)
    p.add_argument("--ovmf-vars", type=Path, required=True)
    p.add_argument("--digests", type=Path, required=True)
    a = p.parse_args()
    if os.geteuid() == 0:
        p.error("run unprivileged; no physical drives may be attached")
    iso = a.iso.resolve(strict=True)
    if not iso.is_file():
        p.error("ISO must be a regular file")
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    # Short sockets are private to this builder's newly created work directory.
    sockets = Path.cwd() / "usb-vm-sockets"
    sockets.mkdir(mode=0o700, exist_ok=False)
    serial_path = sockets / "serial"
    qmp_path = sockets / "qmp"
    if len(str(serial_path)) >= 104:
        p.error("Unix socket path too long")
    vars_file = out / "OVMF_VARS.fd"
    shutil.copyfile(a.ovmf_vars, vars_file)
    vars_file.chmod(0o600)
    disks = [("target", "OTEHON-USB-TARGET", "64G"), ("decoy", "OTEHON-USB-DECOY", "64G"), ("small", "OTEHON-USB-SMALL", "2G")]
    command = ["qemu-system-x86_64", "-enable-kvm", "-m", "4096", "-smp", "2", "-display", "none", "-nic", "none",
               "-drive", f"if=pflash,format=raw,readonly=on,file={a.ovmf_code}",
               "-drive", f"if=pflash,format=raw,file={vars_file}",
               "-device", "qemu-xhci", "-drive", f"if=none,id=media,format=raw,readonly=on,file={iso}",
               "-device", "usb-storage,drive=media,bootindex=1,serial=OTEHON-USB-MEDIUM",
               "-serial", f"unix:{serial_path},server=on,wait=off",
               "-qmp", f"unix:{qmp_path},server=on,wait=off"]
    for index, (name, serial, size) in enumerate(disks):
        disk = out / f"{name}.qcow2"
        subprocess.run(["qemu-img", "create", "-q", "-f", "qcow2", str(disk), size], check=True)
        command += ["-drive", f"if=none,id=d{index},format=qcow2,file={disk},discard=unmap,detect-zeroes=unmap",
                    "-device", f"virtio-blk-pci,drive=d{index},serial={serial}"]

    def written(name):
        regions = json.loads(subprocess.check_output(["qemu-img", "map", "-U", "--output=json", str(out / f"{name}.qcow2")]))
        return sum(r["length"] for r in regions if r["data"])

    proof = {"schema": "awai.otehon.usb-vm.v1", "isoSha256": digest(iso), "isoBytes": iso.stat().st_size,
             "rawSha256": (a.digests / "raw").read_text().strip(), "rawBytes": int((a.digests / "bytes").read_text()),
             "externalNetwork": False, "physicalDisks": False, "checks": [], "passed": False}
    process = None
    port = None
    transcript = bytearray()
    unread = ""
    try:
        with (out / "qemu.log").open("wb") as log:
            process = subprocess.Popen(command, stdout=log, stderr=log)
            deadline = time.monotonic() + 30
            while not serial_path.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError("QEMU did not start")
                time.sleep(0.1)
            port = socket.socket(socket.AF_UNIX)
            port.connect(str(serial_path))
            port.settimeout(1)

            def expect(text, timeout=180):
                nonlocal unread
                end = time.monotonic() + timeout
                while time.monotonic() < end:
                    if text in unread:
                        unread = unread.split(text, 1)[1]
                        return
                    if process.poll() is not None:
                        raise RuntimeError("QEMU exited")
                    try:
                        block = port.recv(65536)
                        if not block:
                            raise RuntimeError("serial closed")
                        transcript.extend(block)
                        unread += block.decode(errors="replace")
                        (out / "console.txt").write_bytes(transcript)
                    except socket.timeout:
                        pass
                raise TimeoutError(text)

            def send(text):
                port.sendall((text + "\r").encode())

            def untouched():
                if any(written(name) for name, _, _ in disks):
                    raise AssertionError("scratch disk changed before authorized install")

            prompt = "press Enter to list disks again: "
            expect(prompt, 300)
            untouched()
            proof["checks"].append("UEFI actual USB ISO boots offline without writing targets")
            send("WRONG-SERIAL")
            expect("No single disk has that serial")
            expect(prompt)
            send("OTEHON-USB-SMALL")
            expect("too small")
            expect(prompt)
            send("OTEHON-USB-TARGET")
            expect("Type ERASE")
            send("erase")
            expect("Stopped. Nothing was written.")
            expect(prompt)
            untouched()
            proof["checks"].append("wrong serial, undersize and non-ERASE refuse without writes")
            # The compressed medium is smaller than its uncompressed payload.
            # It must refuse its own USB before the erase confirmation.
            send("OTEHON-USB-MEDIUM")
            expect("too small")
            expect(prompt)
            untouched()
            proof["checks"].append("installer medium cannot select itself")
            send("OTEHON-USB-TARGET")
            expect("Type ERASE")
            send("ERASE")
            expect("INSTALLED on", 1800)
            if written("target") == 0 or written("decoy") or written("small"):
                raise AssertionError("incorrect scratch write scope")
            proof["checks"].append("explicit target install verifies full raw digest; decoy and small untouched")
            proof["passed"] = True
    finally:
        if not proof["passed"]:
            print("USB_VM_CONSOLE_TAIL\n" + transcript[-24000:].decode(errors="replace"), flush=True)
            print("USB_VM_QEMU_LOG\n" + (out / "qemu.log").read_text(errors="replace")[-4000:], flush=True)
            if process and process.poll() is None:
                try:
                    with socket.socket(socket.AF_UNIX) as qmp:
                        qmp.settimeout(5)
                        qmp.connect(str(qmp_path))
                        channel = qmp.makefile("rwb", buffering=0)
                        channel.readline()
                        for request in [{"execute": "qmp_capabilities"}, {"execute": "screendump", "arguments": {"filename": str(out / "screen.ppm")}}]:
                            channel.write((json.dumps(request) + "\n").encode())
                            while True:
                                reply = json.loads(channel.readline())
                                if "return" in reply or "error" in reply:
                                    break
                except Exception as e:
                    print("screenshot unavailable: " + type(e).__name__, flush=True)
        if port:
            port.close()
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        (out / "result.json").write_text(json.dumps(proof, indent=2) + "\n")
        # VM disks contain test data only and are not delivery artifacts.
        for name, _, _ in disks:
            (out / f"{name}.qcow2").unlink(missing_ok=True)
        vars_file.unlink(missing_ok=True)
    print(json.dumps(proof), flush=True)


if __name__ == "__main__":
    main()
