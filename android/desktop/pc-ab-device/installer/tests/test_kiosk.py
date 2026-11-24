"""Browser watchdog logic and the heartbeat it reads. The watchdog must never touch the install worker."""
import os
import signal
import subprocess
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "kiosk"))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import watchdog  # noqa: E402
import test_server  # noqa: E402


class Logic(unittest.TestCase):
    def test_silent_page_is_restarted_after_the_timeout_and_a_fresh_session_gets_grace(self):
        self.assertFalse(watchdog.should_restart(now=100, started=0, last_beat=95, timeout=20, grace=60))
        self.assertTrue(watchdog.should_restart(now=100, started=0, last_beat=70, timeout=20, grace=60))
        # no beat since this session started: only the grace period applies
        self.assertFalse(watchdog.should_restart(now=50, started=10, last_beat=5, timeout=20, grace=60))
        self.assertTrue(watchdog.should_restart(now=100, started=10, last_beat=5, timeout=20, grace=60))
        self.assertFalse(watchdog.should_restart(now=30, started=10, last_beat=None, timeout=20, grace=60))
        self.assertTrue(watchdog.should_restart(now=100, started=10, last_beat=None, timeout=20, grace=60))

    def drive(self, beats, cmdline="xinit /x/xsession.sh launch work -- :0 vt1", steps=40):
        """Run the loop on a fake clock; `beats(t)` returns the heartbeat mtime at fake time t (or None)."""
        clock = {"t": 0.0}
        killed = []
        work = Path(tempfile.mkdtemp())
        orig = watchdog.heartbeat
        watchdog.heartbeat = lambda path: beats(clock["t"])
        self.addCleanup(setattr, watchdog, "heartbeat", orig)

        def sleep(n):
            clock["t"] += n
        alive_calls = {"n": 0}

        def alive(pid):
            alive_calls["n"] += 1
            return alive_calls["n"] < steps
        result = watchdog.run(str(work), 4242, 20, 60, now=lambda: clock["t"], sleep=sleep, kill=lambda p, s: killed.append((p, s)),
                              read=lambda p: cmdline, alive=alive)
        return result, killed

    def test_fresh_heartbeat_keeps_the_browser(self):
        result, killed = self.drive(lambda t: t - 3)
        self.assertEqual((result, killed), ("exited", []))

    def test_stale_heartbeat_terminates_only_the_browser_session(self):
        result, killed = self.drive(lambda t: 5.0)  # last beat at t=5, never again
        self.assertEqual(result, "restarted")
        self.assertEqual(killed, [(4242, signal.SIGTERM)])

    def test_never_signals_a_process_that_is_not_xinit(self):
        for cmd in ("/usr/bin/python3 /run/archiso/bootmnt/awai/installer/core.py worker --work-dir /run/awai-pc-installer",
                    "python3 server.py --work-dir w", "bash start.sh", ""):
            result, killed = self.drive(lambda t: 5.0, cmdline=cmd)
            self.assertEqual((result, killed), ("refused", []), cmd)

    def test_a_real_decoy_worker_process_is_left_alone(self):
        decoy = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)", "core.py", "worker"])
        self.addCleanup(decoy.kill)
        work = Path(tempfile.mkdtemp())
        (work / "heartbeat").write_text("")
        os.utime(work / "heartbeat", (1, 1))  # ancient
        ps = lambda pid: subprocess.run(["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True).stdout
        result = watchdog.run(str(work), decoy.pid, 20, 0, sleep=lambda n: None, read=ps)
        self.assertEqual(result, "refused")
        time.sleep(0.2)
        self.assertIsNone(decoy.poll(), "the process must still be running")

    def test_the_loop_ends_when_the_browser_exits(self):
        result, killed = self.drive(lambda t: t, steps=3)
        self.assertEqual((result, killed), ("exited", []))


import tempfile  # noqa: E402


class Heartbeat(test_server.ServerBase):
    def mtime(self):
        return os.stat(self.w.work / "heartbeat").st_mtime

    def test_heartbeat_file_is_private_and_exists_from_the_start(self):
        self.assertEqual(os.stat(self.w.work / "heartbeat").st_mode & 0o777, 0o600)

    def test_authenticated_requests_touch_it_and_unauthenticated_ones_do_not(self):
        os.utime(self.w.work / "heartbeat", (1000, 1000))
        self.c.call("GET", "/api/ping", token="wrong")
        self.c.call("GET", "/api/ping", token=False)
        self.c.call("GET", "/api/ping", host="evil.example")
        self.assertEqual(self.mtime(), 1000)
        self.assertEqual(self.c.json("GET", "/api/ping")[0], 200)
        self.assertGreater(self.mtime(), 1000)

    def test_page_pings_only_while_visible(self):
        js = (fakes.INSTALLER / "web" / "app.js").read_text()
        self.assertIn('document.visibilityState === "visible"', js)
        self.assertIn('"/api/ping"', js)

    def test_start_script_hands_the_watchdog_only_the_browser_session(self):
        script = (fakes.INSTALLER / "start.sh").read_text()
        self.assertIn('watchdog.py" --work-dir "$work" --pid "$xpid"', script)
        self.assertIn('wait "$xpid"', script)
        self.assertNotIn("worker", script.split("watchdog.py")[1].split("\n")[0])


if __name__ == "__main__":
    unittest.main()
