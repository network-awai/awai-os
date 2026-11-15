import hashlib
import functools
import http.server
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('lan_http', Path(__file__).parents[2] / 'scripts/otehon-lan-http.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class Candidate(unittest.TestCase):
    def test_http_only_serves_boot_files(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            (d / 'kernel').write_bytes(b'boot')
            (d / 'secret').write_bytes(b'not a boot file')
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(h.Handler, directory=temp))
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                root = 'http://127.0.0.1:%d' % server.server_port
                with urllib.request.urlopen(root + '/kernel') as response:
                    self.assertEqual(response.read(), b'boot')
                for path in ('/secret', '/', '/%2e%2e/secret', '/installer-info.json'):
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        urllib.request.urlopen(root + path)
                    self.assertEqual(error.exception.code, 404)
                    error.exception.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

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
