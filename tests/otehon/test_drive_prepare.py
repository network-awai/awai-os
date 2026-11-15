import importlib.util
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

source = Path(__file__).parents[2] / 'nixos/otehon/drive/prepare.py'
spec = importlib.util.spec_from_file_location('drive_prepare', source)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Prepare(unittest.TestCase):
    def run_prepare(self, root, encrypted=True):
        home = root / 'home'
        home.mkdir(exist_ok=True)
        user = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid(), pw_dir=str(home))
        config = {'state': str(root / 'drive'), 'mount': str(home / 'Awai'),
                  'user': 'fixture', 'defaultSave': True}
        with patch.object(p.pwd, 'getpwnam', return_value=user), \
             patch.object(p.subprocess, 'check_output', side_effect=['253:0\n', '253:0\n' if encrypted else '253:1\n']):
            p.prepare(config)

    def test_refuses_unencrypted_state_before_creating_store_or_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(RuntimeError):
                self.run_prepare(root, encrypted=False)
            self.assertFalse((root / 'drive').exists())

    def test_fresh_defaults_private_credentials_and_existing_preferences_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.run_prepare(root)
            credentials = root / 'drive/credentials'
            old = credentials.read_bytes()
            self.assertEqual(credentials.stat().st_mode & 0o777, 0o600)
            self.assertIn(b'RCLONE_WEBDAV_BEARER_TOKEN=', old)
            dirs = root / 'home/.config/user-dirs.dirs'
            self.assertIn(str(root / 'home/Awai'), dirs.read_text())
            dirs.write_text('XDG_DOCUMENTS_DIR="$HOME/original"\n')
            self.run_prepare(root)
            self.assertEqual(credentials.read_bytes(), old)
            self.assertEqual(dirs.read_text(), 'XDG_DOCUMENTS_DIR="$HOME/original"\n')

    def test_existing_mount_content_and_credential_symlinks_are_preserved_and_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'home/Awai').mkdir(parents=True)
            keep = root / 'home/Awai/owner.txt'
            keep.write_text('unique WIP')
            with self.assertRaises(RuntimeError):
                self.run_prepare(root)
            self.assertEqual(keep.read_text(), 'unique WIP')
            keep.unlink()
            (root / 'drive/credentials').symlink_to(keep)
            with self.assertRaises(RuntimeError):
                self.run_prepare(root)
            self.assertTrue((root / 'drive/credentials').is_symlink())
