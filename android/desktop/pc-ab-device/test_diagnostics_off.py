"""AWAI-4093: shipping default for LineageStats diagnostics is off.

Host-only. Parses the two Awai patches and asserts they flip exactly the
first-setup/provider defaults to off, touch nothing else, and are wired into
apply.sh. It does not build, boot, or fetch upstream code.
"""
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
VENDOR_PATCH = HERE / "patches" / "vendor-lineage-stats-default-off.patch"
SETUPWIZARD_PATCH = HERE / "patches" / "setupwizard-stats-default-off.patch"


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


class SetupWizardDefault(unittest.TestCase):
    def test_only_setupwizard_activity_changes(self):
        self.assertEqual(files_touched(SETUPWIZARD_PATCH), [
            "app/src/main/java/org/lineageos/setupwizard/settings/LineageSettingsActivity.kt"])

    def test_absent_key_defaults_unchecked(self):
        added = "\n".join(patch_added(SETUPWIZARD_PATCH, files_touched(SETUPWIZARD_PATCH)[0]))
        # && instead of the old !containsKey || form: no bundle key -> unchecked
        self.assertIn("myPageBundle.containsKey(KEY_SEND_METRICS) && myPageBundle.getBoolean(KEY_SEND_METRICS)", added)

    def test_removed_line_is_the_old_default_on(self):
        removed = "\n".join(patch_removed(SETUPWIZARD_PATCH, files_touched(SETUPWIZARD_PATCH)[0]))
        self.assertIn("!myPageBundle.containsKey(KEY_SEND_METRICS) || myPageBundle.getBoolean(KEY_SEND_METRICS)", removed)

    def test_no_string_change(self):
        # AWAI-3563 owns the wording; this patch only flips the checked default.
        self.assertNotIn("@string", SETUPWIZARD_PATCH.read_text())


class ApplyWiring(unittest.TestCase):
    def test_apply_sh_applies_both(self):
        text = (HERE / "apply.sh").read_text()
        self.assertIn("vendor-lineage-stats-default-off.patch", text)
        self.assertIn("setupwizard-stats-default-off.patch", text)
        # SetupWizard block uses the reverse-check gate (one() cannot grep *.kt).
        self.assertIn("git -C \"$setupwizard\" apply --reverse --check", text)


if __name__ == "__main__":
    unittest.main()
