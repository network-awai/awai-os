import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('client', Path(__file__).parents[2] / 'archive/nixos/scripts/otehon-lan-diagnostics.py')
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class Client(unittest.TestCase):
    def test_one_displayed_fingerprint_required(self):
        expected = 'SHA256:' + 'a' * 43
        key = '[10.77.0.2]:2222 ssh-ed25519 AAAA\n'
        valid_scan = SimpleNamespace(returncode=0, stdout=key)
        valid_fingerprint = SimpleNamespace(returncode=0, stdout='256 ' + expected + ' host (ED25519)\n')
        c.check_key(expected, valid_scan, valid_fingerprint)
        for scan, fp, requested in [
            (SimpleNamespace(returncode=0, stdout=key + key), valid_fingerprint, expected),
            (SimpleNamespace(returncode=0, stdout='[10.77.0.3]:2222 ssh-ed25519 AAAA\n'), valid_fingerprint, expected),
            (valid_scan, valid_fingerprint, 'SHA256:' + 'b' * 43),
            (valid_scan, SimpleNamespace(returncode=0, stdout=valid_fingerprint.stdout * 2), expected),
            (valid_scan, valid_fingerprint, 'invalid'),
        ]:
            with self.subTest(scan=scan.stdout, requested=requested), self.assertRaises(ValueError):
                c.check_key(requested, scan, fp)
