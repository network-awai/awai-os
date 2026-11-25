"""AWAI-4093: shipping default for LineageStats diagnostics is off.

Host-only. Parses the Awai vendor patch and asserts it flips exactly the
provider default to off, touches nothing else, and is wired into apply.sh.
SetupWizard's first-setup default is owned by the existing
scripts/operator/same-build/inputs/setupwizard-awai.patch (same
LineageSettingsActivity.kt hunk); this suite guards that no second
SetupWizard patch is shipped here. It does not build, boot, or fetch code.
"""
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
VENDOR_PATCH = HERE / "patches" / "vendor-lineage-stats-default-off.patch"


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


def patch_removed(patch, path):
    lines, inside = [], False
    for line in patch.read_text().splitlines():
        if line.startswith("--- "):
            # --- line names the a-side; track it for the removed scan below
            inside = line == f"--- a/{path}"
        elif inside and line.startswith("-") and not line.startswith("---"):
            lines.append(line[1:])
    return lines


class VendorDefault(unittest.TestCase):
    def test_only_defaults_xml_changes(self):
        self.assertEqual(files_touched(VENDOR_PATCH), [
            "overlay/common/lineage-sdk/packages/LineageSettingsProvider/res/values/defaults.xml"])

    def test_default_is_false_not_true(self):
        added = patch_added(VENDOR_PATCH, files_touched(VENDOR_PATCH)[0])
        joined = "\n".join(added)
        self.assertIn('<bool name="def_stats_collection">false</bool>', joined)
        self.assertNotIn('<bool name="def_stats_collection">true</bool>', joined)

    def test_removed_line_is_the_old_true(self):
        removed = "\n".join(patch_removed(VENDOR_PATCH, files_touched(VENDOR_PATCH)[0]))
        self.assertIn('<bool name="def_stats_collection">true</bool>', removed)


class NoSecondSetupWizardPatch(unittest.TestCase):
    def test_no_setupwizard_patch_shipped(self):
        # The existing setupwizard-awai.patch owns the first-setup default;
        # a second patch on the same hunk would collide whichever order lands.
        self.assertFalse((HERE / "patches" / "setupwizard-stats-default-off.patch").exists())

    def test_apply_sh_has_no_setupwizard_block(self):
        text = (HERE / "apply.sh").read_text()
        self.assertNotIn("setupwizard-stats-default-off.patch", text)
        self.assertNotIn("packages/apps/SetupWizard", text)


class ApplyWiring(unittest.TestCase):
    def test_apply_sh_applies_vendor_patch(self):
        text = (HERE / "apply.sh").read_text()
        self.assertIn("vendor-lineage-stats-default-off.patch", text)


if __name__ == "__main__":
    unittest.main()
