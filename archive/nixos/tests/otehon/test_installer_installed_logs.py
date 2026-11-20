import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installed_logs', Path(__file__).parents[2] / 'archive/nixos/otehon/installer-installed-logs.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def tree(path='/dev/nvme0n1p2', transport='nvme', fstype='ext4'):
    return {'blockdevices': [{'type': 'disk', 'tran': transport, 'children': [
        {'path': path, 'type': 'part', 'partlabel': 'otehon-root', 'fstype': fstype, 'maj:min': '259:2'}]}]}


class InstalledLogs(unittest.TestCase):
    def test_only_unique_internal_ext4_root(self):
        self.assertEqual(m.target_from_tree(tree())['path'], '/dev/nvme0n1p2')
        for value in (tree(transport='usb'), tree(path='/dev/loop0p2'), tree(fstype='crypto_LUKS'), {'blockdevices': []}):
            with self.assertRaises(ValueError): m.target_from_tree(value)
        duplicate = tree(); duplicate['blockdevices'] *= 2
        with self.assertRaisesRegex(ValueError, 'root-not-unique'): m.target_from_tree(duplicate)

    def test_latest_persistent_boot_not_current_ram_boot(self):
        old, new = 'a'*32, 'b'*32
        self.assertEqual(m.latest_boot(f' -1 {old} previous\n 0 {new} latest\n'), new)
        with self.assertRaises(ValueError): m.latest_boot('No journal files were found.')

    def test_missing_journal_and_escaping_link(self):
        with tempfile.TemporaryDirectory() as temp, tempfile.TemporaryDirectory() as other:
            root = Path(temp)
            self.assertEqual(m.read_journal(root)['reason'], 'no-persistent-journal')
            (root/'var/log').mkdir(parents=True)
            (root/'var/log/journal').symlink_to(other)
            with self.assertRaisesRegex(ValueError, 'journal-path-escape'): m.read_journal(root)

    def test_fixed_unit_scope_and_redaction(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root/'var/log/journal').mkdir(parents=True)
            with patch.object(m, 'bounded', side_effect=[('0 '+'a'*32+' boot', False), ('greetd failed\nsecret=abc https://private.test /home/alice/file\x1b', False), ('amdgpu warning', False), ('cosmic compositor error', False)]) as run:
                result = m.read_journal(root)
            self.assertIn('greetd failed', result['text'])
            self.assertIn('cosmic compositor error', result['userSession'])
            self.assertIn('_UID=1000', run.call_args_list[3].args[0])
            self.assertNotIn('abc', result['text'])
            self.assertNotIn('alice', result['text'])
            self.assertNotIn('private.test', result['text'])
            self.assertIn('--boot='+'a'*32, run.call_args_list[1].args[0])
            self.assertIn('--unit=greetd.service', run.call_args_list[1].args[0])

    def test_encoded_unicode_response_bound(self):
        import json
        self.assertLessEqual(len(json.dumps(m.clean_log('😀'*100000), ensure_ascii=True)), 16000)

    def test_output_and_time_bounds(self):
        value, truncated = m.bounded([sys.executable, '-c', 'print("a"*200000)'], limit=1024)
        self.assertTrue(truncated); self.assertEqual(len(value), 1024)
        with self.assertRaises(TimeoutError):
            m.bounded([sys.executable, '-c', 'import time; time.sleep(2)'], timeout=.05)


if __name__ == '__main__': unittest.main()
