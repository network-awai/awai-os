"""Pure key policy (always run) and the real GTK widget tree offscreen (skipped where PyGObject/Gtk 3 is missing)."""
import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import keys  # noqa: E402
import gtkdrive  # noqa: E402


class KeyPolicy(unittest.TestCase):
    def test_modified_keys_function_keys_and_menu_keys_are_swallowed(self):
        for name in ("t", "n", "l", "w", "o", "F4", "F1", "F5", "F10", "F11", "F12", "Menu", "Print", "Delete", "BackSpace", "Tab", "Left"):
            self.assertTrue(keys.swallow(name, keys.CTRL), f"Ctrl+{name}")
            self.assertTrue(keys.swallow(name, keys.ALT), f"Alt+{name}")
            self.assertTrue(keys.swallow(name, keys.CTRL | keys.ALT), f"Ctrl+Alt+{name}")
            self.assertTrue(keys.swallow(name, keys.META), f"Super+{name}")
        for n in range(1, 25):
            self.assertTrue(keys.swallow(f"F{n}", 0), f"F{n}")
        for name in ("Menu", "Print", "Sys_Req", "XF86PowerOff", "XF86Sleep", "Super_L", "Alt_L"):
            self.assertTrue(keys.swallow(name, 0), name)

    def test_keys_the_installer_needs_get_through(self):
        for name in ("Tab", "ISO_Left_Tab", "Return", "KP_Enter", "space", "Left", "Right", "Up", "Down", "BackSpace", "a", "n", "0", "1", "Escape"):
            self.assertFalse(keys.swallow(name, 0), name)
        self.assertFalse(keys.swallow("ISO_Left_Tab", 1))  # Shift+Tab
        self.assertFalse(keys.swallow("A", 1))


@unittest.skipUnless(gtkdrive.have_gtk(), "PyGObject / Gtk 3 not available")
class Widgets(unittest.TestCase):
    def setUp(self):
        self.d = gtkdrive.Drive()
        self.addCleanup(self.d.close)

    def test_first_screen_copy_and_a_disabled_primary(self):
        text = self.d.text()
        for s in ("インストール先を選ぶ", "内蔵 SSD", "KIOXIA TransMemory", "62.0 GiB · この PC を起動した USB", "選択可能", "選択不可", "電源を切る", "Awai OS Meiji"):
            self.assertIn(s, text)
        self.assertFalse(self.d.button("内容を確認").get_sensitive())
        self.assertNotIn("完了画面を見る", text)

    def test_keyboard_order_select_then_primary_first_then_power(self):
        d = self.d
        d.key("Tab")
        self.assertIn("内蔵 SSD", d.focus_text())
        d.key("Enter")
        self.assertIn("選択済み", d.text())
        self.assertIn("内蔵 SSD", d.focus_text(), "focus stays on the card after selecting")
        d.key("Tab")
        self.assertEqual(d.focus_text(), "内容を確認")
        d.key("Tab")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Shift+Tab")
        d.key("Enter")
        self.assertIn("インストール内容を確認", d.text())
        self.assertEqual(d.focus_text(), "typed")

    def test_wrong_name_keeps_the_button_disabled_and_the_right_name_enables_it(self):
        d = self.d
        for k in ("Tab", "Enter", "Tab", "Enter"):
            d.key(k)
        d.type("nvme0")
        self.assertFalse(d.button("この SSD にインストール").get_sensitive())
        d.type("n2")
        self.assertFalse(d.button("この SSD にインストール").get_sensitive())
        d.focus().set_text("")
        d.type("nvme0n1")
        self.assertTrue(d.button("この SSD にインストール").get_sensitive())
        d.key("Tab")
        self.assertEqual(d.focus_text(), "この SSD にインストール")
        d.key("Tab")
        self.assertEqual(d.focus_text(), "戻る")

    def test_first_tab_lands_on_the_first_selectable_card_even_after_focus_was_lost(self):
        import gi
        gi.require_version("Gdk", "3.0")
        from gi.repository import Gdk
        d = self.d
        ev = Gdk.Event.new(Gdk.EventType.FOCUS_CHANGE)  # key mashing / a lost X focus: GTK is told the toplevel lost focus
        ev.window = d.win.get_window()
        ev.focus_change.window = d.win.get_window()
        ev.focus_change._in = 0
        d.win.emit("focus-out-event", ev)
        self.assertFalse(d.win.has_toplevel_focus())
        d.win.set_focus(None)
        import gui
        gui.ensure_toplevel_focus(d.win)  # what the window's key handler does before the key reaches the widgets
        self.assertTrue(d.win.has_toplevel_focus())
        d.key("Tab")
        self.assertIn("内蔵 SSD", d.focus_text())
        self.assertIn("選択可能", d.focus_text(), "one Tab reaches the first selectable card, not the unselectable USB")

    def test_card_tags_are_centred_and_the_product_title_uses_the_design_pitch(self):
        d = self.d
        tags = [l for l in d.labels() if l.get_text() in ("選択可能", "選択不可")]
        self.assertTrue(tags)
        for tag in tags:
            card = tag.get_ancestor(d.Gtk.Button) or tag.get_parent().get_parent()
            _x, off_y = tag.get_layout_offsets()  # where the text really is, not the label's allocation
            mid_tag = off_y + tag.get_layout().get_pixel_size()[1] / 2  # window coordinates
            mid_card = card.translate_coordinates(d.win, 0, card.get_allocated_height() / 2)[1]
            self.assertAlmostEqual(mid_tag, mid_card, delta=3, msg=tag.get_text())
        prod = [l for l in d.labels() if l.get_text().startswith("PC に")][0]
        lines = prod.get_layout().get_pixel_size()[1]
        size = prod.get_pango_context().get_font_description().get_size() / 1024 * 96 / 72
        self.assertLessEqual(lines / (2 * size), 1.25, "two lines of the product title must not be wider than the design's pitch")

    def test_power_off_asks_once(self):
        d = self.d
        d.key("Tab")
        d.key("Tab")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Enter")
        self.assertIn("もう一度押すと電源を切ります", d.button_text(d.focus()))
        self.assertNotIn("power_calls", d.w.world_file.read_text())
        d.key("Enter")
        self.assertIn('"poweroff"', d.w.world_file.read_text())

    def test_power_question_survives_the_poll_redraw(self):
        d = self.d
        d.key("Tab")
        d.key("Tab")
        d.key("Enter")
        self.assertIn("もう一度押すと", d.button_text(d.focus()))
        asking = d.button("もう一度押すと電源を切ります")
        for _ in range(3):  # the 700 ms poll runs while the question is on screen
            d.poll()
        self.assertIs(d.button("もう一度押すと電源を切ります"), asking, "asking must not rebuild the screen")
        self.assertIn("もう一度押すと", d.button_text(d.button("もう一度押すと電源を切ります")), "armed state must survive a poll")
        self.assertEqual(d.focus_text(), "もう一度押すと電源を切ります")
        self.assertNotIn("power_calls", d.w.world_file.read_text())
        d.key("Enter")
        self.assertIn('"poweroff"', d.w.world_file.read_text())

    def test_a_blur_caused_by_a_rebuild_does_not_disarm_the_question(self):
        d = self.d
        d.key("Tab")
        d.key("Tab")
        d.key("Enter")
        btn = d.button("もう一度押すと電源を切ります")
        d.ui.rebuilding = True  # GTK reports focus-out for widgets being destroyed during a redraw
        d.ui.on_power_blur(btn)
        d.ui.rebuilding = False
        self.assertTrue(d.c.armed)
        d.ui.on_power_blur(btn)  # the user really leaving the button
        self.assertFalse(d.c.armed)

    def test_full_install_reaches_done_and_the_done_screen_only_then(self):
        d = self.d
        d.w.update(sgdisk_new_delay=1.0)
        for k in ("Tab", "Enter", "Tab", "Enter"):
            d.key(k)
        d.type("nvme0n1")
        d.key("Tab")
        d.key("Enter")
        self.assertIn("インストールしています", d.text())
        self.assertNotIn("インストールが完了しました", d.text())
        self.assertFalse(d.button("電源を切る").get_sensitive(), "power off is disabled while writing")
        end = time.time() + 60
        while time.time() < end and "インストールが完了しました" not in d.text():
            time.sleep(0.2)
            d.poll()
        self.assertIn("インストールが完了しました", d.text())
        self.assertIn("11 区画を確認", d.text())

    def test_failure_screen_never_says_done(self):
        d = self.d
        d.w.update(sgdisk_v_problem=True)
        for k in ("Tab", "Enter", "Tab", "Enter"):
            d.key(k)
        d.type("nvme0n1")
        d.key("Tab")
        d.key("Enter")
        end = time.time() + 60
        while time.time() < end and "インストールできませんでした" not in d.text():
            time.sleep(0.2)
            d.poll()
        text = d.text()
        self.assertIn("失敗した手順: 3", text)
        for forbidden in ("インストールが完了しました", "確認済み", "再起動"):
            self.assertNotIn(forbidden, text)
        self.assertIn("電源を切る", text)

    def test_no_selectable_disk_screen(self):
        d = self.d
        d.w.edit_disk("nvme0n1", children=[{}])
        d.c.refresh()
        d.ui.render(force=True)
        d.spin()
        text = d.text()
        self.assertIn("インストール先が見つかりません", text)
        self.assertEqual(text.count("選択不可"), 2)
        self.assertIn("ここからディスクの消去は実行できません", text)
        self.assertEqual([b for b in d.buttons() if "card" in b.get_style_context().list_classes()], [])

    def test_every_label_is_drawn_by_the_bundled_font(self):
        d = self.d
        for setup in (lambda: None,):
            setup()
        used = d.fonts_used()
        self.assertTrue(used)
        for (family, exact), n in used.items():
            self.assertEqual(family, "Noto Sans JP")
            self.assertTrue(exact, f"{n} glyphs not covered exactly by the bundled face")

    def test_layout_proportions_follow_the_design(self):
        for size in ((1280, 720), (1920, 1080)):
            d = gtkdrive.Drive(*size)
            try:
                rail = d.ui.rail.get_allocated_width()
                self.assertAlmostEqual(rail / size[0], 0.305, delta=0.01)
                card = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()][0]
                self.assertAlmostEqual(card.get_allocated_width() / size[0], 0.577, delta=0.012)
                u = min(size[0] / 740, size[1] / 440)
                title = d.ui.title.get_pango_context().get_font_description().get_size() / 1024 * 96 / 72
                self.assertAlmostEqual(title, 26 * u, delta=1.5)
            finally:
                d.close()


if __name__ == "__main__":
    unittest.main()
