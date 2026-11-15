import importlib.util
from pathlib import Path
import tempfile
import unittest

source = Path(__file__).parents[2] / 'nixos/otehon/drive/alias.py'
spec = importlib.util.spec_from_file_location('drive_alias', source)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Alias(unittest.TestCase):
    def test_offline_refusal_and_publication_then_withdrawal(self):
        with tempfile.TemporaryDirectory() as tmp:
            target, public = Path(tmp) / 'mount', Path(tmp) / 'Awai'
            target.mkdir()
            with self.assertRaises(RuntimeError):
                p.manage('publish', target, public, mounted=lambda _: False)
            self.assertFalse(public.exists())
            p.manage('publish', target, public, mounted=lambda _: True)
            self.assertEqual(public.resolve(), target.resolve())
            p.manage('withdraw', target, public)
            p.manage('withdraw', target, public)
            with self.assertRaises(FileNotFoundError):
                (public / 'file').write_text('must not fall back')

    def test_user_files_are_never_replaced_or_removed(self):
        with tempfile.TemporaryDirectory() as tmp:
            target, public = Path(tmp) / 'mount', Path(tmp) / 'Awai'
            public.mkdir()
            (public / 'keep').write_text('unique')
            with self.assertRaises(FileExistsError):
                p.manage('publish', target, public, mounted=lambda _: True)
            p.manage('withdraw', target, public)
            self.assertEqual((public / 'keep').read_text(), 'unique')
