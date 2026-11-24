"""Run the real backend (fake tools) behind a real browser. Used by test_browser.py and shots.py."""
import json
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import server  # noqa: E402


class Live:
    """World + in-process HTTP server + detached fake-worker; `url` carries the token like the launch file does."""
    def __init__(self, world=None, **world_args):
        self.w = world or fakes.World(**world_args)
        self.app = server.App(str(self.w.work), str(self.w.media), host=self.w.host, worker_cmd=fakes.worker_cmd(self.w))
        self.httpd, self.port = server.make_server(self.app)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        launch = self.app.write_launch_file(self.port)
        self.url = f"http://127.0.0.1:{self.port}/#{self.app.token}"
        self.launch = launch

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        end = time.time() + 30
        while time.time() < end and core.lock_held(str(self.w.work)):
            time.sleep(0.1)
        self.w.cleanup()
