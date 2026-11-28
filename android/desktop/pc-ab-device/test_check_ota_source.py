from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

spec = spec_from_file_location("ota_source", Path(__file__).with_name("check-ota-source.py"))
ota_source = module_from_spec(spec)
spec.loader.exec_module(ota_source)


class OtaSourceTest(unittest.TestCase):
    boot = b"boot bytes"
    logical = bytes(4096)

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.disk = self.root / "disk.img"
        self.zip = self.root / "target.zip"
        self.tool = self.root / "lpunpack"
        self.tool.write_bytes(b"fixed fixture tool")

    def case(self, *, boot=None, conflict=False, omit=False, duplicate=False, undeclared=False):
        if boot is None:
            boot = self.boot
        self.disk.write_bytes(bytes(512) + boot.ljust(512, b"\0") + bytes(4096))
        with zipfile.ZipFile(self.zip, "w") as archive:
            archive.writestr("META/ab_partitions.txt", "boot\nsystem\n" + ("boot\n" if duplicate else ""))
            archive.writestr("META/dynamic_partitions_info.txt",
                             "super_block_devices=super\nsuper_metadata_device=super\n"
                             f"dynamic_partition_list={'odm' if undeclared else 'system'}\n")
            archive.writestr("IMAGES/boot.img", self.boot)
            if not omit:
                archive.writestr("IMAGES/system.img", self.logical)
        table = {"boot_a": (1, 1), "super": (2, 9)}
        if conflict:
            table["system_a"] = (2, 9)
        args = SimpleNamespace(disk=self.disk, target_files=self.zip, slot="a", scratch=self.root,
                               disk_sha256=ota_source.file_digest(self.disk), target_sha256=ota_source.file_digest(self.zip),
                               lpunpack=self.tool, lpunpack_sha256=ota_source.file_digest(self.tool))
        return args, table

    def measured(self, args, table, contents):
        with patch.object(ota_source, "ranges", return_value=table), patch.object(
            ota_source, "unpack_logical", return_value=self.root
        ) as unpack:
            (self.root / "system_a.img").write_bytes(contents)
            result = ota_source.check(args)
            return result, unpack

    def test_all_source_partitions_match_in_selected_slot(self):
        args, table = self.case()
        result, unpack = self.measured(args, table, self.logical)
        self.assertTrue(result["incrementalSourceMatches"])
        self.assertEqual(result["slot"], "a")
        self.assertEqual({row["status"] for row in result["partitions"].values()}, {"PASS"})
        self.assertEqual(list(unpack.call_args.args[3]), ["system_a"])

    def test_boot_mismatch_skips_large_logical_readback(self):
        args, table = self.case(boot=b"boot drift")
        result, unpack = self.measured(args, table, self.logical)
        self.assertFalse(result["incrementalSourceMatches"])
        self.assertEqual(result["partitions"]["boot_a"]["reason"], "source-partition-digest-mismatch")
        self.assertEqual(result["partitions"]["system_a"]["status"], "NOT_CHECKED")
        unpack.assert_not_called()

    def test_logical_length_and_digest_are_independent_requirements(self):
        for contents, reason in ((self.logical + b"\0", "source-partition-size-mismatch"),
                                 (b"x" + self.logical[1:], "source-partition-digest-mismatch")):
            with self.subTest(reason=reason):
                args, table = self.case()
                result, _ = self.measured(args, table, contents)
                self.assertFalse(result["incrementalSourceMatches"])
                self.assertEqual(result["partitions"]["system_a"]["reason"], reason)

    def test_refuses_incomplete_or_ambiguous_inventory(self):
        for kwargs, error in (({"omit": True}, "exactly one"),
                              ({"duplicate": True}, "invalid A/B partition"),
                              ({"undeclared": True}, "no declared logical"),
                              ({"conflict": True}, "both GPT and the logical inventory")):
            with self.subTest(kwargs=kwargs):
                args, table = self.case(**kwargs)
                with self.assertRaisesRegex(ValueError, error):
                    self.measured(args, table, self.logical)

    def test_digest_check_precedes_disk_interpretation(self):
        args, _ = self.case()
        args.disk_sha256 = "0" * 64
        with patch.object(ota_source, "ranges") as read_table, self.assertRaisesRegex(ValueError, "SHA-256"):
            ota_source.check(args)
        read_table.assert_not_called()


if __name__ == "__main__":
    unittest.main()
