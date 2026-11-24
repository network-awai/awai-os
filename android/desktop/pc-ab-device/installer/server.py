#!/usr/bin/env python3
"""Local backend of the Awai OS screen installer (stdlib only).

Binds 127.0.0.1 on a random port. A per-start random token is written only into DIR/launch.html (mode
0600, DIR mode 0700) as a URL fragment: it is never in argv, a log, a request line or a world-readable
file, and the fragment is never sent to a server. Every /api request needs the token header, an exact
Host, and (for POST, and when present on GET) the exact Origin. No CORS headers are ever sent.

  server.py --work-dir DIR --media-dir DIR [--web-dir DIR]

The install itself runs in a detached worker process (core.py worker) that holds a lock file, so closing
or crashing the browser, or this server, neither stops the write nor allows a second one.
"""
import argparse
import json
import os
import secrets
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CSP = ("default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; "
       "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
STATIC = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8"), "/logo.png": ("logo.png", "image/png"),
          "/font.woff2": ("noto-jp.woff2", "font/woff2")}
FONT_FALLBACK = os.path.join(HERE, "..", "..", "..", "client", "assets", "setup-noto-jp.woff2")
MAX_BODY = 4096


class App:
    def __init__(self, work, media, web=None, host=None, worker_cmd=None):
        self.work, self.media = work, media
        self.web = web or os.path.join(HERE, "web")
        self.host = host or core.Host()
        self.worker_cmd = worker_cmd or [sys.executable, os.path.join(HERE, "core.py"), "worker",
                                         "--work-dir", work, "--media-dir", media]
        self.token = secrets.token_urlsafe(32)
        self.ticket = None
        self.proc = None
        self.mutex = threading.Lock()
        core.ensure_work(work)

    # -- state
    def starting(self):
        return self.proc is not None and self.proc.poll() is None

    def state(self):
        st = core.status(self.work, starting=False)
        if self.starting() and st.get("state") != "running":
            st = dict(st, state="running", step=st.get("step", 1))
        if self.proc is not None and self.proc.poll() is not None and st.get("state") == "idle":
            st = dict(st, state="idle", workerExit=self.proc.returncode)
        return st

    def busy(self):
        return self.starting() or core.lock_held(self.work) or self.state().get("state") == "running"

    # -- operations (each returns (http status, json))
    def disks(self):
        return 200, {"disks": core.list_disks(self.host, self.media)}

    def review(self, body):
        name = body.get("device")
        if not isinstance(name, str) or "/" in name:
            return 400, {"error": "bad-request"}
        with self.mutex:
            if self.busy():
                return 409, {"error": "busy", "ja": core.MESSAGES["busy"][0]}
            if core.write_started(self.work):
                return 409, {"error": "record-exists", "ja": core.MESSAGES["record-exists"][0]}
            try:
                ident = core.confirm_target(self.host, self.media, name)
            except core.Refusal as e:
                return 409, {"error": e.code, "ja": core.MESSAGES[e.code][0]}
            self.ticket = {"id": secrets.token_urlsafe(16), "device": name, "identity": ident}
            return 200, {"ticket": self.ticket["id"], "device": name, "identity": ident}

    def install(self, body):
        with self.mutex:
            ticket, self.ticket = self.ticket, None  # one-shot, consumed whatever happens next
            if not ticket or body.get("ticket") != ticket["id"]:
                return 409, {"error": "no-ticket", "ja": core.MESSAGES["no-ticket"][0]}
            if body.get("typed") != ticket["device"]:
                return 409, {"error": "typed-name", "ja": core.MESSAGES["typed-name"][0]}
            if self.busy():
                return 409, {"error": "busy", "ja": core.MESSAGES["busy"][0]}
            if core.write_started(self.work):
                return 409, {"error": "record-exists", "ja": core.MESSAGES["record-exists"][0]}
            core.ensure_work(self.work)
            for stale in ("state.json",):
                try:
                    os.unlink(os.path.join(self.work, stale))
                except FileNotFoundError:
                    pass
            fd = os.open(os.path.join(self.work, "request.json"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump({"device": ticket["device"], "typed": body["typed"], "identity": ticket["identity"]}, f)
            self.proc = subprocess.Popen(self.worker_cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                         stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
            return 202, {"started": True}

    def dismiss(self):
        """Leave a failure screen that wrote nothing; a failure after writing stays until reboot."""
        with self.mutex:
            st = self.state()
            if st.get("state") != "failed" or st.get("written") != "none" or self.busy():
                return 409, {"error": "not-dismissable"}
            os.unlink(os.path.join(self.work, "state.json"))
            return 200, {"ok": True}

    def power(self, action):
        with self.mutex:
            if self.busy():
                return 409, {"error": "busy", "ja": core.MESSAGES["busy"][0]}
            r = self.host.run(["systemctl", action])
            return (200, {"ok": True}) if r.returncode == 0 else (500, {"error": "power-failed"})

    def write_launch_file(self, port):
        """The only place the token is written. Firefox is started with this file's path, not the token."""
        path = os.path.join(self.work, "launch.html")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        url = f"http://127.0.0.1:{port}/#{self.token}"
        with os.fdopen(fd, "w") as f:
            f.write('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=%s"><title>Awai OS</title>' % url)
        return path


def make_handler(app, port):
    allowed_host = f"127.0.0.1:{port}"
    allowed_origin = f"http://{allowed_host}"

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"
        server_version = "AwaiInstaller"
        sys_version = ""

        def log_message(self, fmt, *args):  # request line only, no headers, no bodies
            sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

        def _send(self, status, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Content-Security-Policy", CSP)
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(data)

        def _guard(self, post):
            if self.headers.get("Host") != allowed_host:
                self._send(403, {"error": "host"})
                return False
            origin = self.headers.get("Origin")
            if (post and origin is None) or (origin is not None and origin != allowed_origin):
                self._send(403, {"error": "origin"})
                return False
            return True

        def _api_guard(self, post):
            if not self._guard(post):
                return False
            token = self.headers.get("X-Awai-Token", "")
            if not secrets.compare_digest(token.encode(), app.token.encode()):
                self._send(403, {"error": "token"})
                return False
            return True

        def do_GET(self):
            path = self.path.split("?")[0]
            if path in STATIC:
                if not self._guard(False):
                    return
                name, ctype = STATIC[path]
                for candidate in (os.path.join(app.web, name), FONT_FALLBACK if name == "noto-jp.woff2" else None):
                    if candidate and os.path.isfile(candidate):
                        with open(candidate, "rb") as f:
                            return self._send(200, f.read(), ctype)
                return self._send(404, {"error": "missing"})
            if not path.startswith("/api/"):
                return self._send(404, {"error": "not-found"})
            if not self._api_guard(False):
                return
            if path == "/api/disks":
                return self._send(*app.disks())
            if path == "/api/install":
                return self._send(200, app.state())
            self._send(404, {"error": "not-found"})

        def do_POST(self):
            path = self.path.split("?")[0]
            if not path.startswith("/api/"):
                return self._send(404, {"error": "not-found"})
            if not self._api_guard(True):
                return
            if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
                return self._send(415, {"error": "content-type"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 <= length <= MAX_BODY:
                    raise ValueError
                body = json.loads(self.rfile.read(length) or b"{}")
                if not isinstance(body, dict):
                    raise ValueError
            except ValueError:
                return self._send(400, {"error": "bad-request"})
            routes = {"/api/review": lambda: app.review(body), "/api/install": lambda: app.install(body),
                      "/api/dismiss": app.dismiss, "/api/poweroff": lambda: app.power("poweroff"),
                      "/api/reboot": lambda: app.power("reboot")}
            if path not in routes:
                return self._send(404, {"error": "not-found"})
            self._send(*routes[path]())

    return Handler


def make_server(app):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), BaseHTTPRequestHandler)
    port = httpd.server_address[1]
    httpd.RequestHandlerClass = make_handler(app, port)
    return httpd, port


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", default=core.DEFAULT_WORK)
    ap.add_argument("--media-dir", default=core.DEFAULT_MEDIA)
    ap.add_argument("--web-dir")
    a = ap.parse_args(argv)
    app = App(a.work_dir, a.media_dir, a.web_dir)
    httpd, port = make_server(app)
    launch = app.write_launch_file(port)
    print(launch, flush=True)  # the path, never the token
    httpd.serve_forever()


if __name__ == "__main__":
    main()
