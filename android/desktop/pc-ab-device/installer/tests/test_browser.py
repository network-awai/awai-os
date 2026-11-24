"""Real browser (headless Chrome) against the real backend with fake tools. Skipped where Chrome is absent."""
import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cdp  # noqa: E402
from fakes import core  # noqa: E402
from scenario import Live  # noqa: E402
from shots import hold_running  # noqa: E402


@unittest.skipUnless(cdp.have_chrome(), "Chrome not installed")
class BrowserFlow(unittest.TestCase):
    def open(self, live, size=(1280, 720)):
        self.addCleanup(live.close)
        b = cdp.Browser(*size)
        self.addCleanup(b.close)
        b.goto(live.url)
        return b

    def disabled(self, b, label):
        return b.eval("Array.from(document.querySelectorAll('button')).find(x => x.textContent === %r).disabled" % label)

    def test_keyboard_only_install_and_typed_name_gate(self):
        live = Live()
        live.w.update(sgdisk_new_delay=0.5)
        b = self.open(live)
        b.wait_text("選択可能")
        self.assertTrue(self.disabled(b, "内容を確認"))
        for k in ("Tab", "Enter"):
            b.key(k)
        self.assertIn("選択済み", b.text())
        b.key("Tab"); b.key("Tab"); b.key("Enter")
        b.wait_text("インストール内容を確認")
        self.assertTrue(self.disabled(b, "この SSD にインストール"))
        b.type("nvme0")
        self.assertTrue(self.disabled(b, "この SSD にインストール"))
        b.type("n2")
        self.assertTrue(self.disabled(b, "この SSD にインストール"))
        b.eval("document.getElementById('typed').value=''")
        b.type("nvme0n1")
        self.assertFalse(self.disabled(b, "この SSD にインストール"))
        b.key("Tab"); b.key("Tab"); b.key("Enter")
        b.wait_text("インストールしています")
        self.assertTrue(self.disabled(b, "電源を切る"), "power off must be disabled while writing")
        self.assertNotIn("インストールが完了しました", b.text())
        # a reload during the write shows the true state, not the start screen
        b.goto(live.url)
        b.wait_text("インストールしています")
        b.wait_text("インストールが完了しました")
        self.assertFalse(self.disabled(b, "再起動"))

    def test_hold_running_fixture_shows_progress_and_blocks_power(self):
        live = Live()
        fd = hold_running(live, 2, 0.42)
        self.addCleanup(os.close, fd)
        b = self.open(live)
        b.wait_text("進行中")
        self.assertIn("42%", b.text())
        self.assertTrue(self.disabled(b, "電源を切る"))
        self.assertNotIn("インストールが完了しました", b.text())
        self.assertNotIn("完了画面を見る", b.text())

    def test_failure_never_shows_the_completion_screen(self):
        for setup in (lambda lv: (lv.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n"),
                      lambda lv: lv.w.update(sgdisk_v_problem=True), lambda lv: lv.w.update(sync_rc=1)):
            live = Live()
            setup(live)
            b = self.open(live)
            b.wait_text("選択可能")
            for k in ("Tab", "Enter", "Tab", "Tab", "Enter"):
                b.key(k)
            b.wait_text("インストール内容を確認")
            b.type("nvme0n1")
            for k in ("Tab", "Tab", "Enter"):
                b.key(k)
            b.wait_text("インストールできませんでした")
            text = b.text()
            for forbidden in ("インストールが完了しました", "確認済み", "再起動", "読み戻しが完了しました"):
                self.assertNotIn(forbidden, text)
            self.assertIn("電源を切る", text)
            self.assertIn("失敗した手順", text)
            self.assertIn("SSD への書き込み", text)
            b.goto(live.url)  # reload keeps showing the failure
            b.wait_text("インストールできませんでした")

    def test_no_selectable_screen_lists_reasons_and_no_erase(self):
        live = Live()
        live.w.edit_disk("nvme0n1", children=[{}])
        b = self.open(live)
        b.wait_text("インストール先が見つかりません")
        text = b.text()
        self.assertIn("既存の区画あり", text)
        self.assertIn("この PC を起動した USB", text)
        self.assertIn("ここからディスクの消去は実行できません", text)
        self.assertEqual(text.count("選択不可"), 2)
        self.assertTrue(b.eval("document.querySelectorAll('button.card').length === 0"))


if __name__ == "__main__":
    unittest.main()
