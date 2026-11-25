"""Nothing is ever cut off: for every monitor size the whole screen fits inside the safe area (3% on every side) and stays
operable, with 1 to 8 SSDs, the longest texts, and every screen including the failures and the confirmation.
Offscreen GTK widget tree; skipped where PyGObject / Gtk 3 is missing."""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import gtkdrive  # noqa: E402
import layoutcheck as lc  # noqa: E402


@unittest.skipUnless(gtkdrive.have_gtk(), "PyGObject / Gtk 3 not available")
class Fits(unittest.TestCase):
    def drive(self, size, disks=1):
        w = fakes.World()
        lc.add_disks(w, disks)
        d = gtkdrive.Drive(*size, world=w)
        self.addCleanup(d.close)
        return d

    def ok(self, d, what):
        bad = lc.problems(d, what)
        self.assertEqual(bad, [], f"{d.ui.W}x{d.ui.H} {what}: " + "\n".join(bad[:6]))

    def test_the_disk_list_screen_with_one_to_eight_ssds_at_every_size(self):
        for size in lc.SIZES:
            for n in (1, 2, 3, 8):
                d = self.drive(size, n)
                self.ok(d, f"pick n={n}")
                bad = lc.press_all(d, n + 6)
                self.assertEqual(bad, [], f"{size} n={n} tabbing: " + "\n".join(bad[:6]))
                d.close()

    def test_the_action_row_is_always_visible_and_a_card_is_selectable_when_the_list_scrolls(self):
        for size in lc.SIZES:
            d = self.drive(size, 8)
            ui = d.ui
            self.assertTrue(d.button("電源を切る").get_mapped())
            self.assertGreaterEqual(d.button("内容を確認").get_allocated_height(), 1)
            cards = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()]
            self.assertEqual(len(cards), 8)
            self.assertGreaterEqual(ui.fitted[0], 0.8 * ui.u_max, f"{size}: eight SSDs scroll inside the list instead of shrinking the screen")
            sc = lc.rect(d, ui.scroller)
            first = lc.rect(d, cards[0])
            self.assertTrue(first[3] <= sc[3] + 1 and first[1] >= sc[1] - 1, f"{size}: the first card is not fully visible")
            self.assertLessEqual(lc.rect(d, d.button("内容を確認"))[3], ui.H - ui.sy + 1, size)
            d.close()

    def test_tabbing_to_the_last_card_scrolls_it_into_view(self):
        for size in ((1024, 600), (1280, 720), (800, 600), (1080, 1920)):
            d = self.drive(size, 8)
            for i in range(7):
                d.key("Down")
                self.assertTrue(d.focus_text().startswith("内蔵 SSD"), d.focus_text())
            self.assertIn("#7", d.focus_text(), f"{size}: the eighth card holds the focus")
            self.ok(d, "last card focused")
            d.close()

    def test_review_confirmation_progress_done_failed_and_none_at_every_size(self):
        for size in lc.SIZES:
            d = self.drive(size, 2)
            d.key("Enter")  # choose the first SSD
            d.key("Enter")  # on to the review
            self.assertIn("この内容で入れます", d.text())
            self.ok(d, "review")
            self.assertEqual(lc.press_all(d, 4), [], f"{size} review tabbing")
            d.ui.reset_focus()
            self.assertEqual(d.focus_text(), "この SSD にインストール")
            d.key("Enter")
            self.assertTrue(d.c.confirming)
            self.assertEqual(d.focus_text(), "やめる")
            self.ok(d, "confirmation")
            dialog = lc.rect(d, d.ui.dialog)
            safe = (d.ui.sx, d.ui.sy, d.ui.W - d.ui.sx, d.ui.H - d.ui.sy)
            self.assertTrue(safe[0] <= dialog[0] and dialog[2] <= safe[2] and safe[1] <= dialog[1] and dialog[3] <= safe[3], f"{size} dialog {dialog} safe {safe}")
            for stop in ("インストールする", "やめる", "インストールする"):
                d.key("Tab")
                self.assertEqual(d.focus_text(), stop)
                self.ok(d, "confirmation tab")
            d.key("Escape")
            self.assertFalse(d.c.confirming)
            d.close()

    def test_running_done_failed_and_no_target_screens_at_every_size(self):
        import json
        for size in lc.SIZES:
            d = self.drive(size, 2)
            fd = lc.hold_running(d, 2, 0.42)
            d.poll()
            self.ok(d, "progress")
            d.ui.on_power  # the power question is longer than the label: fitted with its armed text
            os.close(fd)
            for written, name in (("started", "failed after writing"), ("none", "failed before writing")):
                (d.w.work / "write-started").unlink(missing_ok=True)
                code = lc.longest_message()
                (d.w.work / "state.json").write_text(json.dumps({"schema": 1, "state": "failed", "device": "nvme0n1", "step": 3, "fraction": 0.5,
                                                                 "written": written, "error": {"code": code, "step": 3, "detail": "x" * 80}}))
                if written == "started":
                    (d.w.work / "write-started").write_text("")
                d.poll()
                self.assertIn("インストールできませんでした", d.text())
                self.ok(d, name)
                d.ui.grace = 0.0
                while d.focus_text() != "電源を切る" and d.ui.nav_v:
                    d.key("Down")
                    if d.focus_text() is None:
                        break
                d.key("Enter")
                self.ok(d, name + " power question")
            (d.w.work / "write-started").unlink(missing_ok=True)
            (d.w.work / "state.json").write_text(json.dumps({"schema": 1, "state": "done", "device": "nvme0n1", "step": 3, "fraction": 1.0,
                                                             "written": "started", "partitions": 11, "record": "/x"}))
            d.poll()
            self.assertIn("インストールが完了しました", d.text())
            self.ok(d, "done")
            (d.w.work / "state.json").unlink()
            for n in d.w.world["disks"]:
                d.w.edit_disk(n, children=[{}])
            d.c.refresh()
            d.ui.render(force=True)
            d.spin()
            self.assertIn("入れられる SSD がありません", d.text())
            self.ok(d, "none")
            d.close()

    def test_the_power_question_fits_on_every_screen_that_has_it(self):
        for size in ((800, 600), (1024, 600), (1080, 1920)):
            d = self.drive(size, 3)
            while d.focus_text() != "電源を切る":
                d.key("Down")
            d.key("Enter")
            self.assertIn("もう一度", d.focus_text())
            self.ok(d, "power question")
            d.close()

    def test_unit_comes_from_the_monitor_and_shrinks_only_when_needed(self):
        d = self.drive((1280, 720), 1)
        self.assertAlmostEqual(d.ui.fitted[0], 1.0, places=3, msg="a screen that fits keeps the design unit (1 Figma px = 1 px at 1280x720)")
        self.assertEqual((d.ui.sx, d.ui.sy), (round(0.03 * 1280), round(0.03 * 720)))
        d.close()
        d = self.drive((800, 600), 1)
        for k in ("Enter",):
            d.key(k)
        self.assertLessEqual(d.ui.fitted[1], 600)
        d.close()

    def test_backgrounds_reach_the_edges_while_content_keeps_off_them(self):
        d = self.drive((1920, 1080), 1)
        rail = lc.rect(d, d.ui.rail)
        self.assertEqual((rail[0], rail[1], rail[3]), (0, 0, 1080), "the rail panel is full height")
        logo = lc.rect(d, d.ui.logo)
        self.assertGreaterEqual(logo[0], d.ui.sx)
        self.assertGreaterEqual(logo[1], d.ui.sy)
        d.close()

    def test_geometry_change_refits_everything(self):
        d = self.drive((1280, 720), 3)
        d.ui.set_geometry(1024, 600)
        d.win.set_default_size(1024, 600)
        d.spin()
        self.assertEqual((d.ui.W, d.ui.H), (1024, 600))
        self.ok(d, "after a monitor change")
        d.close()


class Geo:
    def __init__(self, x, y, w, h):
        self.x, self.y, self.width, self.height = x, y, w, h


class FakeMonitor:
    def __init__(self, x, y, w, h, scale=1, model="M"):
        self.g, self.scale, self.model = Geo(x, y, w, h), scale, model

    def get_geometry(self):
        return self.g

    def get_scale_factor(self):
        return self.scale

    def get_model(self):
        return self.model


class FakeDisplay:
    def __init__(self, monitors, primary=None):
        self.monitors, self.primary = monitors, primary

    def get_n_monitors(self):
        return len(self.monitors)

    def get_monitor(self, i):
        return self.monitors[i]

    def get_primary_monitor(self):
        return None if self.primary is None else self.monitors[self.primary]


@unittest.skipUnless(gtkdrive.have_gtk(), "PyGObject / Gtk 3 not available")
class WhichMonitor(unittest.TestCase):
    """The window sits on one monitor's geometry, never on the virtual screen that spans all of them."""

    def test_the_primary_monitor_is_used_not_the_virtual_screen(self):
        import gui
        laptop, tv = FakeMonitor(0, 0, 1366, 768, model="laptop"), FakeMonitor(1366, 0, 3840, 2160, scale=2, model="tv")
        self.assertEqual(gui.monitor_geometry(FakeDisplay([laptop, tv], primary=0)), (0, 0, 1366, 768))
        self.assertEqual(gui.monitor_geometry(FakeDisplay([laptop, tv], primary=1)), (1366, 0, 3840, 2160))

    def test_without_a_primary_the_first_monitor_is_used_and_every_monitor_is_logged(self):
        import gui
        lines = []
        a, b = FakeMonitor(0, 0, 1920, 1080), FakeMonitor(0, 0, 1280, 720)  # mirrored outputs share the origin
        self.assertEqual(gui.monitor_geometry(FakeDisplay([a, b]), lines.append), (0, 0, 1920, 1080))
        self.assertEqual(len(lines), 2)
        self.assertIn("USED", lines[0])
        self.assertNotIn("USED", lines[1])
        self.assertIn("scale=1", lines[0])


if __name__ == "__main__":
    unittest.main()
