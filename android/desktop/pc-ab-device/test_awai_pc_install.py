from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
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


if __name__ == "__main__":
    unittest.main()
