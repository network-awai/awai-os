"""Minimal Marionette client (stdlib) and a headless Firefox launcher. Headless only: no window is ever shown."""
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time

DEFAULT_APP = os.path.expanduser("~/awai-ff-test/app/Firefox.app")


def app_path():
    p = os.environ.get("AWAI_FIREFOX_APP", DEFAULT_APP)
    return p if os.path.exists(os.path.join(p, "Contents", "MacOS", "firefox")) else None


class Client:
    def __init__(self, port, timeout=60):
        end = time.time() + timeout
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                self.sock.settimeout(60)
                self.read()  # hello
                break
            except (OSError, ValueError):
                if time.time() > end:
                    raise
                time.sleep(0.3)
        self.n = 0

    def read(self):
        head = b""
        while not head.endswith(b":"):
            c = self.sock.recv(1)
            if not c:
                raise EOFError
            head += c
        size = int(head[:-1])
        data = b""
        while len(data) < size:
            data += self.sock.recv(size - len(data))
        return json.loads(data)

    def call(self, name, **params):
        self.n += 1
        msg = json.dumps([0, self.n, name, params]).encode()
        self.sock.sendall(str(len(msg)).encode() + b":" + msg)
        while True:
            r = self.read()
            if isinstance(r, list) and r[0] == 1 and r[1] == self.n:
                if r[2]:
                    raise RuntimeError(r[2])
                return r[3]

    def chrome(self, script, *args):
        return self.call("WebDriver:ExecuteScript", script=script, args=list(args))["value"]


class Firefox:
    """Headless Firefox with the kiosk configuration installed into a private copy of the app's Resources."""
    def __init__(self, work, launch_url, with_kiosk=True, port=None):
        self.app = app_path()
        self.dir = tempfile.mkdtemp(prefix="awai-ff-")
        self.profile = os.path.join(self.dir, "profile")
        os.makedirs(self.profile)
        self.port = port or free_port()
        res = os.path.join(self.app, "Contents", "Resources")
        self._installed = []
        if with_kiosk:
            inst = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            home = launch_url
            swap = lambda t: t.replace("file:///run/awai-pc-installer/launch.html", home)
            # the test needs Marionette, which the real policy's developer-tools switch would also shut off
            policy = swap(open(os.path.join(inst, "firefox-policies.json")).read()).replace('"DisableDeveloperTools": true', '"DisableDeveloperTools": false')
            self.put(os.path.join(res, "defaults", "pref", "autoconfig.js"), open(os.path.join(inst, "kiosk", "autoconfig.js")).read())
            self.put(os.path.join(res, "mozilla.cfg"), swap(open(os.path.join(inst, "kiosk", "mozilla.cfg")).read()))
            self.put(os.path.join(res, "distribution", "policies.json"), policy)
        with open(os.path.join(self.profile, "user.js"), "w") as f:
            f.write(f'user_pref("marionette.port", {self.port});\nuser_pref("marionette.enabled", true);\n'
                    'user_pref("browser.shell.checkDefaultBrowser", false);\nuser_pref("datareporting.policy.dataSubmissionEnabled", false);\n')
        env = dict(os.environ, MOZ_HEADLESS="1")
        self.proc = subprocess.Popen([os.path.join(self.app, "Contents", "MacOS", "firefox"), "--headless", "--marionette", "--remote-allow-system-access", "--no-remote",
                                      "--profile", self.profile, launch_url], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.client = Client(self.port)
            self.client.call("WebDriver:NewSession", capabilities={})
            self.client.call("Marionette:SetContext", value="chrome")
        except Exception:
            self.close()
            raise

    def put(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        existed = os.path.exists(path)
        backup = open(path).read() if existed else None
        with open(path, "w") as f:
            f.write(text)
        self._installed.append((path, backup))

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(10)
        except Exception:
            self.proc.kill()
        for path, backup in reversed(self._installed):
            if backup is None:
                os.unlink(path)
            else:
                open(path, "w").write(backup)
        shutil.rmtree(self.dir, ignore_errors=True)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port
