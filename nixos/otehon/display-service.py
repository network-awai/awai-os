#!/usr/bin/env python3
"""Loopback display setup for the Awai Otehon shell (AWAI-168).

Screen brightness through brightnessctl, with the last setting kept in a
root-owned state file and restored at boot, so it survives reboots.
Listens on loopback only; systemd also denies it any other address. The
shell shows an honest empty state when no backlight device exists (as in
the check VM, whose graphics have no backlight).
"""
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ["OTEHON_DISPLAY_PORT"])
STATE = Path(os.environ.get("OTEHON_DISPLAY_STATE", "/var/lib/otehon-display/brightness.json"))
# A file:// page sends the origin "null". No other page may use this service.
ALLOWED_ORIGINS = {"null"}
ACTION_TIMEOUT = 15
SYSFS = Path("/sys/class/backlight")
VALUE = re.compile(r"^\d+$")


class Refused(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def devices():
    try:
        return sorted(p.name for p in SYSFS.iterdir() if p.is_dir())
    except OSError:
        return []


def read_sys(name):
    try:
        return (SYSFS / name / "brightness").read_text().strip(), (SYSFS / name / "max_brightness").read_text().strip()
    except OSError:
        raise Refused(500, "brightness-unavailable")


def read_level():
    found = devices()
    if not found:
        return None, None
    raw, maximum = read_sys(found[0])
    if not VALUE.match(raw) or not VALUE.match(maximum) or int(maximum) <= 0:
        return None, None
    return round(int(raw) / int(maximum) * 100), found[0]


def stored():
    try:
        value = json.loads(STATE.read_text() or "{}")
        level = value.get("brightness")
        if isinstance(level, int) and 0 <= level <= 100:
            return level
    except (OSError, ValueError):
        pass
    return None


def remember(level):
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps({"brightness": level}))
    except OSError:
        pass


def clean_level(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise Refused(400, "bad-brightness")
    return value


def write_level(name, level, maximum):
    # brightnessctl rounds down, so read back the value the hardware took.
    try:
        subprocess.run(
            ["brightnessctl", "--device", name, "set", f"{level}%", "--quiet"],
            capture_output=True, text=True, timeout=ACTION_TIMEOUT, check=True,
        )
    except (subprocess.TimeoutExpired, subprocess.CalledProcessError, OSError):
        raise Refused(500, "brightness-failed")
    raw, _ = read_sys(name)
    if VALUE.match(raw):
        return round(int(raw) / maximum * 100)
    raise Refused(500, "brightness-failed")


def status():
    level, device = read_level()
    if level is None:
        return {"available": False, "brightness": None, "device": None}
    return {"available": True, "brightness": level, "device": device}


def set_brightness(body):
    level = clean_level(body.get("brightness"))
    found = devices()
    if not found:
        raise Refused(503, "no-adapter")
    _, maximum = read_sys(found[0])
    if not VALUE.match(maximum) or int(maximum) <= 0:
        raise Refused(503, "no-adapter")
    taken = write_level(found[0], level, int(maximum))
    remember(taken)
    return {"ok": True, "brightness": taken}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
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

    def allowed(self):
        origin = self.headers.get("Origin")
        host = self.headers.get("Host", "")
        # The Host check stops a web page from reaching this port through DNS rebinding.
        if host != f"127.0.0.1:{PORT}":
            self.refuse_and_close("bad-host")
            return False
        if origin is not None and origin not in ALLOWED_ORIGINS:
            self.refuse_and_close("bad-origin")
            return False
        return True

    def refuse_and_close(self, reason):
        # The body is unread, so it must not be taken for the next request on this connection.
        self.close_connection = True
        self.reply(403, {"error": reason})

    def do_OPTIONS(self):
        self.send_response(204 if self.headers.get("Origin") in ALLOWED_ORIGINS else 403)
        self.send_header("Content-Length", "0")
        self.cors()
        self.end_headers()

    def body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > 512:
            raise Refused(413, "bad-json")
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            raise Refused(400, "bad-json")
        if not isinstance(value, dict):
            raise Refused(400, "bad-json")
        return value

    def do_GET(self):
        if not self.allowed():
            return
        try:
            if self.path == "/v1/status":
                self.reply(200, status())
            else:
                self.reply(404, {"error": "not-found"})
        except Refused as refused:
            self.reply(refused.status, {"error": refused.reason})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def do_POST(self):
        if not self.allowed():
            return
        try:
            body = self.body()
            if self.path == "/v1/brightness":
                self.reply(200, set_brightness(body))
            else:
                self.reply(404, {"error": "not-found"})
        except Refused as refused:
            self.reply(refused.status, {"error": refused.reason})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_message(self, format, *args):
        # Requests and settings stay out of the journal.
        pass


def restore():
    """Apply the stored brightness at boot so the setting survives reboots."""
    saved = stored()
    if saved is None:
        return
    found = devices()
    if not found:
        return
    try:
        _, maximum = read_sys(found[0])
        if VALUE.match(maximum) and int(maximum) > 0:
            write_level(found[0], saved, int(maximum))
    except Refused:
        pass


if __name__ == "__main__":
    restore()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
