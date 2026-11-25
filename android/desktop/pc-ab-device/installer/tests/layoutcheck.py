"""Geometry checks on the real widget tree: everything sits inside the safe area, nothing overlaps, no text is cut off,
the focused control is on screen. Shared by test_layout.py and shots.py."""
import fcntl
import json
import os

import fakes
from fakes import core

SIZES = [(1024, 600), (1024, 768), (1280, 720), (1280, 800), (1366, 768), (1600, 900), (1920, 1080), (1920, 1200),
         (2560, 1440), (2560, 1600), (3840, 2160), (800, 600), (1080, 1920)]
LONG_MODEL = "Samsung SSD 990 PRO with Heatsink Enterprise Edition 2TB"
LONG_VENDOR = "VeryLongVendorNameWithoutAnySpacesAtAll"
TOL = 1  # pixels


def add_disks(world, n, long=True):
    """n empty NVMe SSDs in total (nvme0n1 exists already), with the longest model names a lsblk row can carry."""
    for i in range(n):
        name = f"nvme{i}n1"
        model = (LONG_MODEL if long else "KXG80ZNV256G") + f" #{i}"
        d = fakes.disk(model=model, serial=f"SERIAL-LONG-{i}-ABCD{i}", wwn=f"eui.00{i}")
        if name in world.world["disks"]:
            world.world["disks"][name].update(model=d["model"], serial=d["serial"])
        else:
            world.world["disks"][name] = d
            (world.dev / name).write_bytes(b"")
    world.world["disks"]["sda"].update(vendor=LONG_VENDOR, model=LONG_MODEL + " USB")
    world.save()


def rect(d, w):
    x, y = w.translate_coordinates(d.win, 0, 0)
    a = w.get_allocation()
    return (x, y, x + a.width, y + a.height)


def inter(a, b):
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def area(r):
    return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def ancestors(w):
    while w is not None:
        yield w
        w = w.get_parent()


def items(d):
    """Every visible label, button and progress bar with its on-screen rectangle (clipped to its scroll area)."""
    Gtk = d.Gtk
    out = []

    def walk(w):
        if not w.get_visible() or not w.get_mapped():
            return
        if isinstance(w, Gtk.Label) and w.get_text().strip() or isinstance(w, (Gtk.Button, Gtk.ProgressBar)):
            out.append(w)
        if isinstance(w, Gtk.Container):
            for c in w.get_children():
                walk(c)
    # behind the veil nothing is operable: only the confirmation itself is checked while it is open
    walk(d.ui.dialog if d.ui.veil.get_visible() else d.ui.root)
    res = []
    for w in out:
        r = rect(d, w)
        sc = next((a for a in ancestors(w) if isinstance(a, Gtk.ScrolledWindow)), None)
        res.append((w, r, rect(d, sc) if sc is not None else None))
    return res


def problems(d, what=""):
    """Human-readable list of every violation on the screen as it is now ([] = fine)."""
    ui, W, H = d.ui, d.ui.W, d.ui.H
    safe = (ui.sx, ui.sy, W - ui.sx, H - ui.sy)
    Gtk = d.Gtk
    bad = []
    visible = []
    for w, r, sc in items(d):
        name = (w.get_text() if isinstance(w, Gtk.Label) else d.button_text(w) if isinstance(w, Gtk.Button) else "progress")[:30]
        if sc is not None:
            if not (safe[0] - TOL <= sc[0] and sc[2] <= safe[2] + TOL and safe[1] - TOL <= sc[1] and sc[3] <= safe[3] + TOL):
                bad.append(f"scroll area {sc} outside safe {safe}")
            clipped = inter(r, sc)
            if area(clipped) == 0:
                continue  # scrolled out of view
            if r[0] < sc[0] - TOL or r[2] > sc[2] + TOL:
                bad.append(f"{name!r} {r} is wider than its scroll area {sc}")
            r = clipped
        elif not (safe[0] - TOL <= r[0] and r[2] <= safe[2] + TOL and safe[1] - TOL <= r[1] and r[3] <= safe[3] + TOL):
            bad.append(f"{name!r} {r} outside safe area {safe}")
        if isinstance(w, Gtk.Label):
            lw, lh = w.get_layout().get_pixel_size()
            a = w.get_allocation()
            if lh > a.height + TOL or lw > a.width + TOL:
                bad.append(f"{name!r} text {lw}x{lh} does not fit its allocation {a.width}x{a.height}")
        visible.append((w, r, name))
    for i, (a, ra, na) in enumerate(visible):
        for b, rb, nb in visible[i + 1:]:
            if a in list(ancestors(b)) or b in list(ancestors(a)):
                continue
            ov = inter(ra, rb)
            if ov[2] - ov[0] > TOL and ov[3] - ov[1] > TOL:
                bad.append(f"{na!r} {ra} overlaps {nb!r} {rb}")
    focus = d.focus()
    if isinstance(focus, Gtk.Button):
        r = rect(d, focus)
        sc = next((a for a in ancestors(focus) if isinstance(a, Gtk.ScrolledWindow)), None)
        if sc is not None:
            s = rect(d, sc)
            if r[1] < s[1] - TOL or r[3] > s[3] + TOL:
                bad.append(f"focused {d.button_text(focus)!r} {r} is not inside its scroll area {s}")
    return [f"{what} {b}" if what else b for b in bad]


def press_all(d, limit=14):
    """Tab through every stop; each stop must be on screen. Returns problems."""
    bad = []
    seen = set()
    d.ui.reset_focus()
    for _ in range(limit):
        d.key("Tab")
        f = d.focus()
        if f is None or id(f) in seen:
            break
        seen.add(id(f))
        bad += problems(d, f"focus={d.focus_text()!r}")
    return bad


def hold_running(d, step=2, fraction=0.42):
    work = d.w.work
    (work / "state.json").write_text(json.dumps({"schema": 1, "state": "running", "device": "nvme0n1", "step": step, "fraction": fraction, "written": "started", "partitions": 11}))
    (work / "write-started").write_text("")
    fd = os.open(work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


def longest_message():
    return max(core.MESSAGES, key=lambda k: len(core.MESSAGES[k][0]))
