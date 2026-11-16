#!/usr/bin/env python3
"""The Settei helper: the one privileged step behind the Settei screen.

It changes the system time zone and nothing else. It runs as its own system user, and a polkit
rule (settei.nix) lets only that user call org.freedesktop.timedate1.set-timezone. systemd-timedated
does the write (/etc/localtime), so the change stays after a restart.

GET  /v1/timezone  -> {"zone": "<current>", "zones": [...]}
POST /v1/timezone  {"zone": "<name>"} -> {"zone": "<name>"} once timedated reports it

A zone is accepted only if it is in the list timedatectl itself prints. Nothing from the request
reaches a shell: timedatectl gets one argument, from that list.
"""
import os
import re
import subprocess
from http.server import ThreadingHTTPServer

import local_service
from local_service import Refused, audit

TIMEDATECTL = os.environ.get("OTEHON_TIMEDATECTL", "timedatectl")
ZONE = re.compile(r"^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+){0,2}$")
TIMEOUT = 20


def run(*args):
    result = subprocess.run([TIMEDATECTL, *args], capture_output=True, timeout=TIMEOUT, text=True)
    if result.returncode != 0:
        raise Refused(500, f"timedatectl-failed: {result.stderr.strip()[-200:]}")
    return result.stdout


def zones():
    return [line.strip() for line in run("list-timezones").splitlines() if ZONE.fullmatch(line.strip())]


def current():
    return run("show", "--property=Timezone", "--value").strip()


def get_timezone(handler, uid):
    return 200, {"zone": current(), "zones": zones()}


def set_timezone(handler, uid):
    body = handler.body()
    zone = body.get("zone")
    if not isinstance(zone, str) or not ZONE.fullmatch(zone) or zone not in zones():
        raise Refused(400, "unknown-zone")
    before = current()
    run("set-timezone", zone)
    after = current()
    if after != zone:
        audit("settei", "set-timezone", uid=uid, before=before, after=after, result="not-applied")
        raise Refused(500, "not-applied")
    audit("settei", "set-timezone", uid=uid, before=before, after=after, result="ok")
    return 200, {"zone": after}


class SetteiHandler(local_service.Handler):
    service = "settei"
    routes = {("GET", "/v1/timezone"): get_timezone, ("POST", "/v1/timezone"): set_timezone}


def main():
    SetteiHandler.port = int(os.environ["OTEHON_SETTEI_PORT"])
    SetteiHandler.allowed_uid = local_service.desktop_uid()
    audit("settei", "start", port=SetteiHandler.port, desktop_uid=SetteiHandler.allowed_uid)
    ThreadingHTTPServer(("127.0.0.1", SetteiHandler.port), SetteiHandler).serve_forever()


if __name__ == "__main__":
    main()
