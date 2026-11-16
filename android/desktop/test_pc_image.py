import hashlib
import importlib.util
import pathlib
import os
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('pc_image', pathlib.Path(__file__).with_name('verify-pc-image.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImageIntegrity(unittest.TestCase):
    def test_stream_boundaries_and_corruption(self):
        parts = [b'kernel-candidate', b'system-candidate']
        pins = {'parts': [{'name': str(i), 'size': len(data),
                          'digest': 'sha256:' + hashlib.sha256(data).hexdigest()}
                         for i, data in enumerate(parts)]}
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / 'candidate.iso'
            path.write_bytes(b''.join(parts))
            self.assertEqual(module.verify(path, pins)['partsVerified'], 2)
            original = path.read_bytes()
            for invalid in [original[:-1], original + b'extra', b'X' + original[1:]]:
                path.write_bytes(invalid)
                with self.assertRaises(ValueError):
                    module.verify(path, pins)
            path.write_bytes(original)
            link = path.with_name('linked.iso')
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                module.verify(link, pins)
            fifo = path.with_name('pipe.iso')
            os.mkfifo(fifo)
            with self.assertRaises(ValueError):
                module.verify(fifo, pins)
            self.assertEqual(path.read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
