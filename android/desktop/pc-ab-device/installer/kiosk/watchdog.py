#!/usr/bin/env python3
"""Browser watchdog. The installer page pings the backend every few seconds while it is visible (server.py touches
DIR/heartbeat on every authenticated request). If nothing has touched it for TIMEOUT seconds, the browser is showing
something else (or has hung): terminate the browser session (the xinit process given with --pid) so start.sh starts a new one.

It only ever signals the process it was given, and only if that process is an `xinit`; it never touches the detached
install worker (a restart of the browser is safe at any moment of a write).

While X's virtual terminal is not the active one (someone switched to tty2, or the machine is suspended) the page's timers
are throttled and silence means nothing: no restart then, and the silence clock restarts when X becomes active again.

  watchdog.py --work-dir DIR --pid PID [--timeout 20] [--grace 60] [--vt tty1]
"""
import argparse
import os
import signal
import sys
import time


def cmdline_of(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().replace(b"\0", b" ").decode(errors="replace")
    except OSError:
        return ""


def is_xinit(pid, read=cmdline_of):
    words = read(pid).split()
    return bool(words) and os.path.basename(words[0]) == "xinit"


def should_restart(now, started, last_beat, timeout, grace):
    """True when the page has been silent too long. A fresh session gets `grace` seconds to start X and load the page."""
    if last_beat is None or last_beat < started:
        return now - started > grace
    return now - last_beat > timeout


def heartbeat(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return None


def active_vt(path="/sys/class/tty/tty0/active"):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return None


def run(work, pid, timeout, grace, now=time.time, sleep=time.sleep, kill=os.kill, read=cmdline_of, alive=None,
        vt="tty1", active=active_vt):
    started = now()
    resumed = None
    alive = alive or (lambda p: os.path.exists(f"/proc/{p}") or _alive(p))
    while alive(pid):
        current = active()
        if current is not None and current != vt:
            resumed = now()  # X is not on screen: timers are throttled, silence proves nothing
            sleep(2)
            continue
        beat = heartbeat(os.path.join(work, "heartbeat"))
        if resumed is not None and (beat is None or beat < resumed):
            beat = resumed  # back on X: the page gets a fresh timeout to ping again
        if should_restart(now(), started, beat, timeout, grace):
            if is_xinit(pid, read):
                kill(pid, signal.SIGTERM)
                return "restarted"
            return "refused"  # not the browser session: never signal anything else
        sleep(2)
    return "exited"


def _alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--pid", type=int, required=True)
    ap.add_argument("--timeout", type=float, default=20)
    ap.add_argument("--grace", type=float, default=60)
    ap.add_argument("--vt", default="tty1")
    a = ap.parse_args(argv)
    print(run(a.work_dir, a.pid, a.timeout, a.grace, alive=_alive, vt=a.vt))


if __name__ == "__main__":
    main()
