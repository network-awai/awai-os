"""Scratch-target first boot verification; no guest shell, SSH or external network."""
import json
import os
import socket
import struct
import subprocess
import time
import unicodedata
from pathlib import Path


def normalized_ocr(text):
    # OCR emits compatibility glyphs such as circled 12 for ordinary UI digits.
    # This applies to displayed-label matching only, never bytes, IDs or input.
    return ''.join(unicodedata.normalize('NFKC',text).lower().split())

def screen_matches(text, markers):
    compact=normalized_ocr(text)
    return all(normalized_ocr(marker) in compact for marker in markers)


def read_screen(ppm, png):
    text = subprocess.check_output(["tesseract", str(ppm), "stdout", "-l", os.environ.get("OTEHON_OCR_LANG", "eng")], text=True, stderr=subprocess.DEVNULL)
    # Full-page segmentation misses the white-on-dark onboarding button.
    # Retain both required labels; separately OCR its central lower viewport region.
    header = png.read_bytes()[:24]
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("invalid screenshot header")
    width, height = struct.unpack(">II", header[16:24])
    crop = subprocess.check_output(["pamcut", f"-left={width // 4}", f"-top={height // 2}",
                                    f"-width={width // 2}", f"-height={max(1,height // 5)}", str(ppm)])
    region = subprocess.check_output(["tesseract", "stdin", "stdout", "--psm", "6"], input=crop, stderr=subprocess.DEVNULL).decode()
    sparse = subprocess.check_output(["tesseract", str(ppm), "stdout", "--psm", "11", "-l", os.environ.get("OTEHON_OCR_LANG", "eng")], text=True, stderr=subprocess.DEVNULL)
    # Isolate the inner completion button, remove its border, and enlarge a
    # binary inverse. Full-page OCR drops white-on-blue CJK control labels.
    footer = subprocess.check_output(["pamcut", f"-left={max(0,width-270)}", f"-top={max(0,height-58)}",
                                      f"-width={min(236,width)}", f"-height={min(44,height)}", str(ppm)])
    gray = subprocess.check_output(["ppmtopgm"], input=footer)
    binary = subprocess.check_output(["pgmtopbm", "-threshold", "-value", "0.5"], input=gray)
    inverted = subprocess.check_output(["pnminvert"], input=binary)
    enlarged = subprocess.check_output(["pamenlarge", "3"], input=inverted)
    footer_text = subprocess.check_output(["tesseract", "stdin", "stdout", "--psm", "7", "-l", os.environ.get("OTEHON_OCR_LANG", "eng")], input=enlarged, stderr=subprocess.DEVNULL).decode()
    return text + "\n--- central control region ---\n" + region + "\n--- sparse controls ---\n" + sparse + "\n--- right footer control ---\n" + footer_text


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
        png = self.out / f"{self.phase}-screen.png"
        with png.open("wb") as dest:
            subprocess.run(["pnmtopng", str(image)], stdout=dest, check=True)
        text = read_screen(image, png)
        (self.out / f"{self.phase}-screen.txt").write_text(text)
        image.unlink()
        return " ".join(text.lower().split())

    def expect(self, strings, label, timeout=300, fatal=()):
        end = time.monotonic() + timeout
        last = ""
        last_log = 0
        while time.monotonic() < end:
            if self.process.poll() is not None:
                raise RuntimeError(f"installed QEMU exited while waiting for {label}")
            last = self.capture()
            if time.monotonic()-last_log >= 30:
                print(f"VISIBLE_VM {self.phase} wait={label}: {last[:900]} ... {last[-350:]}", flush=True)
                last_log=time.monotonic()
            if any(screen_matches(last,[s]) for s in fatal):
                raise RuntimeError(f"visible failure during {label}: {last[-3000:]}")
            if screen_matches(last,strings):
                print("INSTALLED_VM " + label, flush=True)
                # Keep each successful transition, rather than only the last screen.
                for ext in ("png", "txt"):
                    source = self.out / f"{self.phase}-screen.{ext}"
                    (self.out / f"{self.phase}-{label}.{ext}").write_bytes(source.read_bytes())
                return
            time.sleep(2)
        raise TimeoutError(f"installed boot: {label}; last screen: {last[-3000:]}")

    def click(self, x, y, width, height):
        self.qmp("input-send-event", {"events":[
            {"type":"abs","data":{"axis":"x","value":int(x*32767/width)}},
            {"type":"abs","data":{"axis":"y","value":int(y*32767/height)}}]})
        for down in (True,False):
            self.qmp("input-send-event", {"events":[{"type":"btn","data":{"down":down,"button":"left"}}]})
            time.sleep(.15)

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


def verify_installed(out, sockets, code, variables, checks, target_bus="virtio", graphical_state=False):
    # Only the disk just installed by the test is attached. No USB, decoy or host disk.
    fixture = "otehon-vm-fixture-passphrase"
    def boot(phase):
        serial, qmp = sockets / (phase + ".serial"), sockets / (phase + ".qmp")
        command = ["qemu-system-x86_64", "-enable-kvm", "-machine", "q35", "-cpu", "host", "-vga", "virtio",
                   "-m", "4096", "-smp", "2", "-display", "none", "-nic", "none",
                   "-drive", f"if=pflash,format=raw,readonly=on,file={code}",
                   "-drive", f"if=pflash,format=raw,file={variables}",
                   "-drive", f"if=none,id=installed,format=qcow2,file={out / 'target.qcow2'},discard=unmap,detect-zeroes=unmap",
                   "-device", f"{'nvme' if target_bus == 'nvme' else 'virtio-blk-pci'},drive=installed,serial=OTEHON-USB-TARGET,bootindex=1",
                   "-serial", f"unix:{serial},server=on,wait=off", "-qmp", f"unix:{qmp},server=on,wait=off"]
        return VisualGuest(command, serial, qmp, out, phase)
    guest = boot("first-boot")
    try:
        guest.expect(["Awai", "データを保護", "12文字以上"] if graphical_state else ["choose a passphrase"], "choose-passphrase")
        checks.append("installed target boots UEFI without installer attached")
        guest.type_fixture(fixture)
        guest.expect(["同じパスフレーズ"] if graphical_state else ["enter the passphrase again"], "confirm-passphrase")
        guest.type_fixture(fixture)
        guest.expect(["hello", "get started"], "desktop", timeout=600)
        checks.append("first boot provisions encrypted state and displays actual desktop onboarding")
        guest.qmp("system_powerdown")
        guest.process.wait(timeout=90)
    finally:
        guest.close()
    guest = boot("second-boot")
    try:
        guest.expect(["Awai", "データを解除", "パスフレーズ"] if graphical_state else ["passphrase for this pc"], "unlock-state")
        guest.type_fixture(fixture)
        guest.expect(["hello", "get started"], "desktop", timeout=600)
        checks.append("cold QEMU restart unlocks existing encrypted state and returns to desktop")
    finally:
        guest.close()


def verify_graphical_install(command, serial, qmp, out, checks, untouched, written):
    """Only QMP mouse/keyboard input; never invoke the broker or a guest shell."""
    guest = VisualGuest(command, serial, qmp, out, 'installer')
    def key(value): guest.qmp('human-monitor-command', {'command-line':'sendkey '+value})
    def type_text(value):
        for c in value:
            if c == '-': code='minus'
            elif c.isascii() and c.isalpha(): code=('shift-' if c.isupper() else '')+c.lower()
            elif c.isdigit(): code=c
            else: raise ValueError('non-fixture character')
            key(code);time.sleep(.06)
    def footer():
        guest.capture()
        header=(out/'installer-screen.png').read_bytes()[:24]
        width,height=struct.unpack('>II',header[16:24])
        guest.click(width-155,height-36,width,height)
        time.sleep(1)
    def click_text(needle):
        guest.capture()
        png=out/'installer-screen.png'
        tsv=subprocess.check_output(['tesseract',str(png),'stdout','-l','eng+jpn','--psm','11','tsv'],stderr=subprocess.DEVNULL,text=True)
        import csv,io
        rows=list(csv.DictReader(io.StringIO(tsv),delimiter='\t'))
        found=[r for r in rows if normalized_ocr(needle) in normalized_ocr(r.get('text') or '')]
        if len(found)!=1: raise AssertionError('screen control not unique: '+needle)
        r=found[0];width,height=struct.unpack('>II',png.read_bytes()[16:24])
        guest.click(int(r['left'])+int(r['width'])//2,int(r['top'])+int(r['height'])//2,width,height)
        time.sleep(1)
    try:
        guest.expect(['Awai','インストール'], 'welcome', timeout=420)
        untouched();checks.append('graphical installer boots offline without target writes')
        footer()
        guest.expect(['TARGET','DECOY','SMALL'], 'disk-selection', timeout=60)
        # The source and undersized disk are visibly unavailable; clicking either
        # must not enter the destructive confirmation page or write anything.
        click_text('SMALL');untouched()
        guest.expect(['TARGET','DECOY','SMALL'], 'undersize-disabled', timeout=60)
        click_text('MEDIUM');untouched()
        guest.expect(['TARGET','DECOY','SMALL'], 'source-disabled', timeout=60)
        click_text('TARGET')
        guest.expect(['ERASE','TARGET'], 'overwrite-confirmation', timeout=60)
        type_text('WRONG-SERIAL');key('tab');type_text('ERASE');footer();untouched()
        guest.expect(['ERASE','TARGET'], 'mismatch-disabled', timeout=60)
        key('shift-tab');key('ctrl-a');type_text('OTEHON-USB-TARGET')
        guest.capture()
        # Selection and exact typed approval occur through the displayed UI.
        footer()
        failures=['完了できませんでした','書込み前の確認に失敗','approval-stale','approval-expired','target-changed','target-in-use']
        guest.expect(['実際の処理状況'], 'approval-accepted',timeout=60, fatal=failures)
        guest.expect(['照合','NVMe'], 'readback-observed',timeout=2100, fatal=failures)
        # A readback page alone is insufficient. Require the unique completion
        # title AND the displayed power-off control, including footer-region OCR.
        guest.expect(['インストールが完了しました','電源を切る'], 'poweroff-ready',timeout=2100, fatal=failures)
        if written('target')==0 or written('decoy') or written('small'):
            raise AssertionError('graphical installer changed incorrect scratch scope')
        checks.append('mouse selection and exact keyboard approval install scratch NVMe; full readback completes; decoys unchanged')
        footer();guest.process.wait(timeout=90)
        checks.append('verified completion screen powers off via displayed control')
    finally:
        guest.close()
