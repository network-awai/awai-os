"""Scratch-target first boot verification; no guest shell, SSH or external network."""
import json
import socket
import subprocess
import time
from pathlib import Path


class VisualGuest:
    def __init__(self, command, serial, qmp, out, phase):
        self.out, self.phase, self.qmp_path = out, phase, qmp
        self.transcript = bytearray()
        self.port = None
        self.log = (out / f"{phase}-qemu.log").open("wb")
        self.process = subprocess.Popen(command, stdout=self.log, stderr=self.log)
        end = time.monotonic() + 30
        while not serial.exists():
            if self.process.poll() is not None or time.monotonic() >= end:
                self.close()
                raise RuntimeError("installed QEMU did not start")
            time.sleep(.1)
        self.port = socket.socket(socket.AF_UNIX)
        self.port.connect(str(serial))
        self.port.settimeout(.05)

    def qmp(self, name, arguments=None):
        with socket.socket(socket.AF_UNIX) as sock:
            sock.settimeout(10)
            sock.connect(str(self.qmp_path))
            with sock.makefile("rwb", buffering=0) as stream:
                stream.readline()
                def call(operation, args):
                    stream.write((json.dumps({"execute": operation, "arguments": args}) + "\n").encode())
                    while True:
                        reply = json.loads(stream.readline())
                        if "error" in reply:
                            raise RuntimeError(str(reply["error"]))
                        if "return" in reply:
                            return reply["return"]
                call("qmp_capabilities", {})
                return call(name, arguments or {})

    def capture(self):
        if self.port:
            try:
                while True:
                    data = self.port.recv(65536)
                    if not data:
                        break
                    self.transcript.extend(data)
            except socket.timeout:
                pass
        (self.out / f"{self.phase}-console.txt").write_bytes(self.transcript)
        image = self.out / f"{self.phase}-screen.ppm"
        self.qmp("screendump", {"filename": str(image)})
        text = subprocess.check_output(["tesseract", str(image), "stdout"], text=True, stderr=subprocess.DEVNULL)
        (self.out / f"{self.phase}-screen.txt").write_text(text)
        with (self.out / f"{self.phase}-screen.png").open("wb") as dest:
            subprocess.run(["pnmtopng", str(image)], stdout=dest, check=True)
        image.unlink()
        return " ".join(text.lower().split())

    def expect(self, strings, label, timeout=300):
        end = time.monotonic() + timeout
        last = ""
        while time.monotonic() < end:
            if self.process.poll() is not None:
                raise RuntimeError(f"installed QEMU exited while waiting for {label}")
            last = self.capture()
            if all(s.lower() in last for s in strings):
                print("INSTALLED_VM " + label, flush=True)
                # Keep each successful transition, rather than only the last screen.
                for ext in ("png", "txt"):
                    source = self.out / f"{self.phase}-screen.{ext}"
                    (self.out / f"{self.phase}-{label}.{ext}").write_bytes(source.read_bytes())
                return
            time.sleep(2)
        raise TimeoutError(f"installed boot: {label}; last screen: {last[-3000:]}")

    def type_fixture(self, text):
        # Only public fixed ASCII fixture strings, never owner credentials.
        if any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in text):
            raise ValueError("unsupported fixture key")
        for char in text:
            key = "minus" if char == "-" else char
            self.qmp("human-monitor-command", {"command-line": "sendkey " + key})
            time.sleep(.06)
        self.qmp("human-monitor-command", {"command-line": "sendkey ret"})

    def close(self):
        if self.process.poll() is None:
            try:
                self.capture()
            except Exception:
                pass
            self.process.terminate()
            try:
                self.process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=10)
        if self.port:
            self.port.close()
        self.log.close()


def verify_installed(out, sockets, code, variables, checks):
    # Only the disk just installed by the test is attached. No USB, decoy or host disk.
    fixture = "otehon-vm-fixture-passphrase"
    def boot(phase):
        serial, qmp = sockets / (phase + ".serial"), sockets / (phase + ".qmp")
        command = ["qemu-system-x86_64", "-enable-kvm", "-machine", "q35", "-cpu", "host", "-vga", "virtio",
                   "-m", "4096", "-smp", "2", "-display", "none", "-nic", "none",
                   "-drive", f"if=pflash,format=raw,readonly=on,file={code}",
                   "-drive", f"if=pflash,format=raw,file={variables}",
                   "-drive", f"if=none,id=installed,format=qcow2,file={out / 'target.qcow2'},discard=unmap,detect-zeroes=unmap",
                   "-device", "virtio-blk-pci,drive=installed,serial=OTEHON-USB-TARGET,bootindex=1",
                   "-serial", f"unix:{serial},server=on,wait=off", "-qmp", f"unix:{qmp},server=on,wait=off"]
        return VisualGuest(command, serial, qmp, out, phase)
    guest = boot("first-boot")
    try:
        guest.expect(["choose a passphrase"], "choose-passphrase")
        checks.append("installed target boots UEFI without installer attached")
        guest.type_fixture(fixture)
        guest.expect(["enter the passphrase again"], "confirm-passphrase")
        guest.type_fixture(fixture)
        guest.expect(["hello", "get started"], "desktop", timeout=600)
        checks.append("first boot provisions encrypted state and displays actual desktop onboarding")
        guest.qmp("system_powerdown")
        guest.process.wait(timeout=90)
    finally:
        guest.close()
    guest = boot("second-boot")
    try:
        guest.expect(["passphrase for this pc"], "unlock-state")
        guest.type_fixture(fixture)
        guest.expect(["hello", "get started"], "desktop", timeout=600)
        checks.append("cold QEMU restart unlocks existing encrypted state and returns to desktop")
    finally:
        guest.close()
