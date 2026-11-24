"""Page text, font coverage, text front end and overlay assembly."""
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core, INSTALLER  # noqa: E402
import glyphs  # noqa: E402
import text_installer  # noqa: E402

PC_AB = INSTALLER.parent
FONT = INSTALLER / "web" / "noto-jp.woff2"
CLIENT_FONT = INSTALLER.parent.parent.parent / "client" / "assets" / "setup-noto-jp.woff2"
# copy that must read exactly as in the approved design (installer.png)
DESIGN_COPY = ["PC に", "インストール", "Awai OS Meiji", "現在", "済み", "Tab で項目を移動", "Enter で選択",
               "インストール先を選ぶ", "Awai OS を入れる空の内蔵 SSD を選んでください。", "内蔵 SSD", "空きディスク",
               "選択可能", "選択済み", "選択不可", "電源を切る", "内容を確認", "デバイスの詳細", "インストール内容を確認",
               "書き込み先と内容を確認してください。", "書き込み先", "Awai OS とユーザーデータ用の区画を作成", "戻る",
               "この SSD にインストール", "インストールしています", "電源を入れたまま、USB を接続してお待ちください。",
               "導入先", "イメージの確認", "SSD への書き込み", "書き込んだ内容の読み戻し", "完了", "進行中", "待機中",
               "インストールが完了しました", "SSD に書き込んだ内容の読み戻しが完了しました。", "確認済み", "区画を確認",
               "再起動して Awai OS をはじめる", "起動画面に戻ったら USB を抜き、内蔵 SSD を選んでください。", "再起動",
               "インストール先が見つかりません", "既存のデータを保護するため、一覧で理由を確認できます。", "既存の区画あり",
               "この PC を起動した USB", "空の内蔵 SSD を接続し、一覧を更新してください。",
               "ここからディスクの消去は実行できません。", "一覧を更新"]


class PageText(unittest.TestCase):
    def setUp(self):
        self.app = (INSTALLER / "web" / "app.js").read_text()

    def test_design_copy_present_verbatim(self):
        for s in DESIGN_COPY:
            self.assertIn(s, self.app + (INSTALLER / "web" / "index.html").read_text(), s)

    def test_only_awai_branding(self):
        everything = self.app + (INSTALLER / "web" / "index.html").read_text() + "".join(ja for ja, _ in core.MESSAGES.values())
        for name in ("SystemRescue", "Sysrescue", "Linux", "Arch", "Firefox", "Mozilla", "archiso"):
            self.assertNotIn(name.lower(), everything.lower(), name)

    def test_no_prototype_completion_link_and_no_erase_control(self):
        self.assertNotIn("完了画面を見る", self.app)
        for word in ("消去する", "ディスクを消", "フォーマット", "erase", "wipe"):
            self.assertNotIn(word, self.app.replace("ディスクの消去は実行できません", ""))

    def test_completion_screen_is_reached_only_from_a_done_state(self):
        calls = [l for l in self.app.splitlines() if "showDone()" in l and "function showDone" not in l]
        self.assertEqual(len(calls), 2)
        for line in calls:
            self.assertIn('state === "done"', line)

    def test_failure_screen_does_not_use_the_completion_wording(self):
        block = self.app[self.app.index("function showFailed"):self.app.index("async function dismiss")]
        for word in ("T.doneTitle", "T.doneSub", "T.verified", "T.reboot", "T.parts"):
            self.assertNotIn(word, block)
        fail_title = re.search(r'failTitle: "([^"]+)"', self.app)[1]
        self.assertNotIn("インストールが完了しました", fail_title)

    def test_no_dead_ends_for_keyboard(self):
        self.assertIn("tabindex=\"-1\"", (INSTALLER / "web" / "index.html").read_text())
        self.assertNotIn("tabindex=\"[1-9]", self.app)


class FontCoverage(unittest.TestCase):
    pin = json.load(open(INSTALLER / "font" / "font-pin.json"))

    def test_font_comes_from_the_pinned_upstream_and_keeps_its_licence(self):
        self.assertRegex(self.pin["commit"], r"^[0-9a-f]{40}$")
        self.assertIn(self.pin["commit"], self.pin["ttf_url"])
        self.assertEqual(hashlib.sha256((INSTALLER / "web" / "font-OFL.txt").read_bytes()).hexdigest(), self.pin["ofl_sha256"])
        self.assertIn("SIL OPEN FONT LICENSE", (INSTALLER / "web" / "font-OFL.txt").read_text())
        self.assertIn("Reserved Font Name 'Source'", (INSTALLER / "web" / "font-OFL.txt").read_text())
        self.assertFalse((INSTALLER / "font-gap.json").exists())
        # the repo's other font asset is left alone (not the bundled one)
        if CLIENT_FONT.exists():
            self.assertNotEqual(FONT.read_bytes(), CLIENT_FONT.read_bytes())

    def test_glyph_list_belongs_to_the_font_file(self):
        glyphs.coverage_of(INSTALLER / "glyphs-noto-jp.json", FONT)
        with tempfile.NamedTemporaryFile(suffix=".woff2") as other:
            other.write(b"wOF2 other")
            other.flush()
            with self.assertRaises(ValueError):
                glyphs.coverage_of(INSTALLER / "glyphs-noto-jp.json", other.name)

    @unittest.skipUnless(subprocess.run(["which", "brotli"], capture_output=True).returncode == 0, "brotli command not installed")
    def test_glyph_list_matches_the_font(self):
        self.assertEqual(glyphs.cmap_codepoints(FONT), set(json.load(open(INSTALLER / "glyphs-noto-jp.json"))["codepoints"]))

    def test_every_character_the_screens_can_show_has_a_glyph(self):
        coverage = glyphs.font_coverage(str(FONT), str(INSTALLER))
        needed = glyphs.required_codepoints(str(INSTALLER))
        self.assertEqual(sorted(c for c in needed if c not in coverage), [])
        for ch in "内蔵電源込書先始失敗0123456789 ./:·、。（）-_%":
            self.assertIn(ord(ch), coverage, ch)

    def test_checker_reports_a_missing_glyph(self):
        coverage = glyphs.font_coverage(str(FONT), str(INSTALLER))
        needed = glyphs.required_codepoints(str(INSTALLER))
        self.assertEqual([c for c in needed if c not in coverage - {ord("蔵")}], [ord("蔵")])

    def test_css_uses_only_the_bundled_face_and_both_weights(self):
        css = (INSTALLER / "web" / "style.css").read_text()
        self.assertRegex(css, r'body \{ font-family: "Awai JP";')
        self.assertNotRegex(css, r'font-family:[^;]*(sans-serif|DejaVu|Noto Sans JP|serif|system-ui)')
        self.assertIn("font-weight: 400 700", css)
        for w in re.findall(r"font-weight: (\d+)", css.replace("font-weight: 400 700", "")):
            self.assertIn(int(w), (400, 500, 700))


class TextFrontEnd(unittest.TestCase):
    def setUp(self):
        self.w = fakes.World()
        self.addCleanup(self.w.cleanup)

    def run_text(self, *answers):
        it = iter(answers)

        def read(prompt):
            try:
                return next(it)
            except StopIteration:
                raise EOFError
        out = io.StringIO()
        with redirect_stdout(out):
            rc = text_installer.main(["--work-dir", str(self.w.work), "--media-dir", str(self.w.media)], host=self.w.host, read=read)
        return rc, out.getvalue()

    def test_install_with_the_same_guards(self):
        dev = str(self.w.dev / "nvme0n1")
        rc, out = self.run_text(dev, "INSTALL nvme0n1")
        self.assertEqual(rc, 0, out)
        self.assertIn("Installed and verified all 11 partitions", out)
        self.assertIn("not selectable", out)

    def test_wrong_phrase_cancels_without_writing(self):
        rc, out = self.run_text(str(self.w.dev / "nvme0n1"), "install nvme0n1")
        self.assertEqual(rc, 0)
        self.assertIn("Cancelled", out)
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())

    def test_ineligible_target_refused(self):
        self.w.edit_disk("nvme0n1", children=[{}])
        rc, out = self.run_text(str(self.w.dev / "nvme0n1"), "INSTALL nvme0n1")
        self.assertEqual(rc, 1)
        self.assertIn("already has partitions", out)

    def test_not_a_whole_nvme_path(self):
        rc, out = self.run_text("/dev/sda")
        self.assertEqual(rc, 1)

    def test_a_half_written_state_file_is_not_an_end_state(self):
        import fcntl
        self.w.work.mkdir(mode=0o700)
        fd = os.open(self.w.work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        (self.w.work / "state.json").write_text(json.dumps({"state": "running", "step": 2, "fraction": 0.5}))
        calls = []

        def wait(_):
            calls.append(1)
            if len(calls) == 1:
                (self.w.work / "state.json").write_text("")  # truncated by a non-atomic writer
            elif len(calls) == 2:
                (self.w.work / "state.json").write_text(json.dumps({"state": "done", "partitions": 11, "record": "r"}))
                os.close(fd)
        out = io.StringIO()
        with redirect_stdout(out):
            rc = text_installer.follow(str(self.w.work), wait=wait)
        self.assertEqual(rc, 0, out.getvalue())
        self.assertIn("Installed and verified", out.getvalue())

    def test_follows_a_running_install_instead_of_starting_another(self):
        import fcntl
        self.w.work.mkdir(mode=0o700)
        fd = os.open(self.w.work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        (self.w.work / "state.json").write_text(json.dumps({"state": "running", "step": 2, "fraction": 0.5}))

        def finish():
            tmp = self.w.work / "state.json.tmp"  # atomic, like the real writer
            tmp.write_text(json.dumps({"state": "done", "partitions": 11, "record": "r"}))
            os.replace(tmp, self.w.work / "state.json")
            os.close(fd)
        import threading
        t = threading.Timer(0.3, finish)
        t.start()
        real_sleep = __import__("time").sleep
        with mock.patch.object(text_installer.time, "sleep", lambda s: real_sleep(0.2)):
            rc, out = self.run_text()
        t.join()
        self.assertEqual(rc, 0, out)
        self.assertIn("still running", out)
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())


class Launcher(unittest.TestCase):
    def run_start(self, *args, cmdline=None, path_tools=(), extra_env=None, timeout=60, real_policy_dirs=False):
        tmp = Path(tempfile.mkdtemp(prefix="awai-start-"))
        self.addCleanup(__import__("shutil").rmtree, tmp, True)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        for t in ("python3", "grep", "install", "head", "seq", "kill", "sleep", "dirname", "cat", "rm", "readlink", "mkdir"):
            src = __import__("shutil").which(t)
            (bin_dir / t).symlink_to(src)
        for t in path_tools:
            if t == "firefox-esr":  # like the base medium: /usr/bin/firefox-esr -> /opt/firefox-esr/firefox-esr
                real = tmp / "opt" / "firefox-esr" / "firefox-esr"
                real.parent.mkdir(parents=True)
                real.write_text("#!/bin/sh\nexit 1\n")
                real.chmod(0o755)
                (bin_dir / t).symlink_to(real)
                continue
            (bin_dir / t).write_text("#!/bin/sh\nexit 1\n")
            (bin_dir / t).chmod(0o755)
        env = {"PATH": str(bin_dir) + ":/bin:/usr/bin" if False else str(bin_dir), "AWAI_WORK_DIR": str(tmp / "work"),
               "AWAI_MEDIA_DIR": str(tmp), "AWAI_PYTHON": sys.executable,
               "AWAI_ETC": str(tmp / "etc"), **({} if real_policy_dirs else {"AWAI_POLICY_DIRS": str(tmp / "policies")}), **(extra_env or {})}
        self.last_tmp = tmp
        return subprocess.run(["/bin/bash", str(INSTALLER / "start.sh"), *args], env=env, capture_output=True, text=True, input="\n", timeout=timeout)

    def test_forced_text_mode(self):
        r = self.run_start("--text")
        self.assertIn("text mode requested", r.stderr)
        self.assertIn("Offline PC installer", r.stdout)

    def test_missing_x_falls_back_to_text_with_one_line_reason(self):
        r = self.run_start()
        self.assertRegex(r.stderr, r"AWAI INSTALLER: screen installer unavailable \(xinit not found\); using the text installer\.")
        self.assertEqual(len([l for l in r.stderr.splitlines() if l.startswith("AWAI INSTALLER")]), 1)
        self.assertIn("Offline PC installer", r.stdout)

    def test_policy_is_installed_before_the_browser_starts_and_is_required(self):
        r = self.run_start(path_tools=("xinit", "firefox-esr"))
        installed = self.last_tmp / "policies" / "policies.json"
        self.assertEqual(json.loads(installed.read_text()), json.loads((INSTALLER / "firefox-policies.json").read_text()))
        script = (INSTALLER / "start.sh").read_text()
        self.assertLess(script.index("policies.json"), script.index("xinit \"$here/xsession.sh\""))
        r = self.run_start(path_tools=("xinit", "firefox-esr"), extra_env={"AWAI_POLICY_DIRS": "/proc/awai-no-such-dir"})
        self.assertIn("could not install the browser lock-down policy", r.stderr)
        self.assertIn("Offline PC installer", r.stdout)

    def test_only_firefox_esr_exists_like_the_base_medium(self):
        """The base medium has /usr/bin/firefox-esr and no plain `firefox`: the policy goes next to the real binary and to /etc."""
        r = self.run_start(path_tools=("xinit", "firefox-esr"), real_policy_dirs=True)
        tmp = self.last_tmp
        self.assertNotIn("firefox not found", r.stderr)
        self.assertNotIn("firefox-esr not found", r.stderr)
        self.assertIn("X or the browser stopped 3 times", r.stderr)  # got as far as launching X
        want = (INSTALLER / "firefox-policies.json").read_text()
        self.assertEqual((tmp / "opt" / "firefox-esr" / "distribution" / "policies.json").read_text(), want)
        self.assertEqual((tmp / "etc" / "firefox-esr" / "policies" / "policies.json").read_text(), want)
        self.assertEqual((tmp / "etc" / "firefox" / "policies" / "policies.json").read_text(), want)

    def test_missing_browser_is_reported_by_its_real_name(self):
        r = self.run_start(path_tools=("xinit",))
        self.assertIn("firefox-esr not found", r.stderr)
        self.assertIn("Offline PC installer", r.stdout)
        r = self.run_start(path_tools=("xinit", "firefox"))  # a plain firefox is accepted too
        self.assertNotIn("not found", r.stderr)

    def test_session_starts_the_esr_binary(self):
        tmp = Path(tempfile.mkdtemp(prefix="awai-xs-"))
        self.addCleanup(__import__("shutil").rmtree, tmp, True)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        for t in ("install", "rm", "cat", "mkdir"):
            (bin_dir / t).symlink_to(__import__("shutil").which(t))
        (bin_dir / "firefox-esr").write_text(f'#!/bin/sh\necho "$@" > "{tmp}/args"\n')
        (bin_dir / "firefox-esr").chmod(0o755)
        (tmp / "work").mkdir()
        subprocess.run(["/bin/bash", str(INSTALLER / "xsession.sh"), "/run/x/launch.html", str(tmp / "work")], env={"PATH": str(bin_dir)}, check=True)
        args = (tmp / "args").read_text()
        self.assertIn("--kiosk", args)
        self.assertIn("file:///run/x/launch.html", args)

    def test_policy_locks_the_kiosk_down(self):
        pol = json.loads((INSTALLER / "firefox-policies.json").read_text())["policies"]
        for key in ("DisableDeveloperTools", "BlockAboutConfig", "DisablePrivateBrowsing", "DisableSafeMode"):
            self.assertIs(pol[key], True, key)
        self.assertEqual(pol["WebsiteFilter"]["Block"], ["<all_urls>"])
        self.assertTrue(all(e.startswith(("http://127.0.0.1/", "file:///run/awai-pc-installer/")) for e in pol["WebsiteFilter"]["Exceptions"]))
        self.assertTrue(pol["PopupBlocking"]["Locked"])
        self.assertEqual(pol["Preferences"]["ui.key.accelKey"]["Status"], "locked")

    def test_dead_screen_during_a_write_follows_the_running_install_and_offers_no_target(self):
        import fcntl, threading
        tmp = Path(tempfile.mkdtemp(prefix="awai-follow-"))
        self.addCleanup(__import__("shutil").rmtree, tmp, True)
        work = tmp / "work"
        work.mkdir(mode=0o700)
        fd = os.open(work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)  # the detached worker, still writing
        (work / "write-started").write_text("")
        (work / "state.json").write_text(json.dumps({"state": "running", "step": 2, "fraction": 0.4, "written": "started"}))

        def finish():
            (work / "install-record.json").write_text("{}")
            (work / "state.json.tmp").write_text(json.dumps({"state": "done", "partitions": 11, "record": "r", "step": 3, "fraction": 1}))
            os.replace(work / "state.json.tmp", work / "state.json")
            os.close(fd)
        timer = threading.Timer(4, finish)
        timer.start()
        self.addCleanup(timer.cancel)
        r = self.run_start(path_tools=("xinit", "firefox-esr"), extra_env={"AWAI_WORK_DIR": str(work)})
        self.assertIn("an installation is still running", r.stdout)
        self.assertIn("step 2/3", r.stdout)
        self.assertIn("Installed and verified all 11 partitions", r.stdout)
        for offered in ("Whole NVMe path", "type INSTALL", "not selectable", "eligible"):
            self.assertNotIn(offered, r.stdout)
        self.assertEqual(r.returncode, 0)

    def test_failing_x_falls_back_to_text(self):
        r = self.run_start(path_tools=("xinit", "firefox-esr"))
        self.assertIn("X or the browser stopped 3 times", r.stderr)
        self.assertIn("Offline PC installer", r.stdout)


class BootMenus(unittest.TestCase):
    stock = PC_AB / "installer" / "tests" / "stock-bootcfg"

    def grub_entries(self, path):
        text = path.read_text()
        out = {}
        for m in re.finditer(r"menuentry '([^']+)' \{(.*?)\n\}", text, re.S):
            lines = {k: v.strip() for k, v in re.findall(r"^\s*(linux|initrd) (.*)$", m[2], re.M)}
            out[m[1]] = lines
        return out

    def syslinux_entries(self, path):
        out = {}
        for block in re.split(r"\n(?=LABEL )", path.read_text()):
            if not block.startswith("LABEL "):
                continue
            label = re.search(r"MENU LABEL (.*)", block)
            if label:
                out[label[1].strip()] = {"linux": re.search(r"^LINUX (.*)$", block, re.M), "initrd": re.search(r"^INITRD (.*)$", block, re.M),
                                         "append": re.search(r"^APPEND (.*)$", block, re.M), "default": "MENU DEFAULT" in block}
        return out

    def test_stock_files_are_the_ones_we_derived_from(self):
        for line in (self.stock / "SHA256SUMS").read_text().splitlines():
            digest, name = line.split()
            self.assertEqual(hashlib.sha256((self.stock / name).read_bytes()).hexdigest(), digest, name)

    def test_grub_entries_default_first_text_second_stock_parameters_unchanged(self):
        ours = self.grub_entries(INSTALLER / "boot" / "grubsrcd.cfg")
        stock = self.grub_entries(self.stock / "grubsrcd.cfg")
        names = list(ours)
        self.assertEqual(names[:2], ["Install Awai OS", "Install Awai OS (text)"])
        base = stock["Boot SystemRescue using default options"]
        self.assertEqual(ours["Install Awai OS"], base)  # default entry = stock default line for line
        text = dict(base, linux=base["linux"] + " awai.installer=text")
        self.assertEqual(ours["Install Awai OS (text)"], text)
        nomodeset = stock["Boot SystemRescue using basic display drivers (nomodeset)"]
        self.assertEqual(ours["Install Awai OS (basic display, nomodeset)"], nomodeset)
        for entry in [e for n, e in ours.items() if n.startswith("Install")]:
            self.assertIn("/sysresccd/boot/x86_64/vmlinuz archisobasedir=sysresccd $archiso_param iomem=relaxed", entry["linux"])
            self.assertEqual(entry["initrd"], base["initrd"])
        grub = (INSTALLER / "boot" / "grubsrcd.cfg").read_text()
        self.assertIn("set default=0", grub)
        self.assertRegex(grub, r"set timeout=([1-9]|10)\b")
        self.assertIn("source /boot/grub/custom.cfg", grub)
        # everything outside the menu (display, serial, fallback, archiso label) is the stock text
        stock_text = (self.stock / "grubsrcd.cfg").read_text()
        for needle in ('archiso_param="archisolabel=RESCUE1303"', "set fallback=1", "loadfont /boot/grub/font.pf2", "terminal_input --append serial"):
            self.assertIn(needle, stock_text)
            self.assertIn(needle, grub)

    def test_syslinux_entries_default_first_text_second_stock_parameters_unchanged(self):
        ours = self.syslinux_entries(INSTALLER / "boot" / "sysresccd_sys.cfg")
        stock = self.syslinux_entries(self.stock / "sysresccd_sys.cfg")
        names = list(ours)
        self.assertEqual(names[:2], ["Install Awai OS", "Install Awai OS (text)"])
        self.assertTrue(ours["Install Awai OS"]["default"])
        g = lambda e, k: e[k][1] if e[k] else None
        base = stock["Boot SystemRescue using default options"]
        for name, extra, src in (("Install Awai OS", "", base), ("Install Awai OS (text)", " awai.installer=text", base),
                                 ("Install Awai OS (basic display, nomodeset)", "", stock["Boot SystemRescue using basic display drivers (nomodeset)"])):
            self.assertEqual(g(ours[name], "linux"), g(src, "linux"))
            self.assertEqual(g(ours[name], "initrd"), g(src, "initrd"))
            self.assertEqual(g(ours[name], "append"), g(src, "append") + extra)
        head = (INSTALLER / "boot" / "sysresccd_head.cfg").read_text()
        self.assertIn("TIMEOUT 50", head)
        self.assertIn("MENU TITLE Awai OS Meiji installer", head)

    def test_no_base_distribution_name_in_menu_text(self):
        for name in ("grubsrcd.cfg", "sysresccd_head.cfg", "sysresccd_sys.cfg"):
            text = (INSTALLER / "boot" / name).read_text()
            visible = re.sub(r"archisolabel=RESCUE1303|archiso\w*|sysresccd[\w/.-]*", "", text)
            for word in ("SystemRescue", "SYSTEM-RESCUE", "system-rescue", "Linux", "Arch"):
                self.assertNotIn(word, visible, (name, word))
            self.assertTrue(text.isascii(), "GRUB/syslinux fonts cannot be assumed to draw Japanese")

    def test_text_entry_option_is_what_the_launcher_reads(self):
        self.assertIn("awai.installer=text", (INSTALLER / "start.sh").read_text())
        self.assertIn("awai.installer=text", (INSTALLER / "boot" / "grubsrcd.cfg").read_text())


class Overlay(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="awai-build-"))
        self.addCleanup(__import__("shutil").rmtree, self.tmp, True)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        (bin_dir / "zstd").write_text(f'#!/bin/sh\nexec "{sys.executable}" -c "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read() if False else open(sys.argv[-1],\'rb\').read())" "$@"\n')
        (bin_dir / "zstd").chmod(0o755)
        (bin_dir / "xorriso").write_text(f'#!/bin/sh\necho "$@" > "{self.tmp}/xorriso.args"\n')
        (bin_dir / "xorriso").chmod(0o755)
        self._path = os.environ["PATH"]
        os.environ["PATH"] = f"{bin_dir}{os.pathsep}{self._path}"
        self.addCleanup(os.environ.__setitem__, "PATH", self._path)
        self.iso, self.zst = self.tmp / "stock.iso", self.tmp / "image.zst"
        self.iso.write_bytes(b"stock iso")
        self.zst.write_bytes(b"raw image bytes")  # the fake zstd copies, so raw == archive
        self.sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()

    def args(self, **over):
        a = {"--stock-iso": self.iso, "--stock-iso-sha256": self.sha(self.iso), "--image-zst": self.zst,
             "--archive-sha256": self.sha(self.zst), "--image-sha256": self.sha(self.zst), "--out": self.tmp / "out.iso"}
        a.update(over)
        out = []
        for k, v in a.items():
            out.append(k)
            if v is not None:
                out.append(str(v))
        return out

    def build(self, *extra, **over):
        mod = __import__("importlib").import_module("build-overlay".replace("-", "_")) if False else None
        spec = __import__("importlib.util").util.spec_from_file_location("build_overlay", INSTALLER / "build-overlay.py")
        module = __import__("importlib.util").util.module_from_spec(spec)
        spec.loader.exec_module(module)
        out = io.StringIO()
        with redirect_stdout(out):
            try:
                rc = module.main(self.args(**over) + list(extra))
            except SystemExit as e:
                return str(e.code), out.getvalue()
        return rc, out.getvalue()

    def test_wrong_stock_iso_digest_refused(self):
        rc, _ = self.build(**{"--stock-iso-sha256": "0" * 64})
        self.assertIn("stock ISO digest", str(rc))

    def test_wrong_archive_digest_refused(self):
        rc, _ = self.build(**{"--archive-sha256": "0" * 64})
        self.assertIn("archive digest", str(rc))

    def test_wrong_raw_digest_refused(self):
        rc, _ = self.build(**{"--image-sha256": "0" * 64})
        self.assertIn("decompressed image digest", str(rc))

    def test_existing_output_refused(self):
        (self.tmp / "out.iso").write_text("x")
        rc, _ = self.build()
        self.assertIn("already exists", str(rc))

    def test_malformed_digest_refused(self):
        rc, _ = self.build(**{"--image-sha256": "ABC"})
        self.assertIn("lowercase SHA-256", str(rc))

    def test_missing_glyphs_refuse_the_build_with_no_override(self):
        a = self.args()
        self.assertNotIn("--allow-missing-glyphs", (INSTALLER / "build-overlay.py").read_text())
        spec = __import__("importlib.util").util.spec_from_file_location("build_overlay2", INSTALLER / "build-overlay.py")
        module = __import__("importlib.util").util.module_from_spec(spec)
        spec.loader.exec_module(module)
        real = module.glyphs.font_coverage
        with mock.patch.object(module.glyphs, "font_coverage", lambda *x: real(*x) - {ord("蔵")}), \
                self.assertRaises(SystemExit) as cm, redirect_stdout(io.StringIO()):
            module.main(a + ["--dry-run"])
        self.assertIn("no glyph", str(cm.exception.code))
        self.assertIn("蔵", str(cm.exception.code))

    def test_dry_run_builds_the_overlay_but_calls_nothing(self):
        keep = self.tmp / "overlay"
        rc, out = self.build("--dry-run", "--keep-overlay", str(keep))
        self.assertEqual(rc, 0)
        self.assertFalse((self.tmp / "out.iso").exists())
        self.assertFalse((self.tmp / "xorriso.args").exists())
        self.assertIn("-boot_image any replay", out)
        awai = keep / "awai"
        self.assertEqual((awai / "awai-pc-install.py").read_bytes(), (PC_AB / "awai-pc-install.py").read_bytes())
        self.assertEqual((awai / "install-image.sha256").read_text(), f"{self.sha(self.zst)}  awai-pc-install.img\n")
        self.assertEqual((awai / "archive.sha256").read_text(), f"{self.sha(self.zst)}  awai-pc-install.img.zst\n")
        for f in ("core.py", "server.py", "text_installer.py", "start.sh", "xsession.sh", "firefox-policies.json", "web/logo.png", "web/index.html", "web/app.js", "web/noto-jp.woff2", "web/font-OFL.txt"):
            self.assertTrue((awai / "installer" / f).is_file(), f)
        for f in ("boot/grub/grubsrcd.cfg", "boot/syslinux/sysresccd_head.cfg", "boot/syslinux/sysresccd_sys.cfg"):
            self.assertEqual((keep / f).read_bytes(), (INSTALLER / "boot" / Path(f).name).read_bytes(), f)
        self.assertIn("/run/archiso/bootmnt/awai/install", (keep / "sysrescue.d" / "700-awai-installer.yaml").read_text())
        self.assertEqual(os.stat(awai / "install").st_mode & 0o111, 0o111)
        # the overlay's core.py finds the canonical installer exactly where it ships
        self.assertTrue((awai / "installer" / ".." / "awai-pc-install.py").exists())

    def test_real_run_calls_xorriso_like_the_previous_build(self):
        rc, _ = self.build()
        self.assertEqual(rc, 0)
        args = (self.tmp / "xorriso.args").read_text()
        for part in ("-overwrite on", "/boot/grub/grubsrcd.cfg", "/boot/syslinux/sysresccd_sys.cfg", "/boot/syslinux/sysresccd_head.cfg", "-indev", "-outdev", "-boot_image any replay", "/awai", "/sysrescue.d/700-awai-installer.yaml", "/awai/awai-pc-install.img.zst", "-commit"):
            self.assertIn(part, args)

    def test_does_not_download(self):
        src = (INSTALLER / "build-overlay.py").read_text()
        for word in ("urllib", "requests", "curl", "wget", "http.client", "socket"):
            self.assertNotIn(word, src)


if __name__ == "__main__":
    unittest.main()
