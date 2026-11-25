"""Guards and install sequence (core.py) against fake tools and temp files. No root, no real disks."""
import fcntl
import json
import os
import sys
import threading
import time
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fakes  # noqa: E402
from fakes import core  # noqa: E402


class Base(unittest.TestCase):
    vbmeta = False

    def setUp(self):
        self.w = fakes.World(vbmeta=self.vbmeta)
        self.addCleanup(self.w.cleanup)

    def assertRefused(self, state, code, written="none"):
        self.assertEqual(state["state"], "failed", state)
        self.assertEqual(state["error"]["code"], code, state)
        self.assertEqual(state["written"], written)
        self.assertNotEqual(state["state"], "done")

    def assertNothingWritten(self):
        self.assertFalse((self.w.dev / "nvme0n1.gpt.json").exists())
        self.assertFalse((self.w.work / "write-started").exists())
        self.assertFalse((self.w.work / "install-record.json").exists())


class HappyPath(Base):
    def test_install_completes_with_every_check(self):
        events = []
        state = self.w.run(self.w.request(), on_update=lambda s: events.append((s["step"], s["fraction"], s["written"])))
        self.assertEqual(state["state"], "done")
        self.assertEqual(state["partitions"], 11)
        record = json.loads((self.w.work / "install-record.json").read_text())
        self.assertEqual(record["sourceSha256"], self.w.raw_sha)
        self.assertTrue(record["existingUnchanged"])
        self.assertEqual(len(record["newPartitionReadback"]), 11)
        steps = [e[0] for e in events]
        self.assertEqual(steps, sorted(steps))
        self.assertEqual({1, 2, 3}, set(steps))
        self.assertEqual(events[-1][1], 1.0)
        # progress is real: fractions grow inside a step and `written` flips only once writing began
        for step in (1, 2, 3):
            fr = [f for s, f, _ in events if s == step]
            self.assertEqual(fr, sorted(fr))
        self.assertEqual(next(i for i, e in enumerate(events) if e[2] == "started") > 0, True)
        self.assertEqual(json.loads((self.w.work / "state.json").read_text())["state"], "done")

    @unittest.skipIf(False, "")
    def test_current_image_with_vbmeta_expects_its_own_count(self):
        w = fakes.World(vbmeta=True)
        self.addCleanup(w.cleanup)
        state = w.run(w.request())
        self.assertEqual(state["state"], "done")
        self.assertEqual(state["partitions"], 13)

    def test_state_files_are_private(self):
        self.w.run(self.w.request())
        self.assertEqual(os.stat(self.w.work).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(self.w.work / "state.json").st_mode & 0o777, 0o600)


class TargetGuards(Base):
    def problems(self, name="nvme0n1"):
        return core.disk_problems(self.w.host, name, core.boot_chain(self.w.host, str(self.w.media)))

    def refused_install(self, code):
        # the same refusal at install time, from the request a front end could still send
        ident = {"name": "nvme0n1", "majmin": "259:0", "size": fakes.TARGET_BYTES, "model": "KXG80ZNV256G", "serial": "SN-A", "wwn": "eui.0025385"}
        state = self.w.run({"device": "nvme0n1", "confirmed": True, "identity": ident})
        self.assertRefused(state, code)
        self.assertNothingWritten()
        self.assertFalse((self.w.work / core.IMAGE_NAME).exists(), "an ineligible target must be refused before the image is unpacked")

    def test_clean_nvme_is_eligible(self):
        self.assertEqual(self.problems(), [])

    def test_only_whole_nvme_names(self):
        self.assertIn("not-nvme", self.problems("sda"))
        self.w.world["disks"]["nvme0n1p1"] = fakes.disk()
        (self.w.dev / "nvme0n1p1").write_bytes(b"")
        self.w.save()
        self.assertIn("not-nvme", self.problems("nvme0n1p1"))

    def test_must_be_a_block_device(self):
        with mock.patch.object(fakes.FakeHost, "is_block", return_value=False):
            self.assertIn("not-block", self.problems())

    def test_must_be_a_disk(self):
        self.w.edit_disk("nvme0n1", type="part")
        self.assertIn("not-disk", self.problems())

    def test_read_only_refused(self):
        self.w.edit_disk("nvme0n1", ro="1")
        self.assertIn("read-only", self.problems())
        self.refused_install("read-only")

    def test_partitions_refused(self):
        self.w.edit_disk("nvme0n1", children=[{}])
        self.assertIn("has-partitions", self.problems())
        self.refused_install("has-partitions")

    def test_sector_size_must_be_512(self):
        self.w.edit_disk("nvme0n1", logsec=4096)
        self.assertIn("sector-size", self.problems())
        self.refused_install("sector-size")

    def test_mounted_refused(self):
        self.w.edit_disk("nvme0n1", mounts=["/mnt/x"])
        self.assertIn("mounted", self.problems())
        self.refused_install("mounted")

    def test_foreign_signatures_refused_but_gpt_pmbr_allowed(self):
        self.assertEqual(self.problems(), [])
        for sig in (["ext4"], ["gpt", "LVM2_member"], ["crypto_LUKS"], ["PMBR", "ntfs"]):
            self.w.edit_disk("nvme0n1", signatures=sig)
            self.assertIn("signatures", self.problems(), sig)
        self.w.edit_disk("nvme0n1", signatures=["gpt", "PMBR"])
        self.assertEqual(self.problems(), [])

    def test_boot_medium_never_a_target_even_when_it_is_an_nvme(self):
        self.w.world["boot"] = {"source": "/dev/nvme0n1p1", "chain": ["nvme0n1p1", "nvme0n1"]}
        self.w.save()
        self.assertIn("boot-medium", self.problems())
        self.assertIn("boot-medium", self.problems("nvme0n1"))
        self.refused_install("boot-medium")

    def test_unknown_boot_medium_refuses_everything(self):
        self.w.update(boot=None)
        self.assertIn("boot-unknown", self.problems())
        self.refused_install("boot-unknown")

    def test_inspection_failure_is_refusal_not_pass(self):
        del self.w.world["disks"]["nvme0n1"]["size"]  # lsblk -P then fails to parse
        self.w.save()
        with self.assertRaises(Exception):
            core.identity(self.w.host, "nvme0n1")
        self.w.world["disks"].pop("nvme0n1")
        self.w.save()
        self.assertIn("inspect-failed", self.problems())

    def test_listing_marks_boot_usb_and_non_eligible_with_reasons(self):
        listing = {d["name"]: d for d in core.list_disks(self.w.host, str(self.w.media))}
        self.assertTrue(listing["nvme0n1"]["eligible"])
        usb = listing["sda"]
        self.assertFalse(usb["eligible"])
        self.assertIn("boot-medium", usb["problems"])
        self.assertIn("not-nvme", usb["problems"])

    def test_loop_and_ram_devices_are_not_listed(self):
        self.w.world["disks"]["loop0"] = fakes.disk(tran="")
        self.w.save()
        self.assertNotIn("loop0", {d["name"] for d in core.list_disks(self.w.host, str(self.w.media))})


class Confirmation(Base):
    def test_a_request_without_an_explicit_confirmed_true_is_refused_by_the_backend(self):
        for flag in (False, None, "", 0, 1, "true", "nvme0n1", "INSTALL nvme0n1", [True]):
            self.assertRefused(self.w.run(self.w.request(confirmed=flag)), "not-confirmed")
            self.assertNothingWritten()
        req = self.w.request()
        del req["confirmed"]
        self.assertRefused(self.w.run(req), "not-confirmed")
        self.assertNothingWritten()
        self.assertEqual(self.w.run(self.w.request())["state"], "done")

    def test_missing_identity_ticket_is_refused(self):
        state = self.w.run({"device": "nvme0n1", "confirmed": True})
        self.assertRefused(state, "no-ticket")

    def test_identity_must_match_before_anything_is_prepared(self):
        req = self.w.request()
        self.w.edit_disk("nvme0n1", model="OTHER")
        state = self.w.run(req)
        self.assertRefused(state, "identity-changed")
        self.assertFalse((self.w.work / core.IMAGE_NAME).exists())

    def _changed_during_image_preparation(self, **fields):
        req = self.w.request()
        self.w.update(mutate_after_zstd={"nvme0n1": fields})  # the disk changes while the image is unpacked
        state = self.w.run(req)
        self.assertRefused(state, "identity-changed")
        self.assertNothingWritten()

    def test_identity_rechecked_immediately_before_writing(self):
        for fields in ({"model": "OTHER"}, {"size": fakes.TARGET_BYTES}, {"majmin": "259:1"}, {"serial": "SN-B"},
                       {"serial": None}, {"wwn": "eui.other"}, {"wwn": None}):
            with self.subTest(fields=fields):
                self.setUp()
                if fields == {"size": fakes.TARGET_BYTES}:
                    fields = {"size": fakes.TARGET_BYTES + 512}
                self._changed_during_image_preparation(**fields)

    def test_identity_includes_serial_and_wwn_when_present(self):
        ident = core.identity(self.w.host, "nvme0n1")
        self.assertEqual(ident, {"name": "nvme0n1", "majmin": "259:0", "size": fakes.TARGET_BYTES,
                                 "model": "KXG80ZNV256G", "serial": "SN-A", "wwn": "eui.0025385"})

    def test_target_checks_rerun_immediately_before_writing(self):
        req = self.w.request()
        self.w.update(mutate_after_zstd={"nvme0n1": {"children": [{}]}})
        self.assertRefused(self.w.run(req), "has-partitions")
        self.assertNothingWritten()

    def test_mounting_after_confirmation_is_refused(self):
        req = self.w.request()
        self.w.update(mutate_after_zstd={"nvme0n1": {"mounts": ["/mnt"]}})
        self.assertRefused(self.w.run(req), "mounted")
        self.assertNothingWritten()


class ImageAndPlan(Base):
    def test_archive_sha_checked(self):
        (self.w.media / "archive.sha256").write_text("0" * 64 + f"  {core.ARCHIVE_NAME}\n")
        self.assertRefused(self.w.run(self.w.request()), "archive-sha")
        self.assertNothingWritten()

    def test_raw_image_sha_must_equal_pinned_value(self):
        (self.w.media / "install-image.sha256").write_text("1" * 64 + f"  {core.IMAGE_NAME}\n")
        state = self.w.run(self.w.request())
        self.assertRefused(state, "image-sha")
        self.assertNothingWritten()
        self.assertFalse((self.w.work / core.IMAGE_NAME).exists(), "an unverified image must not be kept")

    def test_existing_raw_image_is_rehashed(self):
        self.w.work.mkdir()
        (self.w.work / core.IMAGE_NAME).write_bytes(b"tampered")
        self.assertRefused(self.w.run(self.w.request()), "image-sha")
        self.assertNothingWritten()

    def test_pins_are_the_only_source_of_the_expected_digest(self):
        for text in ("", "abc  awai-pc-install.img\n", f"{'a' * 64} awai-pc-install.img\n", f"{'a' * 64}  other.img\n"):
            (self.w.media / "install-image.sha256").write_text(text)
            self.assertRefused(self.w.run(self.w.request()), "pins-invalid")
        for name in ("start.sh", "awai-install"):
            import re
            self.assertIsNone(re.search(r"[0-9a-f]{64}", (fakes.INSTALLER / name).read_text()), name)

    def test_truncated_archive_refused(self):
        data = (self.w.media / core.ARCHIVE_NAME).read_bytes()
        (self.w.media / core.ARCHIVE_NAME).write_bytes(data[:-1])
        self.assertRefused(self.w.run(self.w.request()), "archive-sha")

    def test_plan_must_be_empty_disk(self):
        (self.w.dev / "nvme0n1.gpt.json").write_text(json.dumps(
            {"parts": [{"number": 1, "start": 34, "end": 2047, "type": "8300", "name": "data"}], "guids": {}}))
        state = self.w.run(self.w.request())
        self.assertRefused(state, "plan-not-empty")
        self.assertFalse((self.w.work / "write-started").exists())

    def test_existing_awai_partition_name_refused(self):
        (self.w.dev / "nvme0n1.gpt.json").write_text(json.dumps(
            {"parts": [{"number": 1, "start": 34, "end": 2047, "type": "8300", "name": "boot_a"}], "guids": {}}))
        self.assertRefused(self.w.run(self.w.request()), "plan-name-in-use")

    def test_plan_must_have_the_expected_partition_count(self):
        real = core.load_installer()
        for drop in (1, -1):
            with self.subTest(drop=drop):
                self.setUp()
                wrapper = types.SimpleNamespace(**{k: getattr(real, k) for k in dir(real) if not k.startswith("__")})
                wrapper.make_plan = lambda *a, **k: (lambda p: dict(p, new=p["new"][:-1] if drop == 1 else p["new"] + p["new"][:1]))(real.make_plan(*a, **k))
                with mock.patch.object(core, "load_installer", return_value=wrapper):
                    self.assertRefused(self.w.run(self.w.request()), "plan-count")
                self.assertNothingWritten()


class MemoryLimits(Base):
    """The work directory is a tmpfs (half of RAM). A full disk must be a clear refusal, never a write to the SSD."""
    def assertNoSpace(self, state):
        self.assertRefused(state, "no-space")
        self.assertIn("メモリが足りません", core.status(str(self.w.work))["error"]["ja"])
        self.assertNothingWritten()
        self.assertEqual(state["error"]["step"], 1)

    def test_too_little_free_space_is_refused_before_unpacking(self):
        req = self.w.request()
        with mock.patch.object(core.shutil, "disk_usage", return_value=types.SimpleNamespace(total=1, used=1, free=0)):
            state = self.w.run(req)
        self.assertNoSpace(state)
        self.assertFalse((self.w.work / core.IMAGE_NAME).exists())
        self.assertFalse((self.w.work / (core.IMAGE_NAME + ".part")).exists())

    def test_enospc_while_unpacking_is_a_clear_refusal_and_leaves_nothing(self):
        import builtins
        import errno as errno_mod
        real_open = builtins.open

        class Full:
            def __init__(self, f):
                self.f, self.n = f, 0

            def write(self, data):
                self.n += len(data)
                if self.n > 100_000:
                    raise OSError(errno_mod.ENOSPC, "No space left on device")
                return self.f.write(data)

            def __getattr__(self, name):
                return getattr(self.f, name)

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return self.f.__exit__(*a)

        def fake_open(path, mode="r", *a, **k):
            f = real_open(path, mode, *a, **k)
            return Full(f) if str(path).endswith(".part") else f
        req = self.w.request()
        with mock.patch.object(core, "open", fake_open, create=True):
            state = self.w.run(req)
        self.assertNoSpace(state)
        self.assertFalse((self.w.work / (core.IMAGE_NAME + ".part")).exists(), "the partial file must be removed")
        self.assertFalse((self.w.work / core.IMAGE_NAME).exists())

    def test_enospc_anywhere_before_writing_is_still_not_an_install(self):
        import errno as errno_mod
        req = self.w.request()
        with mock.patch.object(core, "prepare_image", side_effect=OSError(errno_mod.ENOSPC, "full")):
            self.assertNoSpace(self.w.run(req))


class AfterApply(Base):
    def wrapped(self, record_edit=None, **flags):
        real = core.load_installer()
        wrapper = types.SimpleNamespace(**{k: getattr(real, k) for k in dir(real) if not k.startswith("__")})

        def apply(*a, **k):
            real.apply(*a, **k)
            if record_edit:
                rec = json.loads(Path(a[3]).read_text())
                record_edit(rec)
                Path(a[3]).write_text(json.dumps(rec))
        wrapper.apply = apply
        return mock.patch.object(core, "load_installer", return_value=wrapper)

    def test_record_must_name_the_expected_source_digest(self):
        with self.wrapped(lambda r: r.update(sourceSha256="2" * 64)):
            self.assertRefused(self.w.run(self.w.request()), "record-invalid", "started")

    def test_record_must_say_existing_unchanged(self):
        with self.wrapped(lambda r: r.update(existingUnchanged=False)):
            self.assertRefused(self.w.run(self.w.request()), "record-invalid", "started")

    def test_record_must_hold_every_readback(self):
        with self.wrapped(lambda r: r["newPartitionReadback"].pop("userdata")):
            self.assertRefused(self.w.run(self.w.request()), "record-invalid", "started")

    def test_record_readbacks_need_digests(self):
        with self.wrapped(lambda r: r["newPartitionReadback"]["boot_a"].update(sha256="x")):
            self.assertRefused(self.w.run(self.w.request()), "record-invalid", "started")

    def test_sgdisk_verify_problem_is_failure(self):
        self.w.update(sgdisk_v_problem=True)
        self.assertRefused(self.w.run(self.w.request()), "sgdisk-verify", "started")

    def test_sgdisk_verify_exit_code_is_failure(self):
        self.w.update(sgdisk_v_rc=2)
        self.assertRefused(self.w.run(self.w.request()), "sgdisk-verify", "started")

    def test_sync_must_succeed(self):
        self.w.update(sync_rc=1)
        self.assertRefused(self.w.run(self.w.request()), "sync-failed", "started")

    def test_failed_write_reports_started_and_never_done(self):
        self.w.update(sgdisk_new_fail=True)
        state = self.w.run(self.w.request())
        self.assertEqual(state["state"], "failed")
        self.assertEqual(state["written"], "started")
        self.assertIn(state["error"]["step"], (2,))
        self.assertNotIn("record", state)

    def test_unexpected_exception_is_failure(self):
        with mock.patch.object(core, "prepare_image", side_effect=RuntimeError("boom")):
            self.assertRefused(self.w.run(self.w.request()), "internal")


class SingleInstall(Base):
    def test_existing_record_blocks_until_reboot(self):
        self.assertEqual(self.w.run(self.w.request())["state"], "done")
        before = (self.w.work / "state.json").read_text()
        with self.assertRaises(core.Blocked):
            self.w.run({"device": "nvme0n1", "confirmed": True, "identity": {}})
        self.assertEqual((self.w.work / "state.json").read_text(), before, "a refused second start must not rewrite the done state")

    def test_write_marker_alone_blocks(self):
        self.w.work.mkdir()
        (self.w.work / "write-started").write_text("")
        with self.assertRaises(core.Blocked):
            self.w.run(self.w.request())

    def test_second_concurrent_start_is_busy_and_leaves_state_alone(self):
        self.w.work.mkdir(mode=0o700)
        fd = os.open(self.w.work / "lock", os.O_RDWR | os.O_CREAT, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        self.addCleanup(os.close, fd)
        (self.w.work / "state.json").write_text(json.dumps({"state": "running", "step": 2, "fraction": 0.4}))
        with self.assertRaises(core.Busy):
            self.w.run(self.w.request())
        self.assertEqual(json.loads((self.w.work / "state.json").read_text())["fraction"], 0.4)
        self.assertEqual(core.status(str(self.w.work))["state"], "running")
        self.assertNothingWritten()

    def test_running_state_without_a_live_worker_is_interrupted_not_running(self):
        self.w.work.mkdir(mode=0o700)
        (self.w.work / "state.json").write_text(json.dumps({"state": "running", "step": 2, "fraction": 0.4, "written": "started"}))
        (self.w.work / "write-started").write_text("")
        st = core.status(str(self.w.work))
        self.assertEqual(st["state"], "failed")
        self.assertEqual(st["error"]["code"], "interrupted")
        self.assertEqual(st["written"], "started")

    def test_threads_cannot_both_install(self):
        req = self.w.request()
        self.w.update(sgdisk_new_delay=1.0)
        results = []

        def go():
            try:
                results.append(self.w.run(req)["state"])
            except core.Busy:
                results.append("busy")
            except core.Blocked:
                results.append("blocked")
        threads = [threading.Thread(target=go) for _ in range(3)]
        for t in threads:
            t.start()
            import time
            time.sleep(0.05)
        for t in threads:
            t.join()
        self.assertEqual(len(results), 3)
        self.assertEqual(results.count("done"), 1)


class StateFile(Base):
    def test_partial_read_is_retried_not_reported_as_idle(self):
        self.w.work.mkdir(mode=0o700)
        path = self.w.work / "state.json"
        path.write_text("")  # caught between truncate and write

        def finish():
            time.sleep(0.08)
            path.write_text(json.dumps({"state": "running", "step": 2}))
        t = threading.Thread(target=finish)
        t.start()
        self.assertEqual(core.read_state(str(self.w.work))["state"], "running")
        t.join()
        path.write_text("{not json")
        self.assertEqual(core.read_state(str(self.w.work))["state"], "idle")
        path.unlink()
        self.assertEqual(core.read_state(str(self.w.work))["state"], "idle")


class ProgressHook(Base):
    def test_write_start_is_reported_before_the_first_gpt_change(self):
        mod = core.load_installer()
        raw = self.w.tmp / "raw.img"
        raw.write_bytes((self.w.media / core.ARCHIVE_NAME).read_bytes())
        target = str(self.w.dev / "nvme0n1")
        plan = mod.make_plan(target, str(raw), 16)
        seen = []

        def progress(event, done, total):
            seen.append((event, done, total, (self.w.dev / "nvme0n1.gpt.json").exists()))
        mod.apply(target, str(raw), plan, str(self.w.tmp / "rec.json"), self.w.raw_sha, progress=progress)
        events = [e[0] for e in seen]
        self.assertEqual(events[0], "write-start")
        self.assertFalse(seen[0][3], "write-start must precede the first GPT change")
        self.assertLess(events.index("write-start"), events.index("write"))
        self.assertLess(max(i for i, e in enumerate(events) if e == "write"), events.index("write-done"))
        self.assertLess(events.index("write-done"), events.index("verify"))
        self.assertEqual(seen[-1][1], seen[-1][2])

    def test_apply_without_progress_is_unchanged(self):
        mod = core.load_installer()
        self.assertIsNone(mod.apply.__defaults__[-1])


if __name__ == "__main__":
    unittest.main()
