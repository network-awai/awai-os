import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('lan_http', Path(__file__).parents[2] / 'scripts/otehon-lan-http.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class Candidate(unittest.TestCase):
    def test_revision_and_every_digest_must_match(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            revision = 'a' * 40
            (d / 'SOURCE_REVISION').write_text(revision + '\n')
            lines = []
            for name in h.FILES:
                data = name.encode()
                (d / name).write_bytes(data)
                lines.append(hashlib.sha256(data).hexdigest() + '  ' + name)
            (d / 'SHA256SUMS').write_text('\n'.join(lines) + '\n')
            h.validate(d, revision)
            with self.assertRaises(ValueError): h.validate(d, 'b' * 40)
            (d / 'kernel').write_bytes(b'corrupted')
            with self.assertRaises(ValueError): h.validate(d, revision)
            (d / 'kernel').unlink()
            (d / 'kernel').symlink_to(d / 'initrd')
            with self.assertRaises(ValueError): h.validate(d, revision)
