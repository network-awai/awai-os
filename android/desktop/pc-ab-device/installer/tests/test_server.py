"""HTTP backend: token/Host/Origin, one-shot ticket, single install, crash-safety. In-process server, fake tools."""
import http.client
import io
import json
import os
import stat
import sys
import threading
import time
import unittest
from contextlib import redirect_stderr
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import server  # noqa: E402


class Client:
    def __init__(self, app, port, token=True, host=None, origin=None):
        self.app, self.port = app, port
        self.token, self.host, self.origin = token, host, origin

    def call(self, method, path, body=None, token=True, host=None, origin="default", ctype="application/json", raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        headers = {"Host": host or f"127.0.0.1:{self.port}"}
        if token:
            headers["X-Awai-Token"] = self.app.token if token is True else token
        if origin == "default":
            origin = f"http://127.0.0.1:{self.port}" if method == "POST" else None
        if origin:
            headers["Origin"] = origin
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            headers["Content-Type"] = ctype
        conn.request(method, path, body=data, headers=headers)
        r = conn.getresponse()
        payload = r.read()
        out = (r.status, dict(r.getheaders()), payload)
        conn.close()
        return out

    def json(self, *a, **k):
        status, headers, payload = self.call(*a, **k)
        return status, json.loads(payload or b"{}")


class ServerBase(unittest.TestCase):
    def setUp(self):
        self.w = fakes.World()
        self.addCleanup(self.w.cleanup)
        self.start()

    def start(self):
        self.app = server.App(str(self.w.work), str(self.w.media), host=self.w.host, worker_cmd=fakes.worker_cmd(self.w))
        self.httpd, self.port = server.make_server(self.app)
        self.log = io.StringIO()
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.c = Client(self.app, self.port)
        self.addCleanup(self.stop)

    def stop(self):
        if self.thread.is_alive():
            self.httpd.shutdown()
        self.httpd.server_close()
        self.wait_idle()

    def wait_idle(self, timeout=60):
        end = time.time() + timeout
        while time.time() < end and (core.lock_held(str(self.w.work)) or (self.app.proc and self.app.proc.poll() is None)):
            time.sleep(0.1)

    def wait_state(self, want, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            st = self.c.json("GET", "/api/install")[1]
            if st["state"] in want:
                return st
            time.sleep(0.1)
        self.fail(f"state never reached {want}: {st}")

    def install(self, device="nvme0n1", typed=None):
        status, body = self.c.json("POST", "/api/review", {"device": device})
        self.assertEqual(status, 200, body)
        return self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": typed or device})


class Transport(ServerBase):
    def test_binds_loopback_only_on_a_random_port(self):
        self.assertEqual(self.httpd.server_address[0], "127.0.0.1")
        self.assertGreater(self.port, 0)

    def test_api_needs_the_token(self):
        for token in (False, "wrong", "", self.app.token[:-1], self.app.token + "x"):
            status, _ = self.c.json("GET", "/api/disks", token=token)
            self.assertEqual(status, 403, token)
        self.assertEqual(self.c.json("GET", "/api/disks")[0], 200)

    def test_every_post_route_needs_the_token(self):
        for route in ("review", "install", "dismiss", "poweroff", "reboot"):
            self.assertEqual(self.c.json("POST", f"/api/{route}", {}, token=False)[0], 403, route)
        self.assertEqual(self.w.world_file.read_text().count("power_calls"), 0)

    def test_host_header_must_match_exactly(self):
        for host in ("evil.example", "localhost:%d" % self.port, "127.0.0.1", "127.0.0.1:1", "127.0.0.1:%d.evil.example" % self.port):
            for path in ("/", "/api/disks", "/app.js"):
                self.assertEqual(self.c.call("GET", path, host=host)[0], 403, (host, path))

    def test_origin_must_match_on_post_and_when_present_on_get(self):
        self.assertEqual(self.c.json("POST", "/api/review", {"device": "nvme0n1"}, origin=None)[0], 403)
        for origin in ("http://evil.example", "null", f"http://localhost:{self.port}", f"https://127.0.0.1:{self.port}"):
            self.assertEqual(self.c.json("POST", "/api/review", {"device": "nvme0n1"}, origin=origin)[0], 403, origin)
            self.assertEqual(self.c.json("GET", "/api/disks", origin=origin)[0], 403, origin)
        self.assertEqual(self.c.json("GET", "/api/disks", origin=None)[0], 200)

    def test_no_cors_headers_and_no_preflight(self):
        for status, headers, _ in (self.c.call("GET", "/api/disks"), self.c.call("GET", "/"), self.c.call("GET", "/api/disks", token=False),
                                    self.c.call("OPTIONS", "/api/install")):
            self.assertFalse([h for h in headers if h.lower().startswith("access-control-")], headers)
        self.assertNotEqual(self.c.call("OPTIONS", "/api/install")[0], 200)

    def test_strict_csp_and_no_external_resources(self):
        status, headers, body = self.c.call("GET", "/")
        csp = headers["Content-Security-Policy"]
        self.assertIn("default-src 'none'", csp)
        for bad in ("unsafe-inline", "unsafe-eval", "http:", "https:", "*", "data:"):
            self.assertNotIn(bad, csp)
        for name in ("index.html", "app.js", "style.css"):
            text = (fakes.INSTALLER / "web" / name).read_text()
            self.assertNotRegex(text.replace("http://www.w3.org", ""), r"(https?:)?//[a-z0-9.-]+\.[a-z]{2,}", name)
        html = body.decode()
        self.assertNotIn("<style", html)
        self.assertNotRegex(html, r"<script(?![^>]*\bsrc=)")
        self.assertNotRegex(html, r"\bon[a-z]+=")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_body_and_content_type_limits(self):
        self.assertEqual(self.c.call("POST", "/api/review", raw=b"{}", ctype="text/plain")[0], 415)
        self.assertEqual(self.c.call("POST", "/api/review", raw=b"x" * 5000)[0], 400)
        self.assertEqual(self.c.call("POST", "/api/review", raw=b"[1]")[0], 400)
        self.assertEqual(self.c.call("POST", "/api/review", raw=b"{nope")[0], 400)

    def test_token_lives_only_in_the_private_launch_file(self):
        path = self.app.write_launch_file(self.port)
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(self.w.work).st_mode), 0o700)
        self.assertIn(self.app.token, Path(path).read_text())
        self.assertIn("#" + self.app.token, Path(path).read_text(), "token must travel in the URL fragment")
        # never in argv of the worker, in server log lines, in other files or in responses
        self.assertNotIn(self.app.token, " ".join(self.app.worker_cmd))
        default = server.App(str(self.w.work), str(self.w.media), host=self.w.host)
        self.assertNotIn(default.token, " ".join(default.worker_cmd), "the production worker command must not carry the token")
        buf = io.StringIO()
        with redirect_stderr(buf):
            self.c.call("GET", "/api/disks")
            self.c.call("GET", "/api/disks", token="nope")
        self.assertNotIn(self.app.token, buf.getvalue())
        self.install()
        self.wait_state(("done",))
        for p in Path(self.w.work).rglob("*"):
            if p.is_file() and p.name != "launch.html" and p.stat().st_size < 50 << 20 and p.suffix != ".img":
                self.assertNotIn(self.app.token.encode(), p.read_bytes(), str(p))
        for _, _, body in (self.c.call("GET", "/api/install"), self.c.call("GET", "/")):
            self.assertNotIn(self.app.token.encode(), body)

    def test_static_files_are_served_without_the_token(self):
        for path, ctype in (("/", "text/html"), ("/app.js", "text/javascript"), ("/style.css", "text/css")):
            status, headers, body = self.c.call("GET", path, token=False)
            self.assertEqual(status, 200)
            self.assertTrue(headers["Content-Type"].startswith(ctype))
        self.assertEqual(self.c.call("GET", "/../core.py", token=False)[0], 404)
        self.assertEqual(self.c.call("GET", "/core.py", token=False)[0], 404)


class Flow(ServerBase):
    def test_review_install_follow_to_done(self):
        status, body = self.install()
        self.assertEqual(status, 202)
        st = self.wait_state(("done", "failed"))
        self.assertEqual(st["state"], "done", st)
        self.assertEqual(st["partitions"], 11)
        self.assertTrue((self.w.work / "install-record.json").exists())

    def test_review_refuses_ineligible_disks_with_reason(self):
        for name in ("sda", "../etc", "nvme9n9"):
            status, body = self.c.json("POST", "/api/review", {"device": name})
            self.assertIn(status, (400, 409), name)
        status, body = self.c.json("POST", "/api/review", {"device": "sda"})
        self.assertEqual(body["error"], "not-nvme")
        self.assertIn("選べません", body["ja"])

    def test_ticket_is_one_shot(self):
        status, body = self.c.json("POST", "/api/review", {"device": "nvme0n1"})
        first = self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": "nvme0n1"})
        self.assertEqual(first[0], 202)
        self.wait_state(("done", "failed"))
        again = self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": "nvme0n1"})
        self.assertEqual(again[0], 409)

    def test_install_without_review_is_refused(self):
        self.assertEqual(self.c.json("POST", "/api/install", {"ticket": "x", "typed": "nvme0n1"})[0], 409)
        self.assertEqual(self.c.json("POST", "/api/install", {"typed": "nvme0n1"})[0], 409)
        self.assertNothingStarted()

    def assertNothingStarted(self):
        self.assertIsNone(self.app.proc)
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())

    def test_wrong_typed_name_refused_by_backend_and_consumes_the_ticket(self):
        status, body = self.c.json("POST", "/api/review", {"device": "nvme0n1"})
        self.assertEqual(self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": "nvme0"})[1]["error"], "typed-name")
        self.assertEqual(self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": "nvme0n1"})[0], 409)
        self.assertNothingStarted()

    def test_install_is_refused_while_another_installer_holds_the_lock(self):
        status, body = self.c.json("POST", "/api/review", {"device": "nvme0n1"})
        import fcntl
        fd = os.open(self.w.work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)  # e.g. the text installer on tty1 is writing
        self.addCleanup(os.close, fd)
        status, answer = self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": "nvme0n1"})
        self.assertEqual((status, answer["error"]), (409, "busy"))
        self.assertNothingStarted()

    def test_disk_changed_between_review_and_install_is_refused_with_nothing_written(self):
        status, body = self.c.json("POST", "/api/review", {"device": "nvme0n1"})
        self.w.edit_disk("nvme0n1", serial="SN-OTHER")
        self.assertEqual(self.c.json("POST", "/api/install", {"ticket": body["ticket"], "typed": "nvme0n1"})[0], 202)
        st = self.wait_state(("failed", "done"))
        self.assertEqual((st["state"], st["error"]["code"], st["written"]), ("failed", "identity-changed", "none"))
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())

    def test_failure_is_never_reported_as_done(self):
        self.w.update(sgdisk_v_problem=True)
        self.install()
        st = self.wait_state(("done", "failed"))
        self.assertEqual(st["state"], "failed")
        self.assertEqual(st["error"]["step"], 3)
        self.assertEqual(st["written"], "started")
        self.assertIn("区画表", st["error"]["ja"])
        self.assertEqual(self.c.json("GET", "/api/install")[1]["state"], "failed")

    def test_failure_that_wrote_nothing_can_be_dismissed_but_one_that_wrote_cannot(self):
        (self.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n")
        self.install()
        st = self.wait_state(("failed",))
        self.assertEqual(st["written"], "none")
        self.assertEqual(self.c.json("POST", "/api/dismiss", {})[0], 200)
        self.assertEqual(self.c.json("GET", "/api/install")[1]["state"], "idle")
        # now a failure after writing started
        (self.w.media / "archive.sha256").write_text(f"{self.w.archive_sha}  {core.ARCHIVE_NAME}\n")
        self.w.update(sgdisk_v_problem=True)
        self.install()
        self.wait_state(("failed",))
        self.assertEqual(self.c.json("POST", "/api/dismiss", {})[0], 409)
        # and nothing can start again until reboot
        self.assertEqual(self.c.json("POST", "/api/review", {"device": "nvme0n1"})[0], 409)

    def test_done_state_blocks_a_second_install(self):
        self.install()
        self.wait_state(("done",))
        self.assertEqual(self.c.json("POST", "/api/review", {"device": "nvme0n1"})[1]["error"], "record-exists")


class CrashSafety(ServerBase):
    def setUp(self):
        super().setUp()
        self.w.update(sgdisk_new_delay=2.0)

    def test_worker_is_detached_from_the_backend_session(self):
        self.install()
        self.wait_state(("running",))
        self.assertNotEqual(os.getpgid(self.app.proc.pid), os.getpgid(0))
        self.assertNotEqual(os.getsid(self.app.proc.pid), os.getsid(0))
        self.wait_state(("done", "failed"))

    def test_second_start_is_refused_while_writing(self):
        self.install()
        self.wait_state(("running",))
        status, body = self.c.json("POST", "/api/review", {"device": "nvme0n1"})
        self.assertEqual((status, body["error"]), (409, "busy"))
        self.assertEqual(self.c.json("POST", "/api/install", {"ticket": "x", "typed": "nvme0n1"})[0], 409)
        self.assertEqual(self.wait_state(("done", "failed"))["state"], "done")
        self.assertEqual(sum(1 for _ in self.w.work.glob("install-record.json")), 1)

    def test_power_actions_refused_while_writing(self):
        self.install()
        self.wait_state(("running",))
        for action in ("poweroff", "reboot"):
            self.assertEqual(self.c.json("POST", f"/api/{action}", {})[0], 409)
        self.assertNotIn("power_calls", json.loads(self.w.world_file.read_text()))
        self.wait_state(("done",))
        self.assertEqual(self.c.json("POST", "/api/reboot", {})[0], 200)
        self.assertEqual(json.loads(self.w.world_file.read_text())["power_calls"], [["reboot"]])

    def test_ui_and_server_crash_mid_write_do_not_stop_or_duplicate_the_write(self):
        self.install()
        end = time.time() + 30
        while time.time() < end and not (self.w.work / "write-started").exists():
            time.sleep(0.05)
        self.assertTrue((self.w.work / "write-started").exists())
        # "crash": the whole backend (and with it every browser connection) disappears mid-write
        self.httpd.shutdown()
        self.httpd.server_close()
        self.assertTrue(core.lock_held(str(self.w.work)), "the detached worker must keep the lock")
        self.app = server.App(str(self.w.work), str(self.w.media), host=self.w.host, worker_cmd=fakes.worker_cmd(self.w))
        self.httpd, self.port = server.make_server(self.app)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.c = Client(self.app, self.port)
        st = self.c.json("GET", "/api/install")[1]
        self.assertEqual(st["state"], "running", st)
        self.assertEqual(st["written"], "started")
        self.assertEqual(self.c.json("POST", "/api/review", {"device": "nvme0n1"})[0], 409)
        self.assertEqual(self.wait_state(("done", "failed"))["state"], "done")
        self.assertEqual(self.c.json("POST", "/api/review", {"device": "nvme0n1"})[1]["error"], "record-exists")

    def test_killed_worker_is_reported_as_interrupted_never_running_or_done(self):
        self.install()
        end = time.time() + 30
        while time.time() < end and not (self.w.work / "write-started").exists():
            time.sleep(0.05)
        self.app.proc.kill()
        self.app.proc.wait()
        end = time.time() + 10
        while time.time() < end and core.lock_held(str(self.w.work)):
            time.sleep(0.05)
        st = self.c.json("GET", "/api/install")[1]
        self.assertEqual((st["state"], st["error"]["code"], st["written"]), ("failed", "interrupted", "started"))


class Power(ServerBase):
    def test_poweroff_when_idle(self):
        self.assertEqual(self.c.json("POST", "/api/poweroff", {})[0], 200)
        self.assertEqual(json.loads(self.w.world_file.read_text())["power_calls"], [["poweroff"]])


if __name__ == "__main__":
    unittest.main()
