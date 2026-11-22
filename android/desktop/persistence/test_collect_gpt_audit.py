from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import struct
import unittest
from uuid import UUID
from zlib import crc32

spec = spec_from_file_location("collect_gpt_audit", Path(__file__).with_name("collect-gpt-audit.py"))
audit = module_from_spec(spec)
spec.loader.exec_module(audit)


def fixture(sectors):
    entries = bytearray(32 * 512)
    guid = UUID(int=42).bytes_le
    struct.pack_into("<16s16sQQQ", entries, 0, guid, UUID(int=43).bytes_le, 2048, 4095, 0)
    entries[56:62] = "ESP".encode("utf-16le")

    def header(current, other, start):
        data = bytearray(512)
        struct.pack_into("<8sIIIIQQQQ16sQIII", data, 0, b"EFI PART", 0x10000, 92, 0, 0,
                         current, other, 34, sectors - 34, guid, start, 128, 128, crc32(entries))
        struct.pack_into("<I", data, 16, crc32(data[:92]))
        return bytes(data)

    head = bytes(512) + header(1, sectors - 1, 2) + entries
    tail = entries + header(sectors - 1, 1, sectors - 33)
    return head, tail


def validate(head, tail, sectors, *, previous_head=None):
    geometry = f"{sectors}\n".encode()
    files = {
        "before.head": previous_head if previous_head is not None else head,
        "after.head": head, "before.tail": tail, "after.tail": tail, "sectors": geometry,
    }
    witness = "".join(f"{sha256(data).hexdigest()}  {name}\n" for name, data in files.items())
    return audit.validate(head, tail, geometry, witness.encode())


class GptAuditTests(unittest.TestCase):
    def test_two_capacities(self):
        for sectors in (500118192, 510000000):
            with self.subTest(sectors=sectors):
                report = validate(*fixture(sectors), sectors)
                self.assertTrue(report["gptUnchanged"])
                self.assertEqual(report["sectors"], sectors)
                self.assertEqual(report["partitions"][0]["start"], 2048)
                self.assertEqual(report["free"][-1]["end"], sectors - 34)

    def test_reject_incorrect_reported_capacity(self):
        with self.assertRaisesRegex(ValueError, "geometry"):
            validate(*fixture(500118192), 510000000)

    def test_reject_backup_from_other_disk_size(self):
        head, _ = fixture(500118192)
        _, tail = fixture(510000000)
        with self.assertRaisesRegex(ValueError, "geometry"):
            validate(head, tail, 500118192)

    def test_reject_changed_witness_and_bad_table_crc(self):
        head, tail = fixture(500118192)
        altered = head[:-1] + b"\x01"
        with self.assertRaisesRegex(ValueError, "changed GPT head"):
            validate(altered, tail, 500118192, previous_head=head)
        with self.assertRaisesRegex(ValueError, "entries CRC"):
            validate(altered, tail, 500118192)


if __name__ == "__main__":
    unittest.main()
