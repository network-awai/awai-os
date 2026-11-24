"""The front-end-neutral controller (no GTK): one-shot ticket, typed name, single detached worker, true state, power question.
Ported from the old backend's tests; every refusal still comes from core.py. Fake tools, no real disk."""
import json
import os
import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402
import controller as ctl  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.w = fakes.World()
        self.addCleanup(self.w.cleanup)
        self.new()

    def new(self):
        self.c = ctl.Controller(self.w.host, str(self.w.work), str(self.w.media), worker_cmd=fakes.worker_cmd(self.w))
        self.c.refresh()
        self.addCleanup(self.finish)

    def finish(self):
        end = time.time() + 60
        while time.time() < end and (core.lock_held(str(self.w.work)) or (self.c.proc and self.c.proc.poll() is None)):
            time.sleep(0.1)

    def wait_state(self, want, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            st = self.c.sync()
            if st["state"] in want:
                return st
            time.sleep(0.1)
        self.fail(f"state never reached {want}: {st}")

    def go(self, device="nvme0n1", typed=None):
        self.c.select(device)
        self.assertTrue(self.c.review(), self.c.message)
        return self.c.start(typed or device)


class Flow(Base):
    def test_pick_review_start_to_done(self):
        self.assertEqual(self.c.screen, "pick")
        self.assertTrue(self.go())
        self.assertEqual(self.c.screen, "progress")
        st = self.wait_state(("done", "failed"))
        self.assertEqual((st["state"], st["partitions"]), ("done", 11))
        self.assertEqual(self.c.sync()["state"], "done")
        self.assertEqual(self.c.screen, "done")
        self.assertEqual(self.c.view()["rail"], 3)

    def test_selected_is_a_toggle_and_ineligible_disks_cannot_be_selected(self):
        self.c.select("nvme0n1")
        self.assertEqual(self.c.selected, "nvme0n1")
        self.c.select("nvme0n1")
        self.assertIsNone(self.c.selected)
        self.c.select("sda")
        self.assertIsNone(self.c.selected)
        self.assertFalse(self.c.review())

    def test_review_refuses_ineligible_target_with_a_japanese_reason(self):
        self.c.selected = "sda"
        self.assertFalse(self.c.review())
        self.assertIn("選べません", self.c.message)
        self.assertEqual(self.c.screen, "pick")
        self.assertIsNone(self.c.ticket)

    def test_ticket_is_one_shot(self):
        self.c.select("nvme0n1")
        self.assertTrue(self.c.review())
        self.assertTrue(self.c.start("nvme0n1"))
        self.wait_state(("done", "failed"))
        self.assertFalse(self.c.start("nvme0n1"))
        self.assertIn("確認", self.c.message)

    def test_start_without_review_is_refused_and_starts_nothing(self):
        self.assertFalse(self.c.start("nvme0n1"))
        self.assertIsNone(self.c.proc)
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())

    def test_wrong_typed_name_consumes_the_ticket_and_starts_nothing(self):
        self.c.select("nvme0n1")
        self.c.review()
        self.assertFalse(self.c.typed_ok("nvme0"))
        self.assertTrue(self.c.typed_ok("nvme0n1"))
        self.assertFalse(self.c.start("nvme0"))
        self.assertIn("一致しません", self.c.message)
        self.assertFalse(self.c.start("nvme0n1"))
        self.assertIsNone(self.c.proc)

    def test_disk_changed_between_review_and_start_is_refused_with_nothing_written(self):
        self.c.select("nvme0n1")
        self.c.review()
        self.w.edit_disk("nvme0n1", serial="SN-OTHER")
        self.assertTrue(self.c.start("nvme0n1"))
        st = self.wait_state(("failed", "done"))
        self.assertEqual((st["state"], st["error"]["code"], st["written"]), ("failed", "identity-changed", "none"))
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())
        self.assertEqual(self.c.screen, "failed")

    def test_failure_is_never_done(self):
        self.w.update(sgdisk_v_problem=True)
        self.go()
        st = self.wait_state(("done", "failed"))
        self.assertEqual((st["state"], st["error"]["step"], st["written"]), ("failed", 3, "started"))
        self.c.sync()
        self.assertEqual(self.c.screen, "failed")

    def test_failure_that_wrote_nothing_can_be_dismissed_but_not_after_writing(self):
        (self.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n")
        self.go()
        st = self.wait_state(("failed",))
        self.assertEqual(st["written"], "none")
        self.assertTrue(self.c.dismiss())
        self.assertEqual(self.c.screen, "pick")
        self.assertEqual(self.c.sync()["state"], "idle")
        (self.w.media / "archive.sha256").write_text(f"{self.w.archive_sha}  {core.ARCHIVE_NAME}\n")
        self.w.update(sgdisk_v_problem=True)
        self.go()
        self.wait_state(("failed",))
        self.assertFalse(self.c.dismiss())
        self.c.screen = "pick"
        self.c.selected = "nvme0n1"
        self.assertFalse(self.c.review())
        self.assertIn("再起動", self.c.message)

    def test_done_state_blocks_a_second_install(self):
        self.go()
        self.wait_state(("done",))
        self.c.selected = "nvme0n1"
        self.assertFalse(self.c.review())

    def test_review_is_refused_while_another_installer_holds_the_lock(self):
        import fcntl
        fd = os.open(self.w.work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)  # e.g. the text installer is writing
        self.addCleanup(os.close, fd)
        self.c.select("nvme0n1")
        self.assertFalse(self.c.review())
        self.assertIn("実行中", self.c.message)
        self.assertIsNone(self.c.proc)

    def test_lock_taken_between_review_and_start_blocks_the_start(self):
        import fcntl
        self.c.select("nvme0n1")
        self.c.review()
        fd = os.open(self.w.work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        self.addCleanup(os.close, fd)
        self.assertFalse(self.c.start("nvme0n1"))
        self.assertIsNone(self.c.proc)


class CardsAndSteps(Base):
    def test_cards_show_vendor_with_model_and_only_the_boot_reason_for_the_usb(self):
        cards = {c["name"]: c for c in self.c.cards()}
        self.assertEqual(cards["nvme0n1"]["title"], "内蔵 SSD")
        self.assertEqual(cards["nvme0n1"]["sub"], "20.0 GiB · NVMe · 空きディスク")
        self.assertEqual(cards["sda"]["title"], "KIOXIA TransMemory")
        self.assertEqual(cards["sda"]["sub"], "62.0 GiB · この PC を起動した USB")
        self.assertEqual(cards["sda"]["tag"], "選択不可")
        self.assertFalse(cards["sda"]["eligible"])

    def test_vendor_is_not_repeated_when_the_model_already_has_it(self):
        self.assertEqual(ctl.disk_title({"name": "sdb", "vendor": "KIOXIA", "model": "KIOXIA TransMemory"}), "KIOXIA TransMemory")
        self.assertEqual(ctl.disk_title({"name": "sdb", "vendor": "", "model": "X"}), "X")
        self.assertEqual(ctl.disk_title({"name": "sdb", "vendor": "", "model": ""}), "sdb")

    def test_no_eligible_disk_is_screen_none_with_every_reason_listed(self):
        self.w.edit_disk("nvme0n1", children=[{}])
        self.c.refresh()
        self.assertEqual(self.c.screen, "none")
        self.assertEqual([c["tag"] for c in self.c.cards()], ["選択不可", "選択不可"])
        self.assertIn("既存の区画あり", self.c.cards()[0]["sub"])

    def test_rail_follows_the_screen(self):
        want = {"pick": 0, "none": 0, "review": 1, "progress": 2, "failed": 2, "done": 3}
        for screen, idx in want.items():
            self.c.screen = screen
            self.assertEqual(self.c.rail_index(), idx)


class CrashSafety(Base):
    def setUp(self):
        super().setUp()
        self.w.update(sgdisk_new_delay=2.0)

    def test_worker_is_detached_from_the_front_end_session(self):
        self.go()
        self.wait_state(("running",))
        self.assertNotEqual(os.getpgid(self.c.proc.pid), os.getpgid(0))
        self.assertNotEqual(os.getsid(self.c.proc.pid), os.getsid(0))
        self.wait_state(("done", "failed"))

    def test_front_end_crash_mid_write_does_not_stop_or_duplicate_the_write(self):
        self.go()
        end = time.time() + 30
        while time.time() < end and not (self.w.work / "write-started").exists():
            time.sleep(0.05)
        self.assertTrue((self.w.work / "write-started").exists())
        # the GUI process is killed: a new front end starts from nothing and reads the true state
        self.assertTrue(core.lock_held(str(self.w.work)), "the detached worker keeps the lock")
        self.new()
        self.c.refresh()
        st = self.c.sync()
        self.assertEqual((st["state"], st["written"], self.c.screen), ("running", "started", "progress"))
        self.c.selected = "nvme0n1"
        self.assertFalse(self.c.review())
        self.assertEqual(self.wait_state(("done", "failed"))["state"], "done")
        self.assertEqual(self.c.screen, "done")
        self.assertEqual(len(list(self.w.work.glob("install-record.json"))), 1)

    def test_killed_worker_is_reported_as_interrupted_never_running_or_done(self):
        self.go()
        end = time.time() + 30
        while time.time() < end and not (self.w.work / "write-started").exists():
            time.sleep(0.05)
        self.c.proc.kill()
        self.c.proc.wait()
        end = time.time() + 10
        while time.time() < end and core.lock_held(str(self.w.work)):
            time.sleep(0.05)
        st = self.c.sync()
        self.assertEqual((st["state"], st["error"]["code"], st["written"]), ("failed", "interrupted", "started"))
        self.assertEqual(self.c.screen, "failed")

    def test_power_and_reboot_refused_while_writing(self):
        self.go()
        self.wait_state(("running",))
        self.assertEqual(self.c.power_press(), "refused")
        self.assertEqual(self.c.power_press(), "refused")
        self.assertEqual(self.c.reboot(), "refused")
        self.assertNotIn("power_calls", json.loads(self.w.world_file.read_text()))
        self.wait_state(("done",))
        self.assertEqual(self.c.reboot(), "done")
        self.assertEqual(json.loads(self.w.world_file.read_text())["power_calls"], [["reboot"]])


class Power(Base):
    def calls(self):
        return json.loads(self.w.world_file.read_text()).get("power_calls", [])

    def test_power_off_asks_once_then_acts(self):
        self.assertEqual(self.c.power_press(), "armed")
        self.assertEqual(self.calls(), [])
        self.assertEqual(self.c.power_press(), "done")
        self.assertEqual(self.calls(), [["poweroff"]])

    def test_leaving_the_button_disarms_it(self):
        self.c.power_press()
        self.c.power_blur()
        self.assertEqual(self.c.power_press(), "armed")
        self.assertEqual(self.calls(), [])


class NoListener(unittest.TestCase):
    def test_nothing_in_the_installer_opens_a_socket_or_serves_http(self):
        import re
        for path in fakes.INSTALLER.glob("*.py"):
            if path.name in ("build-overlay.py", "glyphs.py"):
                continue
            text = path.read_text()
            for bad in (r"\bimport socket\b", r"http\.server", r"\bhttp\.client\b", r"urllib\.request", r"\.bind\(", r"\.listen\(", r"\bimport requests\b"):
                self.assertIsNone(re.search(bad, text), f"{path.name}: {bad}")
        self.assertFalse((fakes.INSTALLER / "server.py").exists())
        self.assertFalse((fakes.INSTALLER / "web").exists())
        self.assertFalse((fakes.INSTALLER / "kiosk").exists())

    def test_no_browser_anywhere(self):
        import re
        for path in list(fakes.INSTALLER.glob("*.py")) + list(fakes.INSTALLER.glob("*.sh")) + [fakes.INSTALLER / "awai-install"]:
            self.assertIsNone(re.search(r"firefox|mozilla|marionette|chromium", path.read_text(), re.I), path.name)


if __name__ == "__main__":
    unittest.main()
