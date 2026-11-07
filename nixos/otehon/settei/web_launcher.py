#!/usr/bin/env python3
"""Opens an ordinary web browser window for the desktop user, in a profile of its own.

It runs as the desktop user inside the Wayland session, so it holds no privilege. The shell asks
it to open the window and nothing more: the request carries no address, so the shell cannot steer
the browser, and the browser has its own profile and no DevTools port, so its pages cannot reach
the shell's messages, sign-in or wallet.

POST /v1/open -> {"opened": true} or {"opened": "already"}
"""
import os
import subprocess
import threading
from http.server import ThreadingHTTPServer

import local_service
from local_service import audit

COMMAND = os.environ.get("OTEHON_WEB_COMMAND", "")
running = None
running_lock = threading.Lock()


def open_browser(handler, uid):
    global running
    handler.body()
    with running_lock:
        if running is not None and running.poll() is None:
            audit("web", "open", uid=uid, result="already")
            return 200, {"opened": "already"}
        running = subprocess.Popen([COMMAND], stdin=subprocess.DEVNULL, start_new_session=True)
    audit("web", "open", uid=uid, pid=running.pid, result="ok")
    return 200, {"opened": True}


class WebHandler(local_service.Handler):
    service = "web"
    routes = {("POST", "/v1/open"): open_browser}


def main():
    WebHandler.port = int(os.environ["OTEHON_WEB_PORT"])
    WebHandler.allowed_uid = os.getuid()
    audit("web", "start", port=WebHandler.port, desktop_uid=WebHandler.allowed_uid)
    ThreadingHTTPServer(("127.0.0.1", WebHandler.port), WebHandler).serve_forever()


if __name__ == "__main__":
    main()
