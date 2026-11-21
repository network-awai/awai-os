from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = spec_from_file_location("boot_default", HERE / "boot-default.py")
boot_default = module_from_spec(spec)
spec.loader.exec_module(boot_default)
spec = spec_from_file_location("pc_firmware", HERE / "pc-firmware.py")
pc_firmware = module_from_spec(spec)
spec.loader.exec_module(pc_firmware)

STOCK = 'load_env -f ${partition_persist}/grubenv android_theme grub_android_default grub_timeout\n' \
        'set default=$grub_android_default\n'


def added(patch, path):
    """Lines a patch adds to one file."""
    lines, inside = [], False
    for line in (HERE / "patches" / patch).read_text().splitlines():
        if line.startswith("+++ "):
            inside = line == f"+++ b/{path}"
        elif inside and line.startswith("+"):
            lines.append(line[1:])
    return "\n".join(lines) + "\n"


def assembled():
    radeon = added("virtio-x86-64-awai-radeon.patch", "bootmgr/grub/grub-boot.cfg")
    default = added("virtio-x86-64-awai-radeon-default.patch", "bootmgr/grub/grub-boot.cfg")
    return STOCK + "submenu 'Advanced options (virtio_x86_64 specific)' {\n" + radeon + "}\n" + default


def env_block(text):
    body = (boot_default.ENV_HEADER.decode() + text).encode()
    return body + b"#" * (1024 - len(body))


class BootDefaultTest(unittest.TestCase):
    def test_patched_config_passes(self):
        self.assertEqual(boot_default.check_cfg(assembled()), [])

    def test_stock_config_has_no_detection(self):
        cfg = assembled()
        cfg = cfg[:cfg.index("\n# AWAI-3563")] + "\n"
        self.assertIn("no AMD detection block keyed on the factory default 0", boot_default.check_cfg(cfg))

    def test_radeon_default_must_need_no_virtio_gpu(self):
        cfg = assembled().replace('\tif [ -z "$awai_virtio_gpu" ]; then\n', '\tif true; then\n')
        self.assertTrue(any("awai_virtio_gpu" in f for f in boot_default.check_cfg(cfg)))

    def test_detection_must_follow_stock_default(self):
        cfg = assembled()
        detect = cfg[cfg.index("if [ \"$default\" = \"0\" ]"):]
        cfg = detect + cfg[:cfg.index("if [ \"$default\" = \"0\" ]")]
        self.assertIn("the detection block runs before the stock default or the Radeon entry is defined",
                      boot_default.check_cfg(cfg))

    def test_radeon_entry_needs_mesa_arguments(self):
        cfg = assembled().replace(" androidboot.graphics=mesa", "")
        self.assertTrue(any("does not boot with" in f for f in boot_default.check_cfg(cfg)))

    def test_env_and_selection(self):
        env = boot_default.parse_env(env_block("grub_android_default=0\ngrub_timeout=10\n"))
        self.assertEqual(env["grub_android_default"], "0")
        self.assertTrue(boot_default.expected(env, True)[1].startswith("Radeon entry"))
        self.assertTrue(boot_default.expected(env, False)[1].startswith("first entry"))
        saved = boot_default.parse_env(env_block("grub_android_default=android\n"))
        self.assertEqual(boot_default.expected(saved, True)[1], "saved entry android on every machine")
        with self.assertRaises(ValueError):
            boot_default.parse_env(b"# GRUB Environment Block\n")

    def test_firmware_preparation_applies_default_after_radeon_entry(self):
        names = [p.name for p in pc_firmware.RADEON_PATCHES]
        self.assertEqual(names, ["virtio-x86-64-awai-radeon.patch", "virtio-x86-64-awai-radeon-default.patch"])
        self.assertTrue(all(p.is_file() for p in pc_firmware.RADEON_PATCHES))


if __name__ == "__main__":
    unittest.main()
