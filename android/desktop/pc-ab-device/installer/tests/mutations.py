#!/usr/bin/env python3
"""Mutation check: remove one guard at a time in a scratch copy and require the test suite to fail.
Usage: mutations.py [--jobs N] [--only SUBSTRING] [--skip PREFIX]   (needs python >= 3.11; browser tests are included when Chrome exists)
Each mutation is (id, file, [(old, new, occurrence)...], suites). A guard counts as covered when a suite fails."""
import concurrent.futures
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

INSTALLER = Path(__file__).resolve().parent.parent
PC_AB = INSTALLER.parent
CORE, SERVER, APP, APPLY = "installer/core.py", "installer/server.py", "installer/web/app.js", "awai-pc-install.py"
C, W = "tests/test_core.py", "tests/test_web_and_build.py"
CT = "tests/test_controller.py"
G = "tests/test_gui.py"
L = "tests/test_layout.py"
M = [
    ("confirmed flag (core)", CORE, [('    if request.get("confirmed") is not True:\n        raise Refusal("not-confirmed")', "    pass", 1)], [C]),
    ("confirmed flag must be exactly True (core)", CORE, [('    if request.get("confirmed") is not True:', '    if not request.get("confirmed"):', 1)], [C]),
    ("identity before image prep", CORE, [('    if identity(host, name) != confirmed:\n        raise Refusal("identity-changed")\n\n    archive_sha', "    archive_sha", 1)], [C]),
    ("identity immediately before writing", CORE, [('    if identity(host, name) != confirmed:\n        raise Refusal("identity-changed")\n    plan, expected', "    plan, expected", 1)], [C]),
    ("target checks before image prep", CORE, [("    require_target(host, name, boot)\n    if identity(host, name) != confirmed:\n        raise Refusal(\"identity-changed\")\n\n    archive_sha", "    if identity(host, name) != confirmed:\n        raise Refusal(\"identity-changed\")\n\n    archive_sha", 1)], [C]),
    ("target checks immediately before writing", CORE, [("    require_target(host, name, boot)\n    if identity(host, name) != confirmed:\n        raise Refusal(\"identity-changed\")\n    plan, expected", "    if identity(host, name) != confirmed:\n        raise Refusal(\"identity-changed\")\n    plan, expected", 1)], [C]),
    ("whole NVMe name", CORE, [("    if not host.target_re().fullmatch(path):\n        problems.append(\"not-nvme\")", "    pass", 1)], [C]),
    ("block device", CORE, [("    if not host.is_block(path):\n        problems.append(\"not-block\")", "    pass", 1)], [C]),
    ("TYPE disk / RO 0", CORE, [('        if kind != ["disk", "0"]:', "        if False:", 1)], [C]),
    ("no partitions", CORE, [('.splitlines() if l.strip()]) != 1:\n            problems.append("has-partitions")', '.splitlines() if l.strip()]) < 0:\n            problems.append("has-partitions")', 1)], [C]),
    ("512-byte sectors", CORE, [('.strip() != str(SECTOR):', ".strip() == 'x':", 1)], [C]),
    ("nothing mounted", CORE, [('if any(l.strip() for l in _out(host, ["lsblk", "-nr", "-o", "MOUNTPOINTS", path]).splitlines()):', "if False:", 1)], [C]),
    ("wipefs signatures", CORE, [("if any(s not in (\"gpt\", \"PMBR\") for s in signatures):", "if False:", 1)], [C]),
    ("boot medium", CORE, [("    elif name in boot:", "    elif False:", 1)], [C]),
    ("boot medium unknown", CORE, [("    if boot is None:", "    if False:", 1)], [C]),
    ("archive.sha256", CORE, [("    if _hash_file(archive, lambda f: progress(0.15 * f)) != archive_sha:", "    if False:", 1)], [C]),
    ("raw sha256 (final re-hash)", CORE, [("    if _hash_file(raw, lambda f: progress(0.6 + 0.4 * f)) != image_sha:", "    if False:", 1)], [C]),
    ("raw sha256 (both layers: stream + re-hash)", CORE, [("    if _hash_file(raw, lambda f: progress(0.6 + 0.4 * f)) != image_sha:", "    if False:", 1), ("    if digest.hexdigest() != image_sha:", "    if False:", 1)], [C]),
    ("pins are valid files", CORE, [("    if not m or m[2] != expected_name:", "    if not m:", 1)], [C]),
    ("plan existing == []", CORE, [('    if plan["existing"] != []:', "    if False:", 1)], [C]),
    ("plan new count", CORE, [('    if len(plan["new"]) != expected:', "    if False:", 1)], [C]),
    ("record sourceSha256", CORE, [('rec.get("sourceSha256") != image_sha or ', "", 1)], [C]),
    ("record existingUnchanged", CORE, [('rec.get("existingUnchanged") is not True\n            or ', "", 1)], [C]),
    ("record 11 readbacks", CORE, [("or len(readback) != expected\n            or ", "or ", 1)], [C]),
    ("record readback digests", CORE, [('            or not all(isinstance(v, dict) and re.fullmatch(r"[0-9a-f]{64}", str(v.get("sha256"))) for v in readback.values())):', "            ):", 1)], [C]),
    ("sgdisk -v exit code", CORE, [("    if r.returncode != 0 or \"No problems found\" not in r.stdout:", "    if \"No problems found\" not in r.stdout:", 1)], [C]),
    ("sgdisk -v output", CORE, [("    if r.returncode != 0 or \"No problems found\" not in r.stdout:", "    if r.returncode != 0:", 1)], [C]),
    ("sync", CORE, [('    if host.run(["sync"]).returncode != 0:', "    if False:", 1)], [C]),
    ("lock (exactly one install)", CORE, [("            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)", "            pass", 1)], [C, CT]),
    ("record/marker blocks restart", CORE, [("        if write_started(work):\n            raise Blocked()", "        pass", 1)], [C]),
    ("write marker before first change", CORE, [('        if event == "write-start":', "        if False:", 1)], [C, CT]),
    ("dead worker is interrupted", CORE, [('st.get("state") == "running" and not starting and not lock_held(work)', 'st.get("state") == "running" and not starting and False', 1)], [C, CT]),
    ("apply: write-start precedes GPT change", APPLY, [('        report("write-start", 0, total)\n', "", 1)], [C]),
    ("build refuses a font with missing glyphs", "installer/build-overlay.py", [("    if missing:\n        fail(", "    if False:\n        fail(", 1)], [W]),
    ("grub text entry option", "installer/boot/grubsrcd.cfg", [(" iomem=relaxed awai.installer=text", " iomem=relaxed", 1)], [W]),
    ("grub stock kernel option kept", "installer/boot/grubsrcd.cfg", [("$archiso_param iomem=relaxed\n", "$archiso_param\n", 1)], [W]),
    ("syslinux default entry", "installer/boot/sysresccd_sys.cfg", [("MENU DEFAULT\n", "", 1)], [W]),
    ("syslinux stock append kept", "installer/boot/sysresccd_sys.cfg", [("archisolabel=RESCUE1303 iomem=relaxed awai.installer=text", "archisolabel=RESCUE1303 awai.installer=text", 1)], [W]),
    ("grub entry order (text first)", "installer/boot/grubsrcd.cfg", [("menuentry 'Install Awai OS' {", "menuentry 'Install Awai OS (text)' {", 1)], [W]),
    ("overlay maps boot menus", "installer/build-overlay.py", [('"-overwrite", "on",', "", 1)], [W]),
    ("ENOSPC while unpacking -> no-space", CORE, [('raise Refusal("no-space" if e.errno == errno.ENOSPC else "image-failed", str(e))', 'raise Refusal("image-failed", str(e))', 1)], [C]),
    ("free-space pre-check before unpacking", CORE, [("if shutil.disk_usage(work).free < os.path.getsize(archive):", "if False:", 1)], [C]),
    ("ENOSPC outside unpacking -> no-space", CORE, [('rep.fail(Refusal("no-space" if e.errno == errno.ENOSPC else "internal"', 'rep.fail(Refusal("internal"', 1)], [C]),
    ("controller: ticket is one-shot", "installer/controller.py", [("ticket, self.ticket = self.ticket, None", "ticket = self.ticket", 1)], [CT]),
    ("controller: explicit confirmed flag required", "installer/controller.py", [('if confirmed is not True or not ticket.get("asked"):', 'if not ticket.get("asked"):', 1)], [CT]),
    ("controller: confirmation must have been opened", "installer/controller.py", [('if confirmed is not True or not ticket.get("asked"):', 'if confirmed is not True:', 1)], [CT]),
    ("controller: cancel closes the confirmation for good", "installer/controller.py", [("        self.confirming = False\n        if self.ticket:\n            self.ticket[\"asked\"] = False", "        self.confirming = False", 1)], [CT]),
    ("controller: request carries confirmed true", "installer/controller.py", [('json.dump({"device": ticket["device"], "confirmed": True,', 'json.dump({"device": ticket["device"], "confirmed": False,', 1)], [CT]),
    ("controller: one empty SSD is preselected", "installer/controller.py", [("if self.selected is None and len(eligible) == 1:", "if False:", 1)], [CT]),
    ("controller: choosing never un-chooses", "installer/controller.py", [("        self.selected = name  # choosing never un-chooses", "        self.selected = None if self.selected == name else name  # choosing never un-chooses", 1)], [CT]),
    ("controller: several SSDs are told apart on the card", "installer/controller.py", [("who = identify(d) if many and d[\"eligible\"] else \"\"", "who = \"\"", 1)], [CT]),
    ("controller: a shared reason is said once", "installer/controller.py", [('"、".join(dict.fromkeys(T["reasons"].get(p, T["reasons"]["inspect-failed"]) for p in shown))', '"、".join(T["reasons"].get(p, T["reasons"]["inspect-failed"]) for p in shown)', 1)], [CT]),
    ("controller: ask refused while busy", "installer/controller.py", [("            if self.busy():\n                return self._refuse(\"busy\")\n            self.ticket[\"asked\"] = True", "            self.ticket[\"asked\"] = True", 1)], [CT]),
    ("controller: busy checked at start", "installer/controller.py", [('            if self.busy():\n                return self._fail_to_pick("busy")', "", 1)], [CT]),
    ("controller: busy checked at review", "installer/controller.py", [('            if self.busy():\n                return self._refuse("busy")', "", 1)], [CT]),
    ("controller: power off asks once", "installer/controller.py", [('        if not self.armed:\n            self.armed = True\n            return "armed"\n', "", 1)], [CT]),
    ("controller: power refused while writing", "installer/controller.py", [('if self.screen == "progress" or self.busy():', "if False:", 1)], [CT]),
    ("controller: leaving the button disarms it", "installer/controller.py", [("    def power_blur(self):\n        self.armed = False", "    def power_blur(self):\n        pass", 1)], [CT]),
    ("controller: reboot refused while writing", "installer/controller.py", [("    def reboot(self):\n        if self.busy():\n            return \"refused\"\n", "    def reboot(self):\n", 1)], [CT]),
    ("controller: dismiss only when nothing was written", "installer/controller.py", [('or st.get("written") != "none" or self.busy():', "or self.busy():", 1)], [CT]),
    ("controller: write started blocks review", "installer/controller.py", [("            if core.write_started(self.work):\n                return self._refuse(\"record-exists\")", "", 1)], [CT]),
    ("controller: detached worker", "installer/controller.py", [("start_new_session=True", "start_new_session=False", 1)], [CT]),
    ("controller: running state decides the screen", "installer/controller.py", [('        if st["state"] == "running":\n            self.screen = "progress"', '        if False:\n            self.screen = "progress"', 1)], [CT]),
    ("keys: modifiers swallowed", "installer/keys.py", [("    if state & (CTRL | ALT | META):\n        return True", "    if False:\n        return True", 1)], [G]),
    ("keys: function keys swallowed", "installer/keys.py", [('if re.fullmatch(r"F\\d+", keyname) or', "if False or", 1)], [G]),
    ("gui: primary action is the first tab stop", "installer/gui.py", [("chain = [w for w in (right, left) if w is not None]", "chain = [w for w in (left, right) if w is not None]", 1)], [G]),
    ("gui: power off disabled while installing", "installer/gui.py", [('enabled=view["screen"] != "progress")', "enabled=True)", 1)], [G]),
    ("gui: confirmation starts on やめる", "installer/gui.py", [('else "askCancel"\n', 'else "askGo"\n', 1)], [G]),
    ("gui: everything behind the confirmation is inert", "installer/gui.py", [("        self.base.set_sensitive(False)", "        pass", 1)], [G]),
    ("gui: Esc is やめる / 戻る", "installer/gui.py", [("        if self.c.confirming:\n            self.on_cancel()\n            return True\n        if self.c.screen == \"review\":", "        if self.c.screen == \"review\":", 1)], [G]),
    ("gui: the chosen SSD goes forward on Enter", "installer/gui.py", [("        if self.c.selected == name:\n            self.on_review()\n            return\n", "", 1)], [G]),
    ("gui: boot focus is never power", "installer/gui.py", [('"pick": ("review" if view["selected"] else None, "card:first")', '"pick": ("power",)', 1)], [G]),
    ("gui: a screen that appears by itself ignores held keys", "installer/gui.py", [('return self.c.screen in ("done", "failed") and', 'return False and', 1)], [G]),
    ("gui: arrows stay inside the confirmation", "installer/gui.py", [('        self.nav_v = self.nav_h = ["askCancel", "askGo"]', "        pass", 1)], [G]),
    ("gui: arrows skip disabled controls", "installer/gui.py", [("usable = lambda k: k in self.widgets and self.widgets[k].get_sensitive()", "usable = lambda k: k in self.widgets", 1)], [G]),
    ("gui: back up from the buttons lands on the chosen SSD", "installer/gui.py", [('            target = "card:" + self.c.selected  # coming back', '            pass  # coming back', 1)], [G]),
    ("gui: selecting moves on to 内容を確認", "installer/gui.py", [('        self.want_focus = "review"\n', "", 1)], [G]),
    ("gui: the hint names the focused action", "installer/gui.py", [("        self.hint.set_text(self.hint_text())", '        self.hint.set_text("")', 1)], [G]),
    ("gui: focus ring is thick", "installer/gui.py", [('ring = f"inset 0 0 0 {max(3, round(5 * u))}px #f0a000"', 'ring = "inset 0 0 0 1px #f0a000"', 1)], [G]),
    ("gui: a focused button is filled", "installer/gui.py", [("button.btn:focus {{ background: #123a80; box-shadow: {ring}; }}", "button.btn:focus {{ box-shadow: {ring}; }}", 1)], [G]),
    ("gui: safe margin", "installer/gui.py", [("self.sx, self.sy = round(self.safe * width), round(self.safe * height)", "self.sx, self.sy = 0, 0", 1)], [L]),
    ("gui: the unit is reduced until it fits", "installer/gui.py", [("            u = max(floor, u * min(0.97, self.H / need))", "            break", 1)], [L]),
    ("gui: the list scrolls inside its own area", "installer/gui.py", [("Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)", "Gtk.PolicyType.NEVER, Gtk.PolicyType.NEVER)", 1)], [L]),
    ("gui: labels wrap", "installer/gui.py", [("    def label(self, text, cls, wrap=True, xalign=0.0):", "    def label(self, text, cls, wrap=False, xalign=0.0):", 1)], [L]),
    ("gui: the right margin of the content", "installer/gui.py", [("            self.main.set_margin_end(max(self.sx, self.W - round(0.97 * self.W)))", "            self.main.set_margin_end(0)", 1)], [L]),
    ("gui: the primary monitor, else the first", "installer/gui.py", [("    chosen = primary or (display.get_monitor(0) if display.get_n_monitors() else None)", "    chosen = None", 1)], [L]),
    ("session: monitors at the preferred mode", "installer/xsession.sh", [("xrandr --auto 2>&1 ||", "true ||", 1)], [W]),
    ("session: one primary monitor", "installer/xsession.sh", [('xrandr --output "$primary" --primary --auto', "true", 1)], [W]),
    ("session: xrandr query is logged", "installer/xsession.sh", [('} > "$work/xrandr.txt" 2>&1', "} > /dev/null 2>&1", 1)], [W]),
    ("session: visible pointer", "installer/xsession.sh", [("xsetroot -cursor_name left_ptr", "true", 1)], [W]),
    ("start: pointer not hidden", "installer/start.sh", [("-nolisten tcp >", "-nolisten tcp -nocursor >", 1)], [W]),
    ("gui: only the bundled face", "installer/gui.py", [('* {{ font-family: "Noto Sans JP"; color: #1b2433; }}', '* {{ font-family: "Noto Sans JP", sans-serif; color: #1b2433; }}', 1)], [W]),
    ("gui: power question survives the poll redraw", "installer/gui.py", [('if k not in ("state", "armed")}', 'if k != "state"}', 1)], [G]),
    ("gui: rebuild is not a blur", "installer/gui.py", [('        if getattr(self, "rebuilding", False):\n            return\n', "", 1)], [G]),
    ("gui: card tag centred", "installer/gui.py", [("        tagl.set_valign(Gtk.Align.CENTER)\n", "", 1), ("        tagl.set_yalign(0.5)\n", "        tagl.set_yalign(0.0)\n", 1)], [G]),
    ("gui: product title line pitch", "installer/gui.py", [("        self.line_height(self.prod, round(48 * u * 1024))", "        pass", 1)], [G]),
    ("gui: toplevel focus ensured", "installer/gui.py", [("    if not win.has_toplevel_focus() and gw is not None:", "    if False:", 1)], [G]),
    ("gui: rail proportion", "installer/gui.py", [("self.rail.set_size_request(round(0.305 * width), -1)", "self.rail.set_size_request(round(0.2 * width), -1)", 1)], [G]),
    ("gui: bundled fonts registered", "installer/gui.py", [("    os.environ[\"FONTCONFIG_FILE\"] = conf\n", "", 1)], [W]),
    ("start: GTK probe before X", "installer/start.sh", [("    || text \"screen installer unavailable (Python GTK 3 bindings not available); using the text installer.\"", "    || true", 1)], [W]),
    ("start: window restarted until three quick deaths", "installer/start.sh", [("if (( quick >= 3 )); then", "if (( quick >= 99 )); then", 1)], [W]),
    ("session: blanking off", "installer/xsession.sh", [("xset s off; xset s noblank; xset -dpms;", "true;", 1)], [W]),
    ("session: no window manager", "installer/xsession.sh", [("exec \"$python\"", "xfwm4 &\nexec \"$python\"", 1)], [W]),
    ("overlay carries fonts and assets", "installer/build-overlay.py", [('for folder in ("fonts", "assets"):', 'for folder in ("assets",):', 1)], [W]),
    ("read_state retries a partial read", CORE, [("for attempt in range(4):", "for attempt in range(1):", 1)], [C]),
    ("text installer follows a running install", "installer/text_installer.py", [('    if core.status(a.work_dir).get("state") == "running" or core.lock_held(a.work_dir):\n        return follow(a.work_dir)', "    pass", 1)], [W]),
    ("overlay copies canonical installer", "installer/build-overlay.py", [('shutil.copy(os.path.join(PC_AB, "awai-pc-install.py"), awai)', 'open(os.path.join(awai, "awai-pc-install.py"), "w").write("#")', 1)], [W]),
    ("overlay checks stock iso sha", "installer/build-overlay.py", [("    if sha256_file(args.stock_iso) != args.stock_iso_sha256:", "    if False:", 1)], [W]),
    ("overlay checks raw sha", "installer/build-overlay.py", [("    if raw_digest(args.image_zst) != args.image_sha256:", "    if False:", 1)], [W]),
]


def apply(path, edits):
    text = path.read_text()
    for old, new, occ in edits:
        if old not in text:
            return None
        idx = -1
        for _ in range(occ):
            idx = text.index(old, idx + 1)
        text = text[:idx] + new + text[idx + len(old):]
    path.write_text(text)
    return True


def run(m, py):
    name, file, edits, suites = m
    tmp = Path(tempfile.mkdtemp(prefix="awai-mut-"))
    try:
        shutil.copytree(PC_AB, tmp / "pc", ignore=shutil.ignore_patterns("screenshots", "__pycache__", "evidence", "kvm", "patches"))
        target = tmp / "pc" / file if not file.startswith("installer/") and file != "awai-pc-install.py" else tmp / "pc" / file
        if not apply(target, edits):
            return name, "NOT-APPLIED", ""
        for suite in suites:
            r = subprocess.run([py, "-m", "unittest", "-f", "-q", str(Path("installer") / suite)[:-3].replace("/", ".")], cwd=tmp / "pc", capture_output=True, text=True, timeout=900)
            if r.returncode != 0:
                return name, "killed", suite
        return name, "SURVIVED", ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    jobs = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else 4
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else ""
    py = sys.executable
    skip = sys.argv[sys.argv.index("--skip") + 1] if "--skip" in sys.argv else None
    todo = [m for m in M if only in m[0] and not (skip and m[0].startswith(skip))]
    results = []
    with concurrent.futures.ThreadPoolExecutor(jobs) as ex:
        for res in ex.map(lambda m: run(m, py), todo):
            print(f"{res[1]:<12} {res[0]}  {res[2]}", flush=True)
            results.append(res)
    bad = [r for r in results if r[1] != "killed"]
    print(f"\n{len(results) - len(bad)}/{len(results)} mutations killed")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
