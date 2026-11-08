#!/usr/bin/env python3
"""Loopback network setup for the Awai Otehon shell (AWAI-168).

Wi-Fi (join, known networks, forget) through NetworkManager and Bluetooth
(status, power, devices, pairing) through BlueZ, both driven with fixed
command lines and no shell. Listens on loopback only; systemd also denies it
any other address. Nothing is scanned beyond the OS's own adapters, and the
shell shows an honest empty state when an adapter is absent (as in the VM).

Secrets: a Wi-Fi key travels in the POST body and is handed to nmcli, which
stores it in a root-owned NetworkManager keyfile. It never lands in a shell
page, a log, or an error body.
"""
import json
import os
import re
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ["OTEHON_NET_PORT"])
# A file:// page sends the origin "null". No other page may use this service.
ALLOWED_ORIGINS = {"null"}
SCAN_TIMEOUT = 25
ACTION_TIMEOUT = 30
MAC = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")


class Refused(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def run(*argv, timeout=ACTION_TIMEOUT):
    try:
        done = subprocess.run(list(argv), capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise Refused(504, "command-timeout")
    except OSError:
        raise Refused(500, "command-unavailable")
    return done


def nm_ok(*argv, timeout=ACTION_TIMEOUT):
    done = run(*argv, timeout=timeout)
    if done.returncode != 0:
        return None
    return done.stdout


def clean_ssid(value):
    if not isinstance(value, str):
        raise Refused(400, "bad-ssid")
    raw = value.encode("utf-8")
    if not raw or len(raw) > 32:
        raise Refused(400, "bad-ssid")
    if any(ord(char) < 32 for char in value):
        raise Refused(400, "bad-ssid")
    return value


def clean_psk(value):
    if value is None:
        return None
    if not isinstance(value, str):
        raise Refused(400, "bad-psk")
    if len(value) == 64 and all(char in "0123456789abcdefABCDEF" for char in value):
        return value
    if 8 <= len(value) <= 63:
        return value
    raise Refused(400, "bad-psk")


def clean_name(value):
    if not isinstance(value, str) or not value or len(value) > 128:
        raise Refused(400, "bad-name")
    if any(ord(char) < 32 for char in value):
        raise Refused(400, "bad-name")
    return value


def clean_mac(value):
    if not isinstance(value, str) or not MAC.match(value):
        raise Refused(400, "bad-mac")
    return value.upper()


def wifi_device():
    out = nm_ok("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status")
    if out is None:
        raise Refused(500, "nm-unavailable")
    for line in out.splitlines():
        device, kind, state = (line.split(":", 2) + ["", "", ""])[:3]
        if kind == "wifi":
            return state
    return None


def wifi_enabled():
    out = nm_ok("nmcli", "-t", "-f", "WIFI", "general")
    return out is not None and out.strip() == "enabled"


def link_up():
    out = nm_ok("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status")
    if out is None:
        return False
    for line in out.splitlines():
        device, kind, state = (line.split(":", 2) + ["", "", ""])[:3]
        if device != "lo" and state == "connected":
            return True
    return False


def bt_present():
    # sysfs never blocks, unlike bluetoothctl without a daemon.
    try:
        return any(True for _ in os.scandir("/sys/class/bluetooth"))
    except OSError:
        return False


def bluetooth_powered():
    if not bt_present():
        return None
    done = run("bluetoothctl", "show", timeout=10)
    if done.returncode != 0:
        return None
    for line in done.stdout.splitlines():
        if line.strip().startswith("Powered:"):
            return line.split(":", 1)[1].strip() == "yes"
    return None


def status():
    wifi = wifi_device()
    powered = bluetooth_powered()
    return {
        "link": "up" if link_up() else "down",
        "wifi": {"available": wifi is not None, "enabled": wifi_enabled()},
        "bluetooth": {"available": powered is not None, "powered": bool(powered)},
    }


def wifi_networks():
    if wifi_device() is None:
        raise Refused(503, "no-adapter")
    out = nm_ok("nmcli", "-w", "10", "-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "yes", timeout=SCAN_TIMEOUT)
    if out is None:
        raise Refused(500, "scan-failed")
    networks = []
    for line in out.splitlines():
        ssid, signal, security = (line.split(":", 2) + ["", "", ""])[:3]
        if not ssid:
            continue
        try:
            level = int(signal)
        except ValueError:
            level = 0
        networks.append({"ssid": ssid, "signal": max(0, min(100, level)), "security": security})
    networks.sort(key=lambda item: item["signal"], reverse=True)
    return {"networks": networks}


def wifi_join(body):
    ssid = clean_ssid(body.get("ssid"))
    psk = clean_psk(body.get("psk"))
    if wifi_device() is None:
        raise Refused(503, "no-adapter")
    argv = ["nmcli", "device", "wifi", "connect", ssid]
    if psk is not None:
        argv += ["password", psk]
    done = run(*argv, timeout=ACTION_TIMEOUT)
    if done.returncode == 0:
        return {"connected": ssid}
    detail = (done.stderr or done.stdout or "").strip().splitlines()
    last = detail[-1] if detail else ""
    if "No network with SSID" in last:
        raise Refused(404, "no-network")
    if "Secrets were required" in last or "psk" in last.lower():
        raise Refused(401, "auth-failed")
    raise Refused(400, "join-failed")


def wifi_known():
    out = nm_ok("nmcli", "-t", "-f", "NAME,TYPE", "connection", "show")
    if out is None:
        raise Refused(500, "nm-unavailable")
    known = []
    for line in out.splitlines():
        name, kind = (line.split(":", 1) + ["", ""])[:2]
        if kind == "802-11-wireless" and name:
            known.append({"name": name})
    return {"known": known}


def wifi_forget(body):
    name = clean_name(body.get("name"))
    done = run("nmcli", "connection", "delete", name)
    if done.returncode != 0:
        raise Refused(404, "unknown-connection")
    return {"forgotten": name}


def bluetooth_devices():
    if not bt_present():
        raise Refused(503, "no-adapter")
    seen = run("bluetoothctl", "devices")
    devices = []
    for line in seen.stdout.splitlines():
        parts = line.split(" ", 2)
        if len(parts) != 3 or parts[0] != "Device":
            continue
        mac, name = parts[1], parts[2]
        if not MAC.match(mac):
            continue
        info = run("bluetoothctl", "info", mac)
        paired = connected = False
        for info_line in info.stdout.splitlines():
            text = info_line.strip()
            if text.startswith("Paired:"):
                paired = text.endswith("yes")
            elif text.startswith("Connected:"):
                connected = text.endswith("yes")
        devices.append({"mac": mac.upper(), "name": name, "paired": paired, "connected": connected})
    return {"devices": devices}


def bluetooth_power(body):
    on = body.get("on")
    if on is not True and on is not False:
        raise Refused(400, "bad-power")
    if not bt_present():
        raise Refused(503, "no-adapter")
    done = run("bluetoothctl", "power", "on" if on else "off")
    if done.returncode != 0:
        raise Refused(500, "power-failed")
    return {"powered": on}


def bluetooth_pair(body):
    mac = clean_mac(body.get("mac"))
    if not bt_present():
        raise Refused(503, "no-adapter")
    for verb in ("pair", "trust", "connect"):
        done = run("bluetoothctl", verb, mac, timeout=ACTION_TIMEOUT)
        if done.returncode != 0:
            raise Refused(500, "pair-failed")
    return {"paired": mac}


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
            elif self.path == "/v1/wifi/networks":
                self.reply(200, wifi_networks())
            elif self.path == "/v1/wifi/known":
                self.reply(200, wifi_known())
            elif self.path == "/v1/bluetooth/devices":
                self.reply(200, bluetooth_devices())
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
            if self.path == "/v1/wifi/join":
                self.reply(200, wifi_join(body))
            elif self.path == "/v1/wifi/forget":
                self.reply(200, wifi_forget(body))
            elif self.path == "/v1/bluetooth/power":
                self.reply(200, bluetooth_power(body))
            elif self.path == "/v1/bluetooth/pair":
                self.reply(200, bluetooth_pair(body))
            else:
                self.reply(404, {"error": "not-found"})
        except Refused as refused:
            self.reply(refused.status, {"error": refused.reason})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_message(self, format, *args):
        # Requests, names and keys stay out of the journal.
        pass

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
