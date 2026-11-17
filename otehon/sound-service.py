#!/usr/bin/env python3
"""Loopback sound setup for the Awai Otehon shell (AWAI-168).

System volume and mute through PipeWire's wpctl, with the last setting kept
in a root-owned state file so a joined volume survives reboots. Listens on
loopback only; systemd also denies it any other address. The shell shows an
honest empty state when no output device exists (as in the check VM, whose
PipeWire has no sinks).
"""
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ["OTEHON_SOUND_PORT"])
USER = os.environ.get("OTEHON_SOUND_USER", "otehon")
STATE = Path(os.environ.get("OTEHON_SOUND_STATE", "/var/lib/otehon-sound/volume.json"))
# A file:// page sends the origin "null". No other page may use this service.
ALLOWED_ORIGINS = {"null"}
ACTION_TIMEOUT = 15
VOLUME = re.compile(r"^Volume:\s+([0-9]+(?:\.[0-9]+)?)(\s+\[MUTED\])?\s*$")
SINK_MARK = re.compile(r"^\s*[│├└─\s]*\*\s*\d+\.\s*(.+?)(?:\s*\[.*\])?\s*$")


class Refused(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def runtime_dir():
    try:
        uid = int(subprocess.run(["id", "-u", USER], capture_output=True, text=True, timeout=5).stdout.strip())
    except (ValueError, subprocess.SubprocessError, OSError):
        raise Refused(500, "sound-unavailable")
    path = Path(f"/run/user/{uid}")
    if not path.is_dir():
        raise Refused(503, "no-session")
    return str(path)


def wpctl(*argv):
    env = dict(os.environ, XDG_RUNTIME_DIR=runtime_dir())
    try:
        done = subprocess.run(["wpctl", *argv], capture_output=True, text=True, timeout=ACTION_TIMEOUT, env=env)
    except subprocess.TimeoutExpired:
        raise Refused(504, "command-timeout")
    except OSError:
        raise Refused(500, "command-unavailable")
    if done.returncode != 0:
        raise Refused(500, "sound-unavailable")
    return done.stdout


def read_sink():
    """The default sink's volume, mute flag and name, or Nones without one."""
    try:
        out = wpctl("get-volume", "@DEFAULT_AUDIO_SINK@")
    except Refused as refused:
        if refused.reason in ("no-session", "sound-unavailable"):
            return None, None, None
        raise
    match = VOLUME.match(out.strip())
    if not match:
        return None, None, None
    try:
        names = wpctl("status").splitlines()
    except Refused:
        names = []
    sink, in_sinks = None, False
    for line in names:
        text = line.strip()
        if text == "Sinks:":
            in_sinks = True
        elif text in ("Sources:", "Filters:", "Streams:", "Sinks") or (text.endswith(":") and " " not in text):
            in_sinks = False
        elif in_sinks:
            mark = SINK_MARK.match(line)
            if mark:
                sink = mark.group(1)
    return round(float(match.group(1)) * 100), match.group(2) is not None, sink


def stored():
    try:
        value = json.loads(STATE.read_text() or "{}")
        volume = value.get("volume")
        muted = value.get("muted")
        if isinstance(volume, int) and 0 <= volume <= 100 and isinstance(muted, bool):
            return volume, muted
    except (OSError, ValueError):
        pass
    return None


def remember(volume, muted):
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        STATE.write_text(json.dumps({"volume": volume, "muted": muted}))
    except OSError:
        pass


def clean_volume(value):
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        raise Refused(400, "bad-volume")
    return value


def clean_mute(value):
    if value is not True and value is not False:
        raise Refused(400, "bad-mute")
    return value


def status():
    volume, muted, sink = read_sink()
    if volume is None:
        return {"available": False, "volume": None, "muted": None, "sink": None}
    return {"available": True, "volume": volume, "muted": muted, "sink": sink}


def set_volume(body):
    volume = clean_volume(body.get("volume"))
    live, _, _ = read_sink()
    if live is None:
        raise Refused(503, "no-adapter")
    try:
        wpctl("set-volume", "@DEFAULT_AUDIO_SINK@", f"{volume / 100:.2f}")
    except Refused as refused:
        raise Refused(500, "volume-failed") if refused.reason == "sound-unavailable" else refused
    _, muted, _ = read_sink()
    remember(volume, muted is True)
    return {"ok": True, "volume": volume}


def set_mute(body):
    on = clean_mute(body.get("on"))
    live, _, _ = read_sink()
    if live is None:
        raise Refused(503, "no-adapter")
    try:
        wpctl("set-mute", "@DEFAULT_AUDIO_SINK@", "1" if on else "0")
    except Refused as refused:
        raise Refused(500, "mute-failed") if refused.reason == "sound-unavailable" else refused
    _, muted, _ = read_sink()
    volume, _, _ = read_sink()
    remember(volume if volume is not None else 0, muted is True)
    return {"ok": True, "muted": muted is True}


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
            if self.path == "/v1/volume":
                self.reply(200, set_volume(body))
            elif self.path == "/v1/mute":
                self.reply(200, set_mute(body))
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
    """Apply the stored volume at boot so the setting survives reboots."""
    saved = stored()
    if saved is None:
        return
    volume, muted = saved
    try:
        wpctl("set-volume", "@DEFAULT_AUDIO_SINK@", f"{volume / 100:.2f}")
        wpctl("set-mute", "@DEFAULT_AUDIO_SINK@", "1" if muted else "0")
    except Refused:
        pass


if __name__ == "__main__":
    restore()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
