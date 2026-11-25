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


def two_ssds(world):
    import layoutcheck
    layoutcheck.add_disks(world, 2, long=False)
    return world


@unittest.skipUnless(gtkdrive.have_gtk(), "PyGObject / Gtk 3 not available")
class Widgets(unittest.TestCase):
    def setUp(self):
        self.d = gtkdrive.Drive()
        self.addCleanup(self.d.close)

    def multi(self):
        """Two empty SSDs (nothing preselected) and the USB."""
        self.d.close()
        self.d = gtkdrive.Drive(world=two_ssds(fakes.World()))
        return self.d

    def wait(self, text, timeout=60):
        end = time.time() + timeout
        while time.time() < end and text not in self.d.text():
            time.sleep(0.2)
            self.d.poll()
        self.assertIn(text, self.d.text())

    def installed(self):
        return (self.d.w.dev / "nvme0n1.gpt.json").exists() or (self.d.w.work / "write-started").exists() or self.d.c.proc is not None

    # -- what is on screen ---------------------------------------------------------------------------------------------------
    def test_first_screen_copy_and_the_single_ssd_is_already_selected(self):
        text = self.d.text()
        for s in ("どの SSD に入れますか？", "内蔵 SSD", "KIOXIA TransMemory", "62.0 GiB ・ この PC を起動した USB", "✓ 選択中", "使えません", "電源を切る", "Awai OS Meiji"):
            self.assertIn(s, text)
        self.assertTrue(self.d.button("内容を確認").get_sensitive())
        self.assertNotIn("完了画面を見る", text)
        self.assertNotIn("Tab で項目を移動", text, "the old rail hint is gone")

    def test_review_has_no_text_field_and_no_device_name_question(self):
        d = self.d
        d.key("Enter")
        text = d.text()
        self.assertIn("この内容で入れます", text)
        self.assertNotIn("デバイス名", text.replace("デバイスの詳細", ""))
        self.assertNotIn("入力", text)
        self.assertEqual([w for w in d.all_widgets() if isinstance(w, d.Gtk.Entry)], [])
        self.assertIn("/dev/nvme0n1", text)
        self.assertNotIn("詳細", text)
        card = [l for l in d.labels() if l.get_text().startswith("20.0 GiB")][0]
        self.assertNotIn("/dev/nvme0n1", card.get_text(), "the path is small text, not the card's main information")
        self.assertEqual(card.get_text(), "20.0 GiB ・ 空です")
        self.assertIn("戻る", text)
        self.assertEqual(d.focus_text(), "この SSD にインストール")

    def test_confirmation_is_in_the_same_window_with_size_model_and_the_power_warning(self):
        d = self.d
        d.key("Enter")
        d.key("Enter")
        text = d.text()
        for s in ("この SSD に Awai OS を入れます。", "よろしいですか？", "内蔵 SSD　20.0 GiB（空です）", "途中で電源を切らないでください。", "やめる", "インストールする"):
            self.assertIn(s, text)
        self.assertIs(d.ui.veil.get_toplevel(), d.win, "a veil in the one window, never a second window")
        self.assertFalse(d.ui.base.get_sensitive(), "everything behind the confirmation is inert")
        self.assertEqual(d.focus_text(), "やめる")
        self.assertFalse(self.installed())

    def test_two_empty_ssds_are_told_apart_on_the_cards_and_in_the_confirmation(self):
        d = self.multi()
        text = d.text()
        self.assertEqual(text.count("末尾"), 2)
        d.key("Enter")  # the first card
        d.key("Enter")
        d.key("Enter")
        self.assertTrue(d.c.confirming)
        self.assertIn("末尾", d.ui.dialog_text() if hasattr(d.ui, "dialog_text") else "\n".join(l.get_text() for l in d.labels(d.ui.dialog)))

    # -- keyboard: the way people expect -------------------------------------------------------------------------------------
    def test_boot_focus_is_visible_and_sensible(self):
        self.assertEqual(self.d.focus_text(), "内容を確認", "one SSD: it is selected and the next step has the focus")
        d = self.multi()
        self.assertIn("内蔵 SSD", d.focus_text(), "several SSDs: the first card has the focus")
        self.assertNotIn("✓ 選択中", d.text())
        self.assertFalse(d.button("内容を確認").get_sensitive())

    def test_enter_enter_enter_from_boot_never_installs_or_powers_off(self):
        for build in (lambda: self.d, self.multi):
            d = build()
            for i in range(30):
                d.key("Enter")
                self.assertFalse(self.installed(), f"press {i}")
                self.assertNotIn("poweroff", d.w.world_file.read_text())
                self.assertIn(d.focus_text(), ("内容を確認", "この SSD にインストール", "やめる"))
                if d.c.confirming:
                    self.assertEqual(d.focus_text(), "やめる")
            self.assertIn(d.c.screen, ("review", "pick"))

    def test_the_single_ssd_needs_enter_then_a_move_off_cancel_to_install(self):
        d = self.d
        d.key("Enter")
        self.assertEqual(d.focus_text(), "この SSD にインストール")
        d.key("Enter")
        self.assertEqual(d.focus_text(), "やめる")
        d.key("Right")
        self.assertEqual(d.focus_text(), "インストールする")
        self.assertFalse(self.installed())
        d.key("Enter")
        self.assertIn("インストールしています", d.text())

    def test_up_down_walk_the_cards_then_the_buttons_and_wrap(self):
        d = self.multi()
        first = d.focus_text()
        d.key("Down")
        second = d.focus_text()
        self.assertNotEqual(first, second)
        self.assertIn("内蔵 SSD", second)
        d.key("Down")
        self.assertEqual(d.focus_text(), "電源を切る", "the disabled 内容を確認 is skipped, the unselectable USB too")
        d.key("Down")
        self.assertEqual(d.focus_text(), first, "wraps through to the first card")
        d.key("Up")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Up")
        self.assertEqual(d.focus_text(), second)
        self.assertNotIn("KIOXIA", d.focus_text())

    def test_arrows_reach_the_review_button_after_a_selection_and_left_right_move_between_buttons(self):
        d = self.multi()
        d.key("Enter")  # select the first card: focus moves on
        self.assertEqual(d.focus_text(), "内容を確認")
        d.key("Left")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Left")
        self.assertEqual(d.focus_text(), "電源を切る", "no wrap on the row")
        d.key("Right")
        self.assertEqual(d.focus_text(), "内容を確認")
        d.key("Up")
        self.assertIn("内蔵 SSD", d.focus_text())
        d.key("Left")
        self.assertIn("内蔵 SSD", d.focus_text(), "← → do nothing on a card")
        d.key("Right")
        self.assertIn("内蔵 SSD", d.focus_text())

    def test_enter_and_space_select_the_card_and_move_on_and_enter_on_the_selected_card_goes_forward(self):
        d = self.multi()
        d.key("Space")
        self.assertIn("✓ 選択中", d.text())
        self.assertEqual(d.focus_text(), "内容を確認")
        d.key("Up")
        self.assertIn("内蔵 SSD", d.focus_text())
        d.key("Enter")  # already selected: forward, not un-select
        self.assertIn("この内容で入れます", d.text())
        self.assertEqual(d.focus_text(), "この SSD にインストール")

    def test_escape_is_back_and_cancel_and_never_power(self):
        d = self.multi()
        d.key("Escape")
        self.assertEqual(d.c.screen, "pick")
        self.assertNotIn("poweroff", d.w.world_file.read_text())
        d.key("Enter")
        d.key("Enter")
        self.assertEqual(d.c.screen, "review")
        d.key("Escape")
        self.assertEqual(d.c.screen, "pick")
        d.key("Enter")
        d.key("Enter")
        self.assertTrue(d.c.confirming)
        d.key("Right")
        self.assertEqual(d.focus_text(), "インストールする")
        d.key("Escape")
        self.assertFalse(d.c.confirming)
        self.assertEqual(d.c.screen, "review")
        self.assertEqual(d.focus_text(), "この SSD にインストール")
        self.assertFalse(self.installed())

    def test_confirmation_traps_the_keys_inside_it(self):
        d = self.d
        d.key("Enter")
        d.key("Enter")
        seen = []
        for k in ("Tab", "Tab", "Tab", "Shift+Tab", "Left", "Right", "Right", "Down", "Up"):
            d.key(k)
            seen.append(d.focus_text())
            self.assertIn(seen[-1], ("やめる", "インストールする"), k)
        d.key("Left")
        d.key("Enter")
        self.assertFalse(d.c.confirming)

    def test_tab_and_shift_tab_still_work_with_the_primary_first_in_the_row(self):
        d = self.d
        self.assertEqual(d.focus_text(), "内容を確認")
        d.key("Tab")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Tab")
        self.assertIn("内蔵 SSD", d.focus_text())
        d.key("Tab")
        self.assertEqual(d.focus_text(), "内容を確認", "cards, then the primary, then power")
        d.key("Shift+Tab")
        self.assertIn("内蔵 SSD", d.focus_text())
        d.key("Enter")  # the chosen SSD: on to the review
        self.assertEqual(d.focus_text(), "この SSD にインストール")
        d.key("Tab")
        self.assertEqual(d.focus_text(), "戻る", "primary first, then the left button")

    def test_the_hint_names_the_keys_and_the_action_of_the_focused_control(self):
        d = self.multi()
        self.assertEqual(d.ui.hint.get_text(), "Enter：選んで次へ　　↑↓：選ぶ　　マウスも使えます")
        d.key("Enter")
        self.assertEqual(d.ui.hint.get_text(), "Enter：内容を確認　　↑↓：選ぶ　　マウスも使えます")
        d.key("Left")
        self.assertEqual(d.ui.hint.get_text(), "Enter：電源を切る　　↑↓：選ぶ　　マウスも使えます")
        d.key("Enter")
        self.assertEqual(d.ui.hint.get_text(), "Enter：もう一度押すと電源を切ります　　↑↓：選ぶ　　マウスも使えます")
        d.key("Right")
        d.key("Enter")
        self.assertEqual(d.ui.hint.get_text(), "Enter：この SSD にインストール　　Esc：戻る")
        d.key("Enter")
        self.assertEqual(d.ui.hint.get_text(), "←→：選ぶ　　Enter：決定　　Esc：やめる")
        self.assertNotIn("Tab で項目を移動", d.text())

    def test_the_focus_is_a_thick_amber_ring_on_a_filled_control(self):
        import gui
        css = gui.css_for(1.0)
        self.assertIn("box-shadow: inset 0 0 0 5px #f0a000", css)
        d = self.d
        Gtk = d.Gtk
        ctx = d.button("内容を確認").get_style_context()
        bg = ctx.get_background_color(Gtk.StateFlags.FOCUSED)
        normal = ctx.get_background_color(Gtk.StateFlags.NORMAL)
        self.assertNotEqual((bg.red, bg.green, bg.blue), (normal.red, normal.green, normal.blue), "a focused primary button is filled darker")
        self.assertIn("button.btn:focus { background: #123a80; box-shadow: inset 0 0 0 5px #f0a000; }", css)
        for rule in ("button.card:hover", "button.btn:hover", "button.link:hover", "button.card:focus", "button.second:focus", "button.link:focus"):
            self.assertIn(rule, css)

    def test_wrapping_the_focus_never_stops_on_anything_invisible(self):
        d = self.d
        seen = []
        for _ in range(8):
            d.key("Tab")
            seen.append(d.focus_text())
        self.assertTrue(all(seen), seen)
        self.assertEqual(seen[:3], seen[3:6])

    # -- mouse / touch ----------------------------------------------------------------------------------------------------------
    def test_mouse_every_screen_by_clicking_only(self):
        d = self.multi()
        card = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()][0]
        card.clicked()  # the whole card is the target
        d.spin()
        self.assertIn("✓ 選択中", d.text())
        d.click("内容を確認")
        self.assertIn("この内容で入れます", d.text())
        d.click("戻る")
        self.assertEqual(d.c.screen, "pick")
        d.click("内容を確認")
        d.click("この SSD にインストール")
        self.assertTrue(d.c.confirming)
        d.click("やめる")
        self.assertFalse(d.c.confirming)
        self.assertFalse(self.installed())
        d.click("この SSD にインストール")
        d.w.update(sgdisk_new_delay=1.0)
        d.click("インストールする")
        self.assertIn("インストールしています", d.text())
        self.wait("インストールが完了しました")
        self.assertIn("11 区画を確認", d.text())

    def test_a_click_on_the_selected_card_goes_forward_and_a_click_on_another_card_moves_the_selection(self):
        d = self.multi()
        cards = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()]
        self.assertEqual(len(cards), 2)
        cards[0].clicked()
        d.spin()
        name0 = d.c.selected
        cards = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()]
        cards[1].clicked()
        d.spin()
        self.assertNotEqual(d.c.selected, name0)
        self.assertEqual(d.c.screen, "pick")
        cards = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()]
        cards[1].clicked()
        d.spin()
        self.assertEqual(d.c.screen, "review")

    def test_hover_and_pressed_states_are_styled(self):
        import gui
        css = gui.css_for(1.0)
        for rule in ("button.card:hover", "button.btn:hover", "button.btn:active", "button.link:hover", "button.second:hover"):
            self.assertIn(rule, css)

    # -- the rest of the flow --------------------------------------------------------------------------------------------------
    def test_cold_start_has_a_focused_control_and_no_second_window(self):
        d = self.d
        self.assertIsNotNone(d.focus())
        self.assertEqual(d.focus_text(), "内容を確認")
        self.assertFalse(hasattr(d.ui, "anchor"), "no invisible anchor any more")

    def test_power_off_asks_once_and_is_never_reached_by_plain_enter(self):
        d = self.d
        d.key("Down")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Enter")
        self.assertIn("もう一度押すと電源を切ります", d.button_text(d.focus()))
        self.assertNotIn("power_calls", d.w.world_file.read_text())
        d.key("Enter")
        self.assertIn('"poweroff"', d.w.world_file.read_text())

    def test_power_question_survives_the_poll_redraw(self):
        d = self.d
        d.key("Down")
        d.key("Enter")
        asking = d.button("もう一度押すと電源を切ります")
        for _ in range(3):  # the 700 ms poll runs while the question is on screen
            d.poll()
        self.assertIs(d.button("もう一度押すと電源を切ります"), asking, "asking must not rebuild the screen")
        self.assertEqual(d.focus_text(), "もう一度押すと電源を切ります")
        self.assertNotIn("power_calls", d.w.world_file.read_text())
        d.key("Enter")
        self.assertIn('"poweroff"', d.w.world_file.read_text())

    def test_a_blur_caused_by_a_rebuild_does_not_disarm_the_question(self):
        d = self.d
        d.key("Down")
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
        d.key("Enter")
        d.key("Enter")
        d.key("Right")
        d.key("Enter")
        self.assertIn("インストールしています", d.text())
        self.assertNotIn("インストールが完了しました", d.text())
        self.assertFalse(d.button("電源を切る").get_sensitive(), "power off is disabled while writing")
        self.wait("インストールが完了しました")
        self.assertIn("11 区画を確認", d.text())
        self.assertEqual(d.focus_text(), "再起動")

    def test_failure_screen_never_says_done(self):
        d = self.d
        d.w.update(sgdisk_v_problem=True)
        for k in ("Enter", "Enter", "Right", "Enter"):
            d.key(k)
        self.wait("インストールできませんでした")
        text = d.text()
        self.assertIn("失敗した手順：3", text)
        for forbidden in ("インストールが完了しました", "確認済み", "再起動"):
            self.assertNotIn(forbidden, text)
        self.assertIn("電源を切る", text)

    def test_failure_before_writing_focuses_the_way_back_and_escape_goes_back(self):
        d = self.d
        (d.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n")
        for k in ("Enter", "Enter", "Right", "Enter"):
            d.key(k)
        self.wait("インストールできませんでした")
        self.assertEqual(d.focus_text(), "最初に戻る")
        d.key("Escape")
        self.assertEqual(d.c.screen, "pick")
        self.assertEqual(d.focus_text(), "内容を確認")

    def test_a_done_or_failed_screen_that_appears_by_itself_ignores_a_key_held_down_for_a_moment(self):
        d = self.d
        d.ui.grace = 5.0
        d.w.update(sgdisk_v_problem=True)
        for k in ("Enter", "Enter", "Right", "Enter"):
            d.key(k)
        self.wait("インストールできませんでした")
        self.assertEqual(d.focus_text(), "電源を切る")
        d.key("Enter")
        d.key("Enter")
        d.key("Enter")
        self.assertNotIn("power_calls", d.w.world_file.read_text(), "mashing Enter while the failure appears powers nothing off")
        self.assertIn("電源を切る", d.button_text(d.focus()))
        d.ui.screen_since -= 6
        d.key("Enter")
        self.assertIn("もう一度押すと", d.button_text(d.focus()), "after the moment it asks, once")
        self.assertNotIn("power_calls", d.w.world_file.read_text())

    def test_no_selectable_disk_screen(self):
        d = self.d
        d.w.edit_disk("nvme0n1", children=[{}])
        d.c.refresh()
        d.ui.render(force=True)
        d.spin()
        text = d.text()
        self.assertIn("入れられる SSD がありません", text)
        self.assertEqual(text.count("使えません"), 2)
        self.assertIn("この画面からディスクの中身は消せません", text)
        self.assertEqual([b for b in d.buttons() if "card" in b.get_style_context().list_classes()], [])
        self.assertEqual(d.focus_text(), "もう一度さがす")
        d.key("Escape")
        self.assertEqual(d.c.screen, "none")
        d.key("Left")
        self.assertEqual(d.focus_text(), "電源を切る")

    def test_every_label_is_drawn_by_the_bundled_font(self):
        d = self.d
        used = d.fonts_used()
        self.assertTrue(used)
        for (family, exact), n in used.items():
            self.assertEqual(family, "Noto Sans JP")
            self.assertTrue(exact, f"{n} glyphs not covered exactly by the bundled face")
        for key in ("Enter", "Enter"):
            d.key(key)  # the confirmation's glyphs too
            used = d.fonts_used()
            self.assertTrue(all(exact and fam == "Noto Sans JP" for (fam, exact) in used), used)

    def test_card_tags_are_centred_and_the_product_title_uses_the_design_pitch(self):
        d = self.d
        tags = [l for l in d.labels() if l.get_text() in ("✓ 選択中", "使えません")]
        self.assertTrue(tags)
        for tag in tags:
            card = tag.get_ancestor(d.Gtk.Button) or tag.get_parent().get_parent()
            _x, off_y = tag.get_layout_offsets()  # where the text really is (in the parent window), not the label's allocation
            text_top = tag.translate_coordinates(card, 0, 0)[1] + off_y - tag.get_allocation().y
            mid_tag = text_top + tag.get_layout().get_pixel_size()[1] / 2  # card coordinates
            self.assertAlmostEqual(mid_tag, card.get_allocated_height() / 2, delta=3, msg=tag.get_text())
        prod = [l for l in d.labels() if l.get_text().startswith("PC に")][0]
        lines = prod.get_layout().get_pixel_size()[1]
        size = prod.get_pango_context().get_font_description().get_size() / 1024 * 96 / 72
        self.assertLessEqual(lines / (2 * size), 1.4, "two lines of the product title must not be wider than the design's pitch")

    def test_layout_proportions_follow_the_figma_board(self):
        for size in ((1280, 720), (1920, 1080), (2560, 1440)):
            d = gtkdrive.Drive(*size)
            try:
                f = size[0] / 1280
                self.assertAlmostEqual(d.ui.rail.get_allocated_width() / size[0], 390 / 1280, delta=0.01)
                card = [b for b in d.buttons() if "card" in b.get_style_context().list_classes()][0]
                self.assertAlmostEqual(card.get_allocated_width() / f, 778, delta=8, msg="cards are 786 wide in the board")
                self.assertAlmostEqual(card.get_allocated_height() / f, 92, delta=3)
                self.assertAlmostEqual(d.ui.u, f, delta=0.01)
                title = d.ui.title.get_pango_context().get_font_description().get_size() / 1024 * 96 / 72
                self.assertAlmostEqual(title, 40 * f, delta=2)
                go = d.button("内容を確認")
                self.assertAlmostEqual(go.get_allocated_height() / f, 53, delta=3, msg="buttons are 18 * 1.4 + 28 high")
            finally:
                d.close()

    def test_narrow_and_portrait_screens_use_the_stepper_bar_instead_of_the_rail(self):
        for size, compact in (((800, 600), True), ((720, 1280), True), ((1280, 720), False), ((1024, 600), False)):
            d = gtkdrive.Drive(*size)
            try:
                self.assertEqual(d.ui.compact, compact, size)
                self.assertEqual(d.ui.topbar.get_mapped(), compact, size)
                self.assertEqual(d.ui.rail.get_mapped(), not compact, size)
            finally:
                d.close()


if __name__ == "__main__":
    unittest.main()
