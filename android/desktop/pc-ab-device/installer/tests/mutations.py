#!/usr/bin/env python3
"""Mutation check: remove one guard at a time in a scratch copy and require the test suite to fail.
Usage: mutations.py [--jobs N] [--only SUBSTRING]   (needs python >= 3.11; browser tests are included when Chrome exists)
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
M = [
    ("typed-name (core)", CORE, [('    if request.get("typed") != name:\n        raise Refusal("typed-name")', "    pass", 1)], [C]),
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
    ("controller: typed name checked", "installer/controller.py", [('if typed != ticket["device"]:', "if False:", 1)], [CT]),
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
    ("gui: typed-name gate", "installer/gui.py", [("go.set_sensitive(self.c.typed_ok(e.get_text()))", "go.set_sensitive(True)", 1)], [G]),
    ("gui: nothing focused until the first Tab", "installer/gui.py", [("            top.set_focus(None)  # like the heading", "            pass  # like the heading", 1)], [G]),
    ("gui: only the bundled face", "installer/gui.py", [('* {{ font-family: "Noto Sans JP"; color: #1b2433; }}', '* {{ font-family: "Noto Sans JP", sans-serif; color: #1b2433; }}', 1)], [W]),
    ("gui: power question survives the poll redraw", "installer/gui.py", [('if k not in ("state", "armed")}', 'if k != "state"}', 1)], [G]),
    ("gui: rebuild is not a blur", "installer/gui.py", [('        if getattr(self, "rebuilding", False):\n            return\n', "", 1)], [G]),
    ("gui: card tag centred", "installer/gui.py", [("        tag.set_valign(Gtk.Align.CENTER)\n", "", 1), ("        tag.set_yalign(0.5)\n", "        tag.set_yalign(0.0)\n", 1)], [G]),
    ("gui: product title line pitch", "installer/gui.py", [("        self.line_height(prod, round(25 * u * 1024))", "        pass", 1)], [G]),
    ("gui: toplevel focus ensured", "installer/gui.py", [("    if not win.has_toplevel_focus() and gw is not None:", "    if False:", 1)], [G]),
    ("gui: first Tab skips the anchor", "installer/gui.py", [("            self.anchor.set_can_focus(False)\n            try:", "            try:", 1)], [G]),
    ("gui: initial focus is the anchor", "installer/gui.py", [("            top.set_focus(self.anchor)", "            top.set_focus(None)", 1)], [G]),
    ("gui: anchor is not a Tab stop on wrap", "installer/gui.py", [("        if top.get_focus() is self.anchor:  # wrapped", "        if False:  # wrapped", 1)], [G]),
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
    todo = [m for m in M if only in m[0]]
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
