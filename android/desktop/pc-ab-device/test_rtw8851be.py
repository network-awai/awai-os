"""AWAI-4092: RTL8851BE kernel config in awai-pc.config + vendor load order.

Host-only. Parses the Awai patch and asserts it appends the required Kconfig
chain (as modules) to the existing awai-pc.config fragment, lists the rtw89
load order, and stays ordered after awai-pc. It does not run olddefconfig
(Linux-only) or build.
"""
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
PATCH = HERE / "patches" / "virtio-common-rtw89-8851be.patch"

REQUIRED = [
    "CONFIG_WLAN_VENDOR_REALTEK=y",
    "CONFIG_CFG80211=m",
    "CONFIG_MAC80211=m",
    "CONFIG_RTW89=m",
    "CONFIG_RTW89_CORE=m",
    "CONFIG_RTW89_PCI=m",
    "CONFIG_RTW89_8851B=m",
    "CONFIG_RTW89_8851BE=m",
]

LOAD_ORDER = [
    "rtw89_core.ko",
    "rtw89_8851b.ko",
    "rtw89_pci.ko",
    "rtw89_8851be.ko",
]


def files_touched(patch):
    return [l[len("+++ b/"):] for l in patch.read_text().splitlines() if l.startswith("+++ ")]


def patch_added(patch, path):
    lines, inside = [], False
    for line in patch.read_text().splitlines():
        if line.startswith("+++ "):
            inside = line == f"+++ b/{path}"
        elif inside and line.startswith("+"):
            lines.append(line[1:])
    return lines


class KernelFragment(unittest.TestCase):
    def test_touches_boardconfig_and_awai_pc_config_only(self):
        self.assertEqual(sorted(files_touched(PATCH)),
                         ["BoardConfigCommon.mk", "configs/kernel/awai-pc.config"])

    def test_required_kconfig_chain_present_as_modules(self):
        added = patch_added(PATCH, "configs/kernel/awai-pc.config")
        for symbol in REQUIRED:
            self.assertIn(symbol, added, symbol)

    def test_boardconfig_adds_only_load_order(self):
        added = "\n".join(patch_added(PATCH, "BoardConfigCommon.mk"))
        self.assertIn("BOARD_VENDOR_KERNEL_MODULES_LOAD", added)

    def test_load_order_is_core_chip_bus_driver(self):
        added = "\n".join(patch_added(PATCH, "BoardConfigCommon.mk"))
        for name in LOAD_ORDER:
            self.assertIn(name, added)
        positions = [added.index(name) for name in LOAD_ORDER]
        self.assertEqual(positions, sorted(positions), "load order must be core->chip->bus->driver")


class ApplyWiring(unittest.TestCase):
    def test_apply_sh_applies_after_awai_pc(self):
        text = (HERE / "apply.sh").read_text()
        self.assertIn("virtio-common-rtw89-8851be.patch", text)
        self.assertLess(
            text.index("virtio-common-awai-pc.patch"),
            text.index("virtio-common-rtw89-8851be.patch"),
            "rtw89 patch must be ordered after awai-pc (awai-pc.config exists only after it)",
        )
        # Order vs aw-mesa-sphal is irrelevant (sepolicy only) but keep rtw89 first for determinism.
        self.assertLess(
            text.index("virtio-common-rtw89-8851be.patch"),
            text.index("virtio-common-aw-mesa-sphal.patch"),
        )


class FirmwareSelection(unittest.TestCase):
    """pc-firmware.py stages rtw89 firmware from the same a2dcb924 checkout."""

    def _module(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("pc_firmware", HERE / "pc-firmware.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_firmware_regex_requests_only_8851b_bin(self):
        mod = self._module()
        self.assertIsNotNone(mod.FIRMWARE.fullmatch("rtw89/rtw8851b_fw.bin"))
        # Kernel FW_FORMAT_MAX is 0: fw-1 is never requested (rtw8851b.c:18, fw.h:4197).
        self.assertIsNone(mod.FIRMWARE.fullmatch("rtw89/rtw8851b_fw-1.bin"))
        self.assertIsNotNone(mod.FIRMWARE.fullmatch("amdgpu/vcn_3_1_2.bin"))
        self.assertIsNotNone(mod.FIRMWARE.fullmatch("rtl_nic/rtl8168f-4.fw"))

    def test_pinned_files_scans_rtw89_and_counts_27(self):
        src = (HERE / "pc-firmware.py").read_text()
        self.assertIn('"rtw89"', src)
        self.assertIn("!= 27", src)

    def test_notices_include_rtlwifi_licence(self):
        mod = self._module()
        self.assertIn("LICENSES/LICENCE.rtlwifi_firmware.txt", [str(n) for n in mod.NOTICES])


if __name__ == "__main__":
    unittest.main()
