import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('resolver',Path(__file__).parents[2]/'archive/nixos/scripts/otehon-diagnostic-browser-resolver.py')
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class ResolverBoundaryTests(unittest.TestCase):
    def test_only_named_ram_overlay_is_admitted(self):
        self.assertTrue(r.ram_overlay('1 0 0:1 / / rw - overlay overlay rw,lowerdir=/base,upperdir=/run/awai-ram-desktop-test-03/upper,workdir=/run/awai-ram-desktop-test-03/work'))
        self.assertFalse(r.ram_overlay('1 0 8:1 / / rw - ext4 /dev/nvme0n1p2 rw'))
        self.assertFalse(r.ram_overlay('1 0 0:1 / / rw - overlay overlay rw,upperdir=/var/lib/installed/upper'))
    def test_duplicate_roots_and_prefix_confusion_refused(self):
        line='1 0 0:1 / / rw - overlay overlay rw,upperdir=/run/awai-ram-desktop-test-03/upper'
        self.assertFalse(r.ram_overlay(line+'\n'+line))
        self.assertFalse(r.ram_overlay(line+'-not-the-upper'))
    def test_counts_without_exporting_nameserver_values(self):
        self.assertEqual(r.nameservers(b'# nameserver 9.9.9.9\nnameserver 1.1.1.1\nsearch private.local\n'),1)
if __name__=='__main__':unittest.main()
