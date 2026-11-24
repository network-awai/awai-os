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
C, S, W, B = "tests/test_core.py", "tests/test_server.py", "tests/test_web_and_build.py", "tests/test_browser.py"
M = [
    ("typed-name (core)", CORE, [('    if request.get("typed") != name:\n        raise Refusal("typed-name")', "    pass", 1)], [C]),
    ("typed-name (server)", SERVER, [('if body.get("typed") != ticket["device"]:', "if False:", 1)], [S]),
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
    ("lock (exactly one install)", CORE, [("            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)", "            pass", 1)], [C, S]),
    ("record/marker blocks restart", CORE, [("        if write_started(work):\n            raise Blocked()", "        pass", 1)], [C]),
    ("write marker before first change", CORE, [('        if event == "write-start":', "        if False:", 1)], [C, S]),
    ("dead worker is interrupted", CORE, [('st.get("state") == "running" and not starting and not lock_held(work)', 'st.get("state") == "running" and not starting and False', 1)], [C, S]),
    ("apply: write-start precedes GPT change", APPLY, [('        report("write-start", 0, total)\n', "", 1)], [C]),
    ("server token", SERVER, [("if not secrets.compare_digest(token.encode(), app.token.encode()):", "if False:", 1)], [S]),
    ("server Host check", SERVER, [('if self.headers.get("Host") != allowed_host:', "if False:", 1)], [S]),
    ("server Origin match", SERVER, [("or (origin is not None and origin != allowed_origin)", "", 1)], [S]),
    ("server Origin required on POST", SERVER, [("if (post and origin is None) or ", "if ", 1)], [S]),
    ("server CSP default-src none", SERVER, [("default-src 'none'; ", "", 1)], [S]),
    ("server CORS absent (adds a header)", SERVER, [('            self.send_header("X-Content-Type-Options", "nosniff")', '            self.send_header("Access-Control-Allow-Origin", "*")', 1)], [S]),
    ("server ticket one-shot", SERVER, [("ticket, self.ticket = self.ticket, None", "ticket = self.ticket", 1)], [S]),
    ("server busy on install", SERVER, [('            if self.busy():\n                return 409, {"error": "busy", "ja": core.MESSAGES["busy"][0]}\n            if core.write_started(self.work):\n                return 409, {"error": "record-exists", "ja": core.MESSAGES["record-exists"][0]}\n            core.ensure_work', '            core.ensure_work', 1)], [S]),
    ("server power refused while writing", SERVER, [('            if self.busy():\n                return 409, {"error": "busy", "ja": core.MESSAGES["busy"][0]}\n            r = self.host.run', "            r = self.host.run", 1)], [S]),
    ("server token never in worker argv", SERVER, [('"--work-dir", work, "--media-dir", media]', '"--work-dir", work, "--media-dir", media, self.token]', 1)], [S]),
    ("detached worker session", SERVER, [("start_new_session=True", "start_new_session=False", 1)], [S]),
    ("UI: power disabled while installing", APP, [('disabled: ui.screen === "progress"', "disabled: false", 1)], [B]),
    ("UI: typed-name gate", APP, [("go.disabled = input.value !== d.name;", "go.disabled = false;", 1), ("const go = h(\"button\", { class: \"btn\", type: \"button\", disabled: true,", "const go = h(\"button\", { class: \"btn\", type: \"button\", disabled: false,", 1)], [B]),
    ("UI: completion only from done", APP, [('if (r.data.state === "done") return showDone();', "if (r.data.state !== \"running\") return showDone();", 1)], [B]),
    ("UI: no completion link", APP, [('rebootTitle:', 'protoLink: "完了画面を見る", rebootTitle:', 1)], [W]),
    ("build refuses a font with missing glyphs", "installer/build-overlay.py", [("    if missing:\n        fail(", "    if False:\n        fail(", 1)], [W]),
    ("CSS: only the bundled face", "installer/web/style.css", [('body { font-family: "Awai JP";', 'body { font-family: "Awai JP", sans-serif;', 1)], [W]),
    ("proportions: rail 30.5vw", "installer/web/style.css", [("grid-template-columns: 30.5vw 1fr", "grid-template-columns: 20vw 1fr", 1)], [B]),
    ("vendor shown with the model", APP, [('((d.model || "").startsWith(d.vendor || "\\0") ? d.model : [d.vendor, d.model].filter(Boolean).join(" ")) || d.name', "d.model || d.name", 1)], [B]),
    ("kiosk policy installed or text fallback", "installer/start.sh", [("if (( ! policy_ok )); then", "if false; then", 1)], [W]),
    ("kiosk policy: devtools disabled", "installer/firefox-policies.json", [('"DisableDeveloperTools": true', '"DisableDeveloperTools": false', 1)], [W]),
    ("text follow tolerates a half-written state", "installer/text_installer.py", [("idle_reads < 2", "idle_reads < 0", 1)], [W]),
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
