"""AWAI-4092: RTL8851BE kernel-config fragment and vendor module load order.

Host-only. Parses the Awai patch and asserts it registers exactly one new
kernel-config fragment, enables the required Kconfig chain as modules, and
lists the rtw89 load order. It does not run olddefconfig (Linux-only) or build.
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
    def test_touches_boardconfig_and_new_fragment_only(self):
        self.assertEqual(sorted(files_touched(PATCH)),
                         ["BoardConfigCommon.mk", "configs/kernel/awai-pc-rtw89.config"])

    def test_required_kconfig_chain_present_as_modules(self):
        added = patch_added(PATCH, "configs/kernel/awai-pc-rtw89.config")
        for symbol in REQUIRED:
            self.assertIn(symbol, added, symbol)

    def test_boardconfig_registers_fragment(self):
        added = "\n".join(patch_added(PATCH, "BoardConfigCommon.mk"))
        self.assertIn("$(COMMON_PATH)/configs/kernel/awai-pc-rtw89.config", added)

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
            "rtw89 patch must be ordered after awai-pc (BoardConfig context)",
        )
        # Order vs aw-mesa-sphal is irrelevant (sepolicy only) but keep rtw89 first for determinism.
        self.assertLess(
            text.index("virtio-common-rtw89-8851be.patch"),
            text.index("virtio-common-aw-mesa-sphal.patch"),
        )


if __name__ == "__main__":
    unittest.main()
