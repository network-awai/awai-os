#!/usr/bin/env python3
"""Loopback system metrics for the Awai Otehon shell status UI.

Listens on loopback only. systemd also denies it any other network address.
Only GET /v1/system exists: CPU and memory read from /proc. Nothing leaves
the machine. The shell polls it for the node dock; without it the dock shows
the services but no live usage.
"""
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ["OTEHON_STATUS_PORT"])
# A file:// page sends the origin "null". No other page may use this service.
ALLOWED_ORIGINS = {"null"}
SAMPLE_SECONDS = 0.2


class Refused(Exception):
    def __init__(self, status, reason):
        self.status = status
        self.reason = reason


def cpu_times():
    with open("/proc/stat", encoding="ascii") as handle:
        parts = handle.readline().split()
    if not parts or parts[0] != "cpu" or len(parts) < 5:
        raise Refused(500, "no-cpu-times")
    values = [int(part) for part in parts[1:]]
    return values[0] + values[1] + values[2], sum(values)


def cpu_percent():
    busy_before, total_before = cpu_times()
    time.sleep(SAMPLE_SECONDS)
    busy_after, total_after = cpu_times()
    if total_after <= total_before:
        raise Refused(500, "no-cpu-times")
    return round(100.0 * (busy_after - busy_before) / (total_after - total_before), 1)


def mem_info():
    total = available = None
    with open("/proc/meminfo", encoding="ascii") as handle:
        for line in handle:
            name, _, value = line.partition(":")
            number = value.strip().split()
            if name == "MemTotal" and number:
                total = int(number[0])
            elif name == "MemAvailable" and number:
                available = int(number[0])
    if total is None or available is None:
        raise Refused(500, "no-mem-info")
    return total, available


def system():
    total_kb, available_kb = mem_info()
    return {
        "cpu_percent": cpu_percent(),
        "mem_total_kb": total_kb,
        "mem_available_kb": available_kb,
    }


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
            self.send_header("Access-Control-Allow-Methods", "GET")
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
        self.close_connection = True
        self.reply(403, {"error": reason})

    def do_OPTIONS(self):
        self.send_response(204 if self.headers.get("Origin") in ALLOWED_ORIGINS else 403)
        self.send_header("Content-Length", "0")
        self.cors()
        self.end_headers()

    def do_GET(self):
        if not self.allowed():
            return
        try:
            if self.path == "/v1/system":
                try:
                    self.reply(200, system())
                except Refused as refused:
                    self.reply(refused.status, {"error": refused.reason})
            else:
                self.reply(404, {"error": "not-found"})
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
