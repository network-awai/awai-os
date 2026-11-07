#!/usr/bin/env python3
"""Checks the PXE installer and the disk it writes, under the x86 emulator, with scratch disks.

usage: install-check-qemu.py <dir with ipxe.efi, kernel, initrd, image.raw.zst> <work dir> [install|boot|all]

It takes the real path: UEFI, PXE, iPXE by TFTP, then HTTP from an address set to 10.77.0.1. It types
at the installer over the serial port. A step that should write nothing is checked from outside
the guest, in the scratch disk's allocation map.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time

SHARE = "/opt/homebrew/share/qemu"
TARGET, DECOY, SMALL = "OTEHON-TGT-1", "OTEHON-DECOY-2", "OTEHON-SMALL-3"
PASSPHRASE = "correct horse battery"

source, work = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
stage = sys.argv[3] if len(sys.argv) > 3 else "all"
serve = os.path.join(work, "serve")
failures = []


def check(name, ok):
    print(f"{'ok  ' if ok else 'FAIL'} {name}", flush=True)
    if not ok:
        failures.append(name)


def disk(name):
    return os.path.join(work, f"{name}.qcow2")


def written(name):
    """Bytes the guest has written to a scratch disk."""
    out = subprocess.run(
        ["qemu-img", "map", "-U", "--output=json", disk(name)], capture_output=True, text=True, check=True
    ).stdout
    return sum(item["length"] for item in json.loads(out) if item["data"])


class Serial:
    """Reads and types on the guest's serial port."""

    def __init__(self, path, log):
        for _ in range(60):
            try:
                self.sock = socket.socket(socket.AF_UNIX)
                self.sock.connect(path)
                break
            except OSError:
                time.sleep(1)
        self.sock.settimeout(1)
        self.log = open(log, "a", errors="replace")
        self.seen = ""

    def pump(self):
        try:
            data = self.sock.recv(65536).decode(errors="replace")
        except TimeoutError:
            return
        self.seen += data
        self.log.write(data)
        self.log.flush()

    def expect(self, *texts, timeout=1800):
        """Waits for one of the texts after the last match, and returns it, or None."""
        end = time.time() + timeout
        while time.time() < end:
            found = [(self.seen.find(text), text) for text in texts if text in self.seen]
            if found:
                at, text = min(found)
                self.seen = self.seen[at + len(text):]
                return text
            self.pump()
        return None

    def type(self, text):
        self.sock.sendall((text + "\r").encode())


def machine(name, drives, net=True):
    vars_file = os.path.join(work, f"{name}-vars.fd")
    shutil.copy(f"{SHARE}/edk2-i386-vars.fd", vars_file)
    os.chmod(vars_file, 0o644)
    sock = os.path.join(work, f"{name}.sock")
    if os.path.exists(sock):
        os.remove(sock)
    args = [
        "qemu-system-x86_64", "-machine", "q35", "-accel", "tcg,thread=multi", "-cpu", "max",
        "-smp", "6", "-m", "12288", "-display", "none",
        "-drive", f"if=pflash,format=raw,readonly=on,file={SHARE}/edk2-x86_64-code.fd",
        "-drive", f"if=pflash,format=raw,file={vars_file}",
        "-device", "virtio-vga", "-device", "qemu-xhci", "-device", "usb-tablet",
        "-serial", f"unix:{sock},server,nowait",
        "-monitor", f"unix:{sock}.mon,server,nowait",
    ]
    for index, (drive, serial) in enumerate(drives):
        args += [
            "-drive", f"id=d{index},if=none,format=qcow2,file={disk(drive)},discard=unmap,detect-zeroes=unmap",
            "-device", f"virtio-blk-pci,drive=d{index},serial={serial}" + (",bootindex=2" if not net else ""),
        ]
    if net:
        args += [
            "-netdev", f"user,id=n,net=10.77.0.0/24,host=10.77.0.1,dhcpstart=10.77.0.10,tftp={serve},bootfile=ipxe.efi",
            "-device", "virtio-net-pci,netdev=n,bootindex=1",
        ]
    return subprocess.Popen(args), sock


def monitor(sock, command):
    with socket.socket(socket.AF_UNIX) as mon:
        mon.connect(sock + ".mon")
        mon.sendall((command + "\n").encode())
        time.sleep(1)


def stop(process, _sock):
    process.terminate()
    process.wait()


def put_image(good):
    """Serves the real image, or a copy with one byte changed. Clones take no disk."""
    path = os.path.join(serve, "image.raw.zst")
    if os.path.exists(path):
        os.remove(path)
    subprocess.run(["/bin/cp", "-c", os.path.join(source, "image.raw.zst"), path], check=True)
    if not good:
        os.chmod(path, 0o644)
        with open(path, "r+b") as file:
            file.seek(os.path.getsize(path) // 2)
            byte = file.read(1)
            file.seek(-1, 1)
            file.write(bytes([byte[0] ^ 1]))


def installer():
    shutil.rmtree(serve, ignore_errors=True)
    os.makedirs(serve)
    for name in ("ipxe.efi", "kernel", "initrd"):
        subprocess.run(["/bin/cp", "-c", os.path.join(source, name), serve], check=True)
    for name, size in (("target", "60G"), ("decoy", "60G"), ("small", "2G")):
        subprocess.run(["qemu-img", "create", "-q", "-f", "qcow2", disk(name), size], check=True)
    put_image(False)

    http = subprocess.Popen(
        ["python3", "-m", "http.server", "--bind", "127.0.0.1", "8080", "--directory", serve],
        stdout=open(os.path.join(work, "http.log"), "w"), stderr=subprocess.STDOUT,
    )
    process, sock = machine("install", [("target", TARGET), ("decoy", DECOY), ("small", SMALL)])
    port = Serial(sock, os.path.join(work, "install-serial.log"))
    prompt = "press Enter to list disks again: "
    try:
        check("installer reaches its prompt by PXE", port.expect(prompt) == prompt)
        check("no disk was written before anyone typed", all(written(n) == 0 for n in ("target", "decoy", "small")))

        port.type("")
        check("empty answer asks again", port.expect(prompt, timeout=60) == prompt)
        port.type("NOT-A-SERIAL")
        check("wrong serial is refused", port.expect("No single disk has that serial", timeout=60))
        port.expect(prompt, timeout=60)
        port.type(SMALL)
        check("small disk is refused", port.expect("too small", timeout=60))
        port.expect(prompt, timeout=60)
        port.type(TARGET)
        port.expect("Type ERASE", timeout=60)
        port.type("erase")
        check("anything but ERASE stops", port.expect("Stopped. Nothing was written.", timeout=60))
        check("nothing written after those refusals", written("target") == 0)

        port.expect(prompt, timeout=60)
        port.type(TARGET)
        port.expect("Type ERASE", timeout=60)
        port.type("ERASE")
        check("changed image is refused", port.expect("digest does not match", timeout=1200))
        check("changed image wrote nothing", written("target") == 0)

        put_image(True)
        port.expect(prompt, timeout=60)
        port.type(TARGET)
        port.expect("Type ERASE", timeout=60)
        port.type("ERASE")
        result = port.expect("INSTALLED on", "CHECK FAILED", "WRITE FAILED", "Nothing was written", timeout=7200)
        check(f"good image is written and verified ({result})", result == "INSTALLED on")
        check("target holds data", written("target") > 0)
        check("the other disks are untouched", written("decoy") == 0 and written("small") == 0)
    finally:
        stop(process, sock)
        http.terminate()


def boot_written():
    process, sock = machine("boot", [("target", TARGET)], net=False)
    port = Serial(sock, os.path.join(work, "boot-serial.log"))
    try:
        check("written disk grows its state partition", port.expect("otehon-state: size", timeout=2400))
        check("first boot asks for a new passphrase", port.expect("Choose a passphrase", timeout=600))
        time.sleep(3)
        port.type("short")
        check("a short passphrase is refused", port.expect("too short", timeout=300))
        port.expect("Choose a passphrase", timeout=300)
        time.sleep(3)
        port.type(PASSPHRASE)
        port.expect("Enter the passphrase again", timeout=300)
        time.sleep(3)
        port.type(PASSPHRASE)
        check("state volume opens", port.expect("otehon-state: open", timeout=900))
        report = port.expect("OTEHON_BOOT_REPORT", timeout=2400)
        check("desktop reports its boot", report)
        monitor(sock, f"screendump {os.path.join(work, 'first-boot.png')} -f png")

        monitor(sock, "system_reset")
        check("next boot asks for the passphrase", port.expect("Passphrase for this PC", timeout=1200))
        time.sleep(3)
        port.type("not the passphrase at all")
        check("a wrong passphrase does not open it", port.expect("did not open the data", timeout=600))
        port.expect("Passphrase for this PC", timeout=300)
        time.sleep(3)
        port.type(PASSPHRASE)
        check("the right passphrase opens it", port.expect("otehon-state: open", timeout=600))
        check("desktop reports its second boot", port.expect("OTEHON_BOOT_REPORT", timeout=2400))
        monitor(sock, f"screendump {os.path.join(work, 'second-boot.png')} -f png")
        time.sleep(2)
    finally:
        stop(process, sock)


os.makedirs(work, exist_ok=True)
if stage in ("install", "all"):
    installer()
if stage in ("boot", "all") and not failures:
    boot_written()
print("FAILED: " + "; ".join(failures) if failures else "PASS", flush=True)
sys.exit(1 if failures else 0)
