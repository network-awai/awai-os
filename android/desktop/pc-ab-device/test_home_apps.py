"""AWAI-4094: prebuilt Awai Home/Store input and its fail-closed signing guard.

Host-only. Parses the device-tree patch, checks every new-file hunk header against
the lines it actually adds, then runs the extracted verify-apks.sh with a stub
apksigner. It does not build, fetch, sign a real APK, or boot anything.
"""
from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
PATCH = HERE / "patches" / "virtio-common-awai-apps.patch"
APPS = "device/virt/virtio-common/awai-apps"


def text():
    return PATCH.read_text()


def new_file_payload(patch_text, path):
    """The added lines of a new file in the patch, or None when it is absent."""
    lines, inside = [], False
    for line in patch_text.splitlines():
        if line.startswith("diff --git "):
            inside = False
        elif line.startswith("+++ b/"):
            inside = line == f"+++ b/{path}"
        elif inside and line.startswith("+"):
            lines.append(line[1:])
    return lines or None


def patch_added(path):
    """Every added line of an existing file (the `b/` side), or []."""
    lines, inside = [], False
    for line in text().splitlines():
        if line.startswith("diff --git "):
            inside = False
        elif line.startswith("+++ b/"):
            inside = line == f"+++ b/{path}"
        elif inside and line.startswith("+") and not line.startswith("+++"):
            lines.append(line[1:])
    return lines


class PatchShape(unittest.TestCase):
    def test_creates_only_the_three_apps_files(self):
        touched = [l[6:] for l in text().splitlines() if l.startswith("+++ b/")]
        self.assertEqual(sorted(touched), sorted([
            f"{APPS}/Android.mk", f"{APPS}/product.mk", f"{APPS}/verify-apks.sh",
            "device/virt/virtio-common/device-common.mk"]))

    def test_new_file_hunk_lengths_are_exact(self):
        # A wrong `@@ -0,0 +1,N @@` makes git apply drop the tail (PACKAGES line,
        # mode bit) without an error, so check every new-file hunk here.
        lines = text().splitlines()
        checked = 0
        i = 0
        while i < len(lines):
            m = re.match(r"^@@ -0,0 \+1,(\d+) @@$", lines[i])
            if not m:
                i += 1
                continue
            want, got, j = int(m.group(1)), 0, i + 1
            while j < len(lines) and lines[j].startswith("+"):
                got += 1
                j += 1
            self.assertEqual(got, want, f"hunk at line {i + 1}: declared {want}, added {got}")
            checked += 1
            i = j
        self.assertEqual(checked, 3)

    def test_script_is_created_executable(self):
        blocks = ("diff --git " + b for b in text().split("diff --git ")[1:])
        block = next(b for b in blocks if f"+++ b/{APPS}/verify-apks.sh" in b)
        self.assertIn("new file mode 100755\n", block.split("--- ")[0])

    def test_yotei_is_not_preinstalled(self):
        added = "\n".join(
            l for l in text().splitlines() if l.startswith("+") and not l.startswith("+++"))
        self.assertNotIn("AwaiYotei", added)
        self.assertNotIn("Yotei.apk", added)
        self.assertNotIn("LOCAL_MODULE := AwaiYotei", added)

    def test_device_common_includes_the_product_fragment(self):
        added = patch_added("device/virt/virtio-common/device-common.mk")
        self.assertIn("include $(COMMON_PATH)/awai-apps/product.mk", added)


class MakeInput(unittest.TestCase):
    def test_product_adds_both_modules_under_the_guard(self):
        payload = "\n".join(new_file_payload(text(), f"{APPS}/product.mk"))
        self.assertIn("PRODUCT_PACKAGES +=", payload)
        self.assertRegex(payload, r"PRODUCT_PACKAGES \+= \\\n    AwaiHome \\\n    AwaiStore")
        self.assertIn("AWAI_HOME_EXPECTED_SIGNER_SHA256", payload)
        self.assertIn("AWAI_STORE_EXPECTED_SIGNER_SHA256", payload)
        self.assertIn("$(error", payload)
        self.assertIn("AWAI_ALLOW_UNVERIFIED_APKS", payload)

    def test_prebuilt_modules_keep_their_signature(self):
        payload = "\n".join(new_file_payload(text(), f"{APPS}/Android.mk"))
        self.assertEqual(payload.count("include $(BUILD_PREBUILT)"), 2)
        self.assertEqual(payload.count("LOCAL_CERTIFICATE := PRESIGNED"), 2)
        self.assertEqual(payload.count("LOCAL_DEX_PREOPT := false"), 2)
        self.assertIn("LOCAL_MODULE := AwaiHome", payload)
        self.assertIn("LOCAL_MODULE := AwaiStore", payload)


class GuardBehaviour(unittest.TestCase):
    HOME = "a" * 64
    STORE = "b" * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        script = root / "verify-apks.sh"
        script.write_text("\n".join(new_file_payload(text(), f"{APPS}/verify-apks.sh")) + "\n")
        script.chmod(0o755)
        self.script = script
        self.dir = root
        self.stub = root / "apksigner"
        self.stub.write_text(
            "#!/bin/sh\n"
            'case "$3" in\n'
            f'  *AwaiHome.apk) d={self.HOME} ;;\n'
            f'  *) d={self.STORE} ;;\n'
            "esac\n"
            'echo "Signer #1 certificate SHA-256 digest: $d"\n')
        self.stub.chmod(0o755)

    def tearDown(self):
        self.tmp.cleanup()

    def run_guard(self, *args):
        return subprocess.run(["/bin/sh", str(self.script), *args],
                              capture_output=True, text=True)

    def test_missing_apk_fails(self):
        r = self.run_guard(str(self.dir), str(self.stub), self.HOME, self.STORE)
        self.assertEqual(r.returncode, 1)
        self.assertIn("AWAI_APPS_FAIL: missing", r.stdout)
        self.assertNotIn("AWAI_APPS_OK", r.stdout)

    def test_unset_expected_signer_fails(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        r = self.run_guard(str(self.dir), str(self.stub), "", self.STORE)
        self.assertEqual(r.returncode, 1)
        self.assertIn("AWAI_HOME_EXPECTED_SIGNER_SHA256 is unset", r.stdout)

    def test_missing_apksigner_fails(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        r = self.run_guard(str(self.dir), "", self.HOME, self.STORE)
        self.assertEqual(r.returncode, 1)
        self.assertIn("AWAI_APKSIGNER is unset", r.stdout)

    def test_signer_mismatch_fails(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        r = self.run_guard(str(self.dir), str(self.stub), self.STORE, self.HOME)
        self.assertEqual(r.returncode, 1)
        self.assertIn("!= expected", r.stdout)

    def test_matching_signers_pass(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        r = self.run_guard(str(self.dir), str(self.stub), self.HOME, self.STORE)
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertTrue(r.stdout.startswith("AWAI_APPS_OK"))

    def test_unsigned_apk_fails(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        self.stub.write_text("#!/bin/sh\nexit 1\n")
        r = self.run_guard(str(self.dir), str(self.stub), self.HOME, self.STORE)
        self.assertEqual(r.returncode, 1)
        self.assertIn("no signer digest", r.stdout)

    def test_development_flag_skips_the_comparison(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        r = self.run_guard(str(self.dir), "", "", "", "--allow-unverified")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("unverified", r.stdout)


class ApplyWiring(unittest.TestCase):
    def test_apply_sh_applies_the_patch(self):
        apply = (HERE / "apply.sh").read_text()
        self.assertIn("virtio-common-awai-apps.patch", apply)


if __name__ == "__main__":
    unittest.main()
