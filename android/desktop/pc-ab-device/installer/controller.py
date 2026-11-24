"""Front-end-neutral controller of the screen installer (no GTK, no sockets). It owns what the old backend owned:

  list / confirm (core.confirm_target) -> one-shot ticket -> typed device name -> exactly one detached worker start,
  the true install state (core.status), and the power-off question. The GTK front end only renders `view()` and forwards
  events; every refusal still comes from core.py, so nothing here can write a disk.
"""
import json
import os
import secrets
import subprocess
import sys
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import core  # noqa: E402
from strings import T  # noqa: E402


def gib(n):
    return f"{n / 2 ** 30:.1f} GiB"


def disk_title(d):
    if d["name"].startswith("nvme"):
        return T["internal"]
    vendor, model = d.get("vendor") or "", d.get("model") or ""
    name = model if vendor and model.startswith(vendor) else " ".join(x for x in (vendor, model) if x)
    return name or d["name"]


class Controller:
    def __init__(self, host, work, media, worker_cmd=None):
        self.host, self.work, self.media = host, work, media
        self.worker_cmd = worker_cmd or [sys.executable, os.path.join(HERE, "core.py"), "worker", "--work-dir", work, "--media-dir", media]
        self.mutex = threading.Lock()
        self.proc = None
        self.disks = []
        self.selected = None
        self.ticket = None
        self.message = ""
        self.armed = False
        self.screen = "pick"
        core.ensure_work(work)

    # -- state ---------------------------------------------------------------------------------------------------------
    def starting(self):
        return self.proc is not None and self.proc.poll() is None

    def state(self):
        st = core.status(self.work, starting=False)
        if self.starting() and st.get("state") != "running":
            st = dict(st, state="running", step=st.get("step", 1))
        return st

    def busy(self):
        return self.starting() or core.lock_held(self.work) or self.state().get("state") == "running"

    def sync(self):
        """Adopt the true state: a running/done/failed install decides the screen; otherwise the pick/review screens stay."""
        st = self.state()
        if st["state"] == "running":
            self.screen = "progress"
        elif st["state"] == "done":
            self.screen = "done"
        elif st["state"] == "failed":
            self.screen = "failed"
        elif self.screen in ("progress", "done", "failed"):
            self.refresh()
        return st

    def refresh(self):
        """Rescan the disks (the 'update list' button, and the way back from a dismissed failure)."""
        with self.mutex:
            self.disks = core.list_disks(self.host, self.media)
        eligible = [d for d in self.disks if d["eligible"]]
        if self.selected and not any(d["name"] == self.selected for d in eligible):
            self.selected = None
        self.ticket = None
        self.screen = "pick" if eligible else "none"

    # -- the one-shot confirmation chain ---------------------------------------------------------------------------------
    def select(self, name):
        if self.screen not in ("pick",):
            return
        if not any(d["name"] == name and d["eligible"] for d in self.disks):
            return
        self.selected = None if self.selected == name else name
        self.message = ""

    def review(self):
        """内容を確認: confirm the target now (checks + identity) and hold a one-shot ticket."""
        name = self.selected
        if not name:
            return False
        with self.mutex:
            if self.busy():
                return self._refuse("busy")
            if core.write_started(self.work):
                return self._refuse("record-exists")
            try:
                ident = core.confirm_target(self.host, self.media, name)
            except core.Refusal as e:
                return self._refuse(e.code)
            self.ticket = {"id": secrets.token_urlsafe(16), "device": name, "identity": ident}
            self.message = ""
            self.screen = "review"
            return True

    def _refuse(self, code):
        self.message = core.MESSAGES.get(code, core.MESSAGES["internal"])[0]
        return False

    def back(self):
        self.ticket = None
        self.message = ""
        self.screen = "pick"

    def typed_ok(self, typed):
        return bool(self.ticket) and typed == self.ticket["device"]

    def start(self, typed):
        """この SSD にインストール: consumes the ticket whatever happens, checks the typed name, starts exactly one worker."""
        with self.mutex:
            ticket, self.ticket = self.ticket, None
            if not ticket:
                return self._fail_to_pick("no-ticket")
            if typed != ticket["device"]:
                return self._fail_to_pick("typed-name")
            if self.busy():
                return self._fail_to_pick("busy")
            if core.write_started(self.work):
                return self._fail_to_pick("record-exists")
            core.ensure_work(self.work)
            try:
                os.unlink(os.path.join(self.work, "state.json"))
            except FileNotFoundError:
                pass
            fd = os.open(os.path.join(self.work, "request.json"), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w") as f:
                json.dump({"device": ticket["device"], "typed": typed, "identity": ticket["identity"]}, f)
            self.proc = subprocess.Popen(self.worker_cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                         stderr=subprocess.DEVNULL, start_new_session=True, close_fds=True)
            self.screen = "progress"
            return True

    def _fail_to_pick(self, code):
        self._refuse(code)
        self.screen = "pick"
        return False

    def dismiss(self):
        """最初に戻る: leave a failure that wrote nothing. A failure after writing stays until reboot."""
        with self.mutex:
            st = self.state()
            if st.get("state") != "failed" or st.get("written") != "none" or self.busy():
                return False
            os.unlink(os.path.join(self.work, "state.json"))
        self.selected = None
        self.refresh()
        return True

    # -- power -----------------------------------------------------------------------------------------------------------
    def power_press(self, action="poweroff"):
        """First press only asks; the second one acts. Never while an install runs. Returns armed|done|refused|failed."""
        if self.screen == "progress" or self.busy():
            self.armed = False
            return "refused"
        if not self.armed:
            self.armed = True
            return "armed"
        self.armed = False
        r = self.host.run(["systemctl", action])
        return "done" if r.returncode == 0 else "failed"

    def power_blur(self):
        self.armed = False

    def reboot(self):
        if self.busy():
            return "refused"
        r = self.host.run(["systemctl", "reboot"])
        return "done" if r.returncode == 0 else "failed"

    # -- what a renderer needs -----------------------------------------------------------------------------------------------
    def cards(self):
        out = []
        for d in self.disks:
            nvme = d["name"].startswith("nvme")
            shown = ["boot-medium"] if "boot-medium" in d["problems"] else d["problems"]
            reasons = "、".join(T["reasons"].get(p, T["reasons"]["inspect-failed"]) for p in shown)
            sub = " · ".join(x for x in (gib(d["size"]), "NVMe" if nvme else "", T["free"] if d["eligible"] else reasons) if x)
            sel = self.selected == d["name"]
            out.append({"name": d["name"], "title": disk_title(d), "sub": sub, "eligible": d["eligible"], "selected": sel,
                        "tag": T["offTag"] if not d["eligible"] else (T["selTag"] if sel else T["okTag"]), "path": "/dev/" + d["name"],
                        "model": d.get("model", ""), "size": d["size"]})
        return out

    def disk(self, name):
        return next((c for c in self.cards() if c["name"] == name), None)

    def rail_index(self):
        return {"pick": 0, "none": 0, "review": 1, "progress": 2, "failed": 2, "done": 3}[self.screen]

    def view(self):
        st = self.state()
        return {"screen": self.screen, "cards": self.cards(), "selected": self.selected, "message": self.message, "armed": self.armed,
                "state": st, "rail": self.rail_index(), "device": self.ticket["device"] if self.ticket else st.get("device")}
