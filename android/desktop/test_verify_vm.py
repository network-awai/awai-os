import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('verify_vm', pathlib.Path(__file__).with_name('verify-vm.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Admission(unittest.TestCase):
    def test_real_device_old_sdk_wrong_arch_and_incomplete_boot_are_refused(self):
        good = {'ro.kernel.qemu': '1', 'ro.build.version.sdk': '35',
                'ro.product.cpu.abilist': 'x86_64,x86', 'sys.boot_completed': '1'}
        module.admit(good)
        for key, value in [('ro.kernel.qemu', '0'), ('ro.build.version.sdk', '34'),
                           ('ro.product.cpu.abilist', 'arm64-v8a'), ('sys.boot_completed', '')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                module.admit({**good, key: value})


if __name__ == '__main__':
    unittest.main()
