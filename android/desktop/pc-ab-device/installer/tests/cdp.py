"""Minimal Chrome DevTools driver (stdlib only): navigate, press keys, read the page, screenshot."""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KEYS = {"Tab": (9, "Tab"), "Enter": (13, "Enter"), "Space": (32, "Space"), "Shift+Tab": (9, "Tab")}


def have_chrome():
    return os.path.exists(CHROME) or shutil.which("google-chrome") or shutil.which("chromium")


class Browser:
    def __init__(self, width, height):
        self.dir = tempfile.mkdtemp(prefix="awai-chrome-")
        exe = CHROME if os.path.exists(CHROME) else (shutil.which("google-chrome") or shutil.which("chromium"))
        self.proc = subprocess.Popen([exe, "--headless=new", "--remote-debugging-port=0", "--remote-allow-origins=*", f"--user-data-dir={self.dir}",
                                      "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
                                      f"--window-size={width},{height}", "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port_file = os.path.join(self.dir, "DevToolsActivePort")
        for _ in range(100):
            if os.path.exists(port_file) and len(open(port_file).read().split()) >= 2:
                break
            time.sleep(0.1)
        port = int(open(port_file).read().split()[0])
        tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        page = next(t for t in tabs if t["type"] == "page")
        self.sock = socket.create_connection(("127.0.0.1", port))
        self._handshake(page["webSocketDebuggerUrl"].split(str(port), 1)[1], port)
        self.n = 0
        self.call("Emulation.setDeviceMetricsOverride", width=width, height=height, deviceScaleFactor=1, mobile=False)
        self.call("Page.enable")

    def _handshake(self, path, port):
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf:
            buf += self.sock.recv(1)
        assert b" 101 " in buf.split(b"\r\n")[0]

    def _send(self, text):
        data = text.encode()
        head = bytearray([0x81])
        n = len(data)
        head.append(0x80 | (n if n < 126 else 126))
        if n >= 126:
            head += struct.pack(">H", n) if n < 65536 else b""
        if n >= 65536:
            head[1] = 0x80 | 127
            head += struct.pack(">Q", n)
        mask = os.urandom(4)
        self.sock.sendall(bytes(head) + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise EOFError
            buf += chunk
        return buf

    def _recv(self):
        message = b""
        while True:
            b0, b1 = self._recv_exact(2)
            n = b1 & 0x7F
            if n == 126:
                n, = struct.unpack(">H", self._recv_exact(2))
            elif n == 127:
                n, = struct.unpack(">Q", self._recv_exact(8))
            message += self._recv_exact(n)
            if b0 & 0x80:
                return message.decode()

    def call(self, method, **params):
        self.n += 1
        self._send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self._recv())
            if msg.get("id") == self.n:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def goto(self, url):
        self.call("Page.navigate", url=url)
        time.sleep(0.6)

    def eval(self, js):
        r = self.call("Runtime.evaluate", expression=js, returnByValue=True, awaitPromise=True)
        return r.get("result", {}).get("value")

    def key(self, name):
        code, label = KEYS[name]
        mods = 8 if name.startswith("Shift") else 0
        for t in ("keyDown", "keyUp"):
            extra = {"text": "\r"} if name == "Enter" and t == "keyDown" else ({"text": " "} if name == "Space" and t == "keyDown" else {})
            self.call("Input.dispatchKeyEvent", type=t if (t == "keyUp" or extra) else "rawKeyDown", key=label if name != "Space" else " ", code=label,
                      windowsVirtualKeyCode=code, modifiers=mods, **extra)
        time.sleep(0.25)

    def type(self, text):
        for ch in text:
            self.call("Input.dispatchKeyEvent", type="keyDown", text=ch, key=ch)
            self.call("Input.dispatchKeyEvent", type="keyUp", key=ch)
        time.sleep(0.2)

    def text(self):
        return self.eval("document.body.innerText")

    def focused(self):
        return self.eval("(document.activeElement.innerText || document.activeElement.id || document.activeElement.tagName).slice(0,40)")

    def wait_text(self, needle, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            if needle in (self.text() or ""):
                return True
            time.sleep(0.2)
        raise AssertionError(f"{needle!r} never appeared: {self.text()!r}")

    def fonts_used(self):
        """{(family, isCustomFont): glyph count} over every element, from Chrome's own font matching, plus the
        document.fonts status of the bundled face. A glyph drawn from a system font shows up as isCustomFont False."""
        self.call("DOM.enable")
        self.call("CSS.enable")
        root = self.call("DOM.getDocument", depth=-1)["root"]["nodeId"]
        total = {}
        for node in self.call("DOM.querySelectorAll", nodeId=root, selector="body, body *")["nodeIds"]:
            try:
                fonts = self.call("CSS.getPlatformFontsForNode", nodeId=node)["fonts"]
            except RuntimeError:
                continue
            for f in fonts:
                key = (f["familyName"], bool(f.get("isCustomFont")))
                total[key] = total.get(key, 0) + f["glyphCount"]
        faces = self.eval("Array.from(document.fonts).map(f => f.family + ':' + f.status).join(',')")
        return total, faces

    def shot(self, path):
        data = self.call("Page.captureScreenshot", format="png")["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(5)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.dir, ignore_errors=True)
