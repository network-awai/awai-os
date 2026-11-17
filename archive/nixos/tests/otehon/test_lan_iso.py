import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('iso', Path(__file__).parents[2] / 'archive/nixos/scripts/otehon-lan-iso.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Iso(unittest.TestCase):
    def test_export_is_read_only_and_pinned(self):
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / 'installer.iso'
            p.write_bytes(b'fixture')
            digest = hashlib.sha256(b'fixture').hexdigest()
            cmd = m.command(p, digest, 7, '127.0.0.1', 10809)
            self.assertIn('--read-only', cmd)
            self.assertIn('--format=raw', cmd)
            for bad_digest, size, bind in [('0'*64, 7, '127.0.0.1'), (digest, 8, '127.0.0.1'), (digest, 7, '0.0.0.0')]:
                with self.assertRaises(ValueError): m.command(p, bad_digest, size, bind, 10809)
