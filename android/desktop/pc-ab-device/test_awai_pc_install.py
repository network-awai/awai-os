from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest
from unittest.mock import patch


spec = spec_from_file_location("awai_pc_install", Path(__file__).with_name("awai-pc-install.py"))
installer = module_from_spec(spec)
spec.loader.exec_module(installer)
USABLE_SECTORS = "First usable sector is 34, last usable sector is 4095\n"


class InstallPreflightTest(unittest.TestCase):
    def test_accepts_512_logical_with_4096_physical(self):
        with patch.object(installer, "sgdisk", return_value=(
            "Sector size (logical/physical): 512/4096 bytes\n" + USABLE_SECTORS
        )):
            self.assertEqual(installer.table("image"), ([], 34, 4095))

    def test_rejects_unsupported_or_unknown_logical_size(self):
        for header in ("Sector size (logical/physical): 4096/4096 bytes\n", ""):
            with self.subTest(header=header), patch.object(
                installer, "sgdisk", return_value=header + USABLE_SECTORS
            ), self.assertRaisesRegex(SystemExit, "expected 512-byte logical sectors"):
                installer.table("image")

    def test_rejects_alias_before_reading_partition_table(self):
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.img"
            source.touch()
            target = source.with_name("target.img")
            target.symlink_to(source)
            with patch.object(installer, "sgdisk") as command:
                with self.assertRaisesRegex(SystemExit, "same file or device"):
                    installer.make_plan(target, source, 16)
                command.assert_not_called()

    def test_hash_requires_full_range(self):
        with TemporaryDirectory() as folder:
            image = Path(folder) / "source.img"
            data = b"A" * 512
            image.write_bytes(data)
            self.assertEqual(installer.sha_range(image, 0, 0), sha256(data).hexdigest())
            with self.assertRaisesRegex(SystemExit, "short read"):
                installer.sha_range(image, 0, 1)

    def test_rejects_truncated_source_before_mutating_gpt(self):
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.img"
            source.write_bytes(b"A" * 512)
            plan = {"existing": [], "new": [{"from": {"start": 1, "end": 2}}]}
            with patch.object(installer, "sgdisk") as command:
                with self.assertRaisesRegex(SystemExit, "shorter than its partition table"):
                    installer.apply("target", source, plan, "record.json")
                command.assert_not_called()

    def test_rejects_existing_record_before_applying(self):
        with TemporaryDirectory() as folder:
            record = Path(folder) / "record.json"
            record.write_text("prior result")
            with patch.object(installer, "sgdisk") as command:
                with self.assertRaisesRegex(SystemExit, "install record already exists"):
                    installer.apply("target", "source", {}, record)
                command.assert_not_called()
            self.assertEqual(record.read_text(), "prior result")

    def test_rejects_wrong_source_digest_before_applying(self):
        with TemporaryDirectory() as folder:
            source = Path(folder) / "source.img"
            source.write_bytes(b"A" * 512)
            plan = {"existing": [], "new": [{"from": {"start": 0, "end": 0}}]}
            with patch.object(installer, "sgdisk") as command:
                with self.assertRaisesRegex(SystemExit, "digest does not match"):
                    installer.apply("target", source, plan, source.with_suffix(".json"), "0" * 64)
                command.assert_not_called()

    def test_copied_partitions_are_read_back_before_publishing_record(self):
        partition = {"name": "boot_a", "number": 1, "start": 1, "end": 1, "type": "8300",
                     "guid": None, "from": {"start": 0, "end": 0}}
        plan = {"existing": [], "new": [partition]}
        with TemporaryDirectory() as folder:
            source, target, record = [Path(folder) / name for name in ("source.img", "target.img", "install.json")]
            source.write_bytes(b"A" * 512)
            target.write_bytes(b"\0" * 1024)

            def changed_disk(_):
                if target.read_bytes()[512:] != b"A" * 512:
                    return [], 0, 1
                with target.open("r+b") as image:
                    image.seek(512)
                    image.write(b"B" * 512)
                return [partition], 0, 1

            with patch.object(installer, "sgdisk"), patch.object(installer, "table", side_effect=changed_disk):
                with self.assertRaisesRegex(SystemExit, "written data differs on readback"):
                    installer.apply(target, source, plan, record)
            self.assertFalse(record.exists())

            with patch.object(installer, "sgdisk"), patch.object(
                installer, "table", side_effect=[([], 0, 1), ([partition], 0, 1)]
            ):
                digest = sha256(source.read_bytes()).hexdigest()
                installer.apply(target, source, plan, record, digest)
            result = json.loads(record.read_text())
            self.assertEqual(result["sourceSha256"], digest)
            self.assertEqual(result["newPartitionReadback"]["boot_a"],
                             {"start": 1, "end": 1, "sha256": digest})



if __name__ == "__main__":
    unittest.main()
