import hashlib
import functools
import http.server
import importlib.util
import json
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

    def test_install_proof_binds_all_four_artifacts(self):
        with tempfile.TemporaryDirectory() as temp:
            d = Path(temp)
            revision = 'c' * 40
            (d / 'SOURCE_REVISION').write_text(revision)
            hashes = {}
            for name in h.FILES:
                (d / name).write_bytes(name.encode())
                hashes[name] = hashlib.sha256(name.encode()).hexdigest()
            (d / 'SHA256SUMS').write_text('\n'.join(value + '  ' + name for name, value in hashes.items()))
            proof = d / 'proof.json'
            data = {'schema': 'awai.otehon.lan-install-vm.v1', 'passed': True,
                    'physicalDisks': False, 'sourceRevision': revision, 'artifacts': hashes}
            proof.write_text(json.dumps(data))
            h.validate(d, revision, proof)
            for changed in ({'sourceRevision': 'd' * 40}, {'passed': False},
                            {'artifacts': {k: v for k, v in hashes.items() if k != 'installer-info.json'}}):
                proof.write_text(json.dumps({**data, **changed}))
                with self.assertRaises(ValueError): h.validate(d, revision, proof)

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
            proof = d / 'proof.json'
            data = {'schema':'awai.otehon.netboot-vm.v1','passed':True,'physicalDisks':False,
                    'sourceRevision':revision,'artifacts':{name: hashlib.sha256(name.encode()).hexdigest() for name in ('ipxe.efi','kernel','initrd')}}
            proof.write_text(json.dumps(data))
            h.validate(d, revision, proof)
            proof.write_text(json.dumps({**data,'passed':False}))
            with self.assertRaises(ValueError): h.validate(d, revision, proof)
            proof.write_text(json.dumps({**data,'artifacts':{}}))
            with self.assertRaises(ValueError): h.validate(d, revision, proof)
            proof.write_text(json.dumps(data))
            with self.assertRaises(ValueError): h.validate(d, 'b' * 40, proof)
            (d / 'kernel').write_bytes(b'corrupted')
            with self.assertRaises(ValueError): h.validate(d, revision, proof)
            (d / 'kernel').unlink()
            (d / 'kernel').symlink_to(d / 'initrd')
            with self.assertRaises(ValueError): h.validate(d, revision, proof)
