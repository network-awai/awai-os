#!/usr/bin/env python3
"""Loopback network setup for the Awai Otehon shell (AWAI-168).

Wi-Fi (join, known networks, forget) through NetworkManager and Bluetooth
(status, power, devices, pairing) through BlueZ, both driven with fixed
command lines and no shell. Listens on loopback only; systemd also denies it
any other address. Nothing is scanned beyond the OS's own adapters, and the
shell shows an honest empty state when an adapter is absent (as in the VM).

Secrets: a Wi-Fi key travels in the POST body and root-local D-Bus; NM
stores it in a root-owned NetworkManager keyfile. It never lands in a shell
page, a log, or an error body.
"""
import asyncio
import threading
import uuid
import json
import os
import re
import subprocess
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ["OTEHON_NET_PORT"])
# Only the installed loopback shell origin may call this host adapter.
ALLOWED_ORIGINS = {"http://127.0.0.1:8780"}
JOIN_LOCK = threading.Lock()
SCAN_TIMEOUT = 25
ACTION_TIMEOUT = 30
MAC = re.compile(r"^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$")


class Refused(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def run(*argv, timeout=ACTION_TIMEOUT):
    try:
        done = subprocess.run(list(argv), capture_output=True, text=True, timeout=timeout, env={**os.environ, "LC_ALL": "C"})
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
    if 8 <= len(value) <= 63 and not any(ord(c) < 32 or ord(c) == 127 for c in value):
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


def terse_fields(line):
    fields, current, escaped = [], [], False
    for char in line:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(char)
    if escaped:
        current.append("\\")
    return fields + ["".join(current)]


def wifi_device():
    out = nm_ok("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status")
    if out is None:
        raise Refused(500, "nm-unavailable")
    for line in out.splitlines():
        device, kind, state = (terse_fields(line) + ["", "", ""])[:3]
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
        device, kind, state = (terse_fields(line) + ["", "", ""])[:3]
        if device != "lo" and state in {"connected", "connected (externally)"}:
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
    done = run("bluetoothctl", "show", timeout=2)
    if done.returncode != 0:
        return None
    for line in done.stdout.splitlines():
        if line.strip().startswith("Powered:"):
            return line.split(":", 1)[1].strip() == "yes"
    return None


def network_devices():
    out = nm_ok("nmcli", "-t", "-f", "DEVICE,TYPE,STATE", "device", "status")
    if out is None:
        raise Refused(503, "nm-unavailable")
    devices = []
    for line in out.splitlines():
        name, kind, state = (terse_fields(line) + ["", "", ""])[:3]
        if kind not in {"wifi", "ethernet", "bt"} or not re.fullmatch(r"[a-zA-Z0-9_.:-]{1,15}", name):
            continue
        driver = (Path("/sys/class/net") / name / "device/driver").resolve().name
        route = "iphone-usb" if driver == "ipheth" else "usb-tether" if driver in {"rndis_host", "cdc_ether", "cdc_ncm"} else "bluetooth-pan" if kind == "bt" else kind
        devices.append({"name": name, "route": route, "state": state,
                        "managed": state != "unmanaged", "connected": state.startswith("connected")})
    return {"devices": devices}


def connect_wired(body):
    name = body.get("device")
    device = next((d for d in network_devices()["devices"] if d["name"] == name), None)
    if not device or device["route"] not in {"ethernet", "iphone-usb", "usb-tether"}:
        raise Refused(400, "bad-device")
    if not device["managed"]:
        raise Refused(409, "unmanaged-device")
    done = run("nmcli", "--wait", "20", "device", "connect", device["name"], timeout=25)
    if done.returncode:
        raise Refused(400, "connect-failed")
    current = next((d for d in network_devices()["devices"] if d["name"] == name), None)
    if not current or not current["connected"]:
        raise Refused(400, "connect-failed")
    return {"connected": name}


def iphone_attached():
    # Enumerate locally, return a boolean only; never return or log device IDs.
    done = run("idevice_id", "-l", timeout=2)
    return done.returncode == 0 and bool(done.stdout.strip())


def iphone_trust(body):
    if not iphone_attached():
        raise Refused(503, "no-iphone")
    # Pairing initiates the standard Trust prompt. Only the phone owner can
    # approve it; this never extracts a passcode or grants approval for them.
    done = run("idevicepair", "pair", timeout=10)
    if done.returncode == 0:
        return {"trust": "paired"}
    detail = (done.stdout + done.stderr).lower()
    if "trust" in detail:
        return {"trust": "confirm-on-iphone"}
    if "locked" in detail or "password" in detail:
        return {"trust": "unlock-iphone"}
    raise Refused(400, "iphone-not-ready")


def status():
    wifi = wifi_device()
    powered = bluetooth_powered()
    return {
        "link": "up" if link_up() else "down",
        "devices": network_devices()["devices"],
        "iphone": {"attached": iphone_attached()},
        "connectivity": (nm_ok("nmcli", "-t", "-f", "CONNECTIVITY", "general") or "unknown").strip(),
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
        ssid, signal, security = (terse_fields(line) + ["", "", ""])[:3]
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
    if not JOIN_LOCK.acquire(blocking=False):
        raise Refused(409, "join-busy")
    try:
        asyncio.run(asyncio.wait_for(activate_wifi(ssid, psk), timeout=28))
        return {"connected": ssid}
    except Refused:
        raise
    except TimeoutError:
        raise Refused(504, "join-timeout")
    except Exception:
        # D-Bus errors can contain a profile or secret: never serialize them.
        raise Refused(400, "join-failed")
    finally:
        JOIN_LOCK.release()


async def activate_wifi(ssid, psk):
    """Secrets travel only in root-local D-Bus messages, never process argv.

    New profiles stay in memory until activation succeeds. No existing profile
    is overwritten or deleted. Unsupported enterprise/SAE-only APs fail closed.
    """
    from dbus_next.aio import MessageBus
    from dbus_next import BusType, Variant
    nm = "org.freedesktop.NetworkManager"
    base = "/org/freedesktop/NetworkManager"
    bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
    created = None
    active = None
    success = False

    async def interface(path, name):
        tree = await bus.introspect(nm, path)
        return bus.get_proxy_object(nm, path, tree).get_interface(name)

    async def props(path, name):
        obj = await interface(path, "org.freedesktop.DBus.Properties")
        return {k: v.value for k, v in (await obj.call_get_all(name)).items()}

    try:
        manager = await interface(base, nm)
        candidates = []
        for device in await manager.call_get_devices():
            dev = await props(device, nm + ".Device")
            if dev.get("DeviceType") != 2:
                continue
            wifi = await interface(device, nm + ".Device.Wireless")
            for ap in await wifi.call_get_all_access_points():
                values = await props(ap, nm + ".AccessPoint")
                if bytes(values.get("Ssid", b"")) == ssid.encode("utf-8"):
                    candidates.append((values.get("Strength", 0), device, ap, values))
        if not candidates:
            raise Refused(404, "no-network")
        _, device, ap, values = max(candidates, key=lambda x: x[0])
        if psk is None:
            settings = await interface(base + "/Settings", nm + ".Settings")
            for path in await settings.call_list_connections():
                conn = await interface(path, nm + ".Settings.Connection")
                saved = await conn.call_get_settings()  # never GetSecrets
                wireless = saved.get("802-11-wireless", {})
                saved_ssid = wireless.get("ssid")
                if saved_ssid and bytes(saved_ssid.value) == ssid.encode("utf-8"):
                    active = await manager.call_activate_connection(path, device, ap)
                    break
        if active is None:
            secure = bool(values.get("Flags", 0) & 1)
            flags = values.get("WpaFlags", 0) | values.get("RsnFlags", 0)
            if secure and not (flags & 0x100):
                raise Refused(400, "unsupported-security")
            if secure and psk is None:
                raise Refused(401, "auth-required")
            if not secure and psk is not None:
                raise Refused(400, "security-mismatch")
            config = {
                "connection": {"id": Variant("s", ssid), "uuid": Variant("s", str(uuid.uuid4())),
                               "type": Variant("s", "802-11-wireless"), "autoconnect": Variant("b", True)},
                "802-11-wireless": {"ssid": Variant("ay", ssid.encode("utf-8")), "mode": Variant("s", "infrastructure")},
                "ipv4": {"method": Variant("s", "auto")},
                "ipv6": {"method": Variant("s", "auto")},
            }
            if secure:
                config["802-11-wireless-security"] = {"key-mgmt": Variant("s", "wpa-psk"), "psk": Variant("s", psk)}
            created, active, _ = await manager.call_add_and_activate_connection2(
                config, device, ap, {"persist": Variant("s", "memory")})
        for _ in range(100):
            state = (await props(active, nm + ".Connection.Active")).get("State")
            if state == 2:
                if created:
                    conn = await interface(created, nm + ".Settings.Connection")
                    await conn.call_save()
                success = True
                return
            if state == 4:
                raise Refused(401, "auth-failed")
            await asyncio.sleep(0.2)
        raise Refused(504, "join-timeout")
    finally:
        if created and not success:
            try:
                conn = await interface(created, nm + ".Settings.Connection")
                await asyncio.wait_for(conn.call_delete(), timeout=2)
            except Exception:
                pass
        bus.disconnect()


def wifi_known():
    out = nm_ok("nmcli", "-t", "-f", "NAME,TYPE", "connection", "show")
    if out is None:
        raise Refused(500, "nm-unavailable")
    known = []
    for line in out.splitlines():
        name, kind = (terse_fields(line) + ["", ""])[:2]
        if kind == "802-11-wireless" and name:
            known.append({"name": name})
    return {"known": known}


def wifi_forget(body):
    name = clean_name(body.get("name"))
    out = nm_ok("nmcli", "-t", "-f", "UUID,NAME,TYPE", "connection", "show")
    if out is None:
        raise Refused(503, "nm-unavailable")
    ids = []
    for line in out.splitlines():
        ident, saved, kind = (terse_fields(line) + ["", "", ""])[:3]
        if saved == name and kind == "802-11-wireless" and re.fullmatch(r"[0-9a-fA-F-]{36}", ident):
            ids.append(ident)
    if len(ids) != 1:
        raise Refused(409 if ids else 404, "ambiguous-connection" if ids else "unknown-connection")
    if run("nmcli", "connection", "delete", "uuid", ids[0]).returncode:
        raise Refused(400, "forget-failed")
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
    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

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
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
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
        if not self.allowed():
            return
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
        except (json.JSONDecodeError, UnicodeDecodeError):
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
            elif self.path == "/v1/devices":
                self.reply(200, network_devices())
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
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise Refused(415, "bad-json")
            body = self.body()
            if self.path == "/v1/wifi/join":
                self.reply(200, wifi_join(body))
            elif self.path == "/v1/iphone/trust":
                self.reply(200, iphone_trust(body))
            elif self.path == "/v1/iphone/trust":
                self.reply(200, iphone_trust(body))
            elif self.path == "/v1/devices/connect":
                self.reply(200, connect_wired(body))
            elif self.path == "/v1/wifi/forget":
                self.reply(200, wifi_forget(body))
            elif self.path == "/v1/bluetooth/power":
                self.reply(200, bluetooth_power(body))
            elif self.path == "/v1/bluetooth/pair":
                self.reply(200, bluetooth_pair(body))
            else:
                self.reply(404, {"error": "not-found"})
        except Refused as refused:
            self.close_connection = True
            self.reply(refused.status, {"error": refused.reason})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_message(self, format, *args):
        # Requests, names and keys stay out of the journal.
        pass

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
