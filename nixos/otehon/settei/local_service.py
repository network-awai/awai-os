"""A loopback JSON service that answers only the shell page, run by the desktop user.

Every request must:
- name this service's own Host (no DNS rebinding from a web page),
- come from the shell's file:// page (Origin "null") or carry no Origin,
- come from a TCP connection opened by the desktop user (loopback_peer.peer_uid).
Each refusal and each action is written to stdout, which systemd puts in the journal, as one
line starting with OTEHON_SETTEI_AUDIT.
"""
import json
import os
import pwd
from http.server import BaseHTTPRequestHandler

from loopback_peer import peer_uid

ALLOWED_ORIGINS = {"null"}
MAX_BODY = 1024


class Refused(Exception):
    def __init__(self, status, reason):
        super().__init__(reason)
        self.status = status
        self.reason = reason


def audit(service, action, **fields):
    parts = " ".join(f"{name}={json.dumps(value)[:80] if isinstance(value, str) else value}" for name, value in fields.items())
    print(f"OTEHON_SETTEI_AUDIT service={service} action={action} {parts}", flush=True)


def desktop_uid():
    return pwd.getpwnam(os.environ["OTEHON_DESKTOP_USER"]).pw_uid


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    service = "local"
    port = 0
    allowed_uid = -1
    peer_table = "/proc/net/tcp"
    routes = {}

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if self.close_connection:
            self.send_header("Connection", "close")
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def cors(self):
        if self.headers.get("Origin") in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", "null")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        # A preflight carries no body and changes nothing.
        self.send_response(204 if self.headers.get("Origin") in ALLOWED_ORIGINS else 403)
        self.send_header("Content-Length", "0")
        self.cors()
        self.end_headers()

    def check(self):
        if self.headers.get("Host", "") != f"127.0.0.1:{self.port}":
            raise Refused(403, "bad-host")
        origin = self.headers.get("Origin")
        if origin is not None and origin not in ALLOWED_ORIGINS:
            raise Refused(403, "bad-origin")
        client = self.client_address[:2]
        uid = peer_uid(client, ("127.0.0.1", self.port), self.peer_table)
        if uid != self.allowed_uid:
            raise Refused(403, "not-desktop-user")
        return uid

    def body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise Refused(400, "bad-length")
        if length < 0 or length > MAX_BODY:
            raise Refused(413, "body-too-large")
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise Refused(400, "bad-json")
        if not isinstance(value, dict):
            raise Refused(400, "bad-json")
        return value

    def handle_route(self, method):
        uid = None
        try:
            uid = self.check()
            route = self.routes.get((method, self.path))
            if route is None:
                raise Refused(404, "not-found")
            status, body = route(self, uid)
            self.reply(status, body)
        except Refused as refused:
            if method == "POST":
                # The body is unread, so it must not be taken for the next request.
                self.close_connection = True
            audit(self.service, "refused", method=method, path=self.path[:64], uid=uid, reason=refused.reason)
            self.reply(refused.status, {"error": refused.reason})

    def do_GET(self):
        self.handle_route("GET")

    def do_POST(self):
        self.handle_route("POST")

    def log_message(self, format, *args):
        pass
