"""AWAI-4094: prebuilt Awai Home/Store input, its fail-closed signing guard, and the
HOME priority inputs (Home stays 0; Launcher3 is lowered to -1).

Host-only. Parses the device-tree patches, checks every new-file hunk header against the
lines it actually adds, runs the extracted verify-apks.sh with a stub apksigner, includes
the extracted product.mk under GNU make, and reads the Home manifest that android/build.py
generates. It does not build, fetch, sign a real APK, or boot anything.
"""
from pathlib import Path
import importlib.util
import re
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
PATCH = HERE / "patches" / "virtio-common-awai-apps.patch"
LAUNCHER3 = HERE / "patches" / "launcher3-home-priority-fallback.patch"
APPS = "awai-apps"  # project-relative: apply.sh runs git inside device/virt/virtio-common
BUILD_PY = HERE.parents[1] / "build.py"  # android/build.py
HOME_PKG = "network.awai.home"


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


def home_manifest():
    """The HOME APK manifest from android/build.py (same generator the build uses)."""
    spec = importlib.util.spec_from_file_location("awai_android_build", BUILD_PY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.manifest(HOME_PKG, f"{HOME_PKG}.HomeActivity", 1, "home")


class PatchShape(unittest.TestCase):
    def test_creates_only_the_apps_files(self):
        touched = [l[6:] for l in text().splitlines() if l.startswith("+++ b/")]
        self.assertEqual(sorted(touched), sorted([
            f"{APPS}/Android.mk", f"{APPS}/product.mk", f"{APPS}/verify-apks.sh",
            "device-common.mk"]))

    def test_paths_are_project_relative(self):
        # apply.sh runs `git -C device/virt/virtio-common apply`; a `device/virt/...`
        # prefix made the patch miss every file and the include never land.
        touched = [l[6:] for l in text().splitlines() if l.startswith("+++ b/")]
        self.assertFalse([p for p in touched if p.startswith("device/")], touched)

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

    def test_home_and_store_are_not_privileged(self):
        # A privileged module would keep a >0 priority (and could outrank the setup
        # wizard); AWAI-4094 deliberately keeps both as normal product apps.
        added = "\n".join(
            l for l in text().splitlines() if l.startswith("+") and not l.startswith("+++"))
        self.assertNotIn("LOCAL_PRIVILEGED_MODULE", added)
        self.assertNotIn("priv-app", added)

    def test_device_common_includes_the_product_fragment(self):
        self.assertIn("include $(COMMON_PATH)/awai-apps/product.mk",
                      patch_added("device-common.mk"))


class MakeInput(unittest.TestCase):
    def test_product_adds_both_modules_under_the_guard(self):
        payload = "\n".join(new_file_payload(text(), f"{APPS}/product.mk"))
        self.assertIn("PRODUCT_PACKAGES +=", payload)
        self.assertRegex(payload, r"PRODUCT_PACKAGES \+= \\\n        AwaiHome \\\n        AwaiStore")
        self.assertIn("AWAI_HOME_EXPECTED_SIGNER_SHA256", payload)
        self.assertIn("AWAI_STORE_EXPECTED_SIGNER_SHA256", payload)
        self.assertIn("$(error", payload)
        self.assertIn("AWAI_ALLOW_UNVERIFIED_APKS", payload)

    def test_without_apps_escape_is_documented_and_release_gated(self):
        payload = "\n".join(new_file_payload(text(), f"{APPS}/product.mk"))
        self.assertIn("AWAI_WITHOUT_APPS", payload)
        self.assertIn("AWAI_WITHOUT_APPS: Home/Store are NOT preinstalled", payload)
        self.assertIn("$(filter user,$(TARGET_BUILD_VARIANT))", payload)
        self.assertIn("$(filter RELEASE,$(LINEAGE_BUILDTYPE))", payload)

    def test_prebuilt_modules_keep_their_signature(self):
        payload = "\n".join(new_file_payload(text(), f"{APPS}/Android.mk"))
        self.assertEqual(payload.count("include $(BUILD_PREBUILT)"), 2)
        self.assertEqual(payload.count("LOCAL_CERTIFICATE := PRESIGNED"), 2)
        self.assertEqual(payload.count("LOCAL_DEX_PREOPT := false"), 2)
        self.assertIn("LOCAL_MODULE := AwaiHome", payload)
        self.assertIn("LOCAL_MODULE := AwaiStore", payload)


class HomeDefault(unittest.TestCase):
    def test_home_declares_no_priority_because_it_is_not_privileged(self):
        # The 2026-11-25 draft declared android:priority="999"; ComponentResolver
        # .adjustPriority caps a non-privileged filter's >0 back to 0 (pinned
        # frameworks/base 0a607d06, ComponentResolver.java:497-515), which tied
        # Launcher3 and left a fresh /data without a default home.
        android_mk = "\n".join(new_file_payload(text(), f"{APPS}/Android.mk"))
        privileged = "LOCAL_PRIVILEGED_MODULE" in android_mk
        manifest = home_manifest()
        filters = re.findall(r"<intent-filter([^>]*)>(.*?)</intent-filter>", manifest, re.S)
        home = [attrs for attrs, body in filters if "android.intent.category.HOME" in body]
        self.assertEqual(len(home), 1, "expected exactly one HOME filter")
        m = re.search(r'android:priority="(-?\d+)"', home[0])
        priority = int(m.group(1)) if m else 0
        if not privileged:
            self.assertLessEqual(
                priority, 0,
                "non-privileged Home priority >0 is capped to 0 by "
                "ComponentResolver.adjustPriority and only ties Launcher3")
        self.assertGreater(priority, -1, "Home must outrank Launcher3's -1")

    def test_launcher3_home_filter_is_minus_one(self):
        patch = LAUNCHER3.read_text()
        touched = sorted(l[6:] for l in patch.splitlines() if l.startswith("+++ b/"))
        self.assertEqual(touched, ["AndroidManifest.xml", "quickstep/AndroidManifest-launcher.xml"])
        # quickstep/AndroidManifest-launcher.xml is Launcher3QuickStep's additional
        # manifest (packages/apps/Launcher3/Android.bp, `Launcher3QuickStep`), i.e. the
        # module handheld_system_ext.mk builds; AndroidManifest.xml is the Launcher3
        # module's own copy.
        for path in touched:
            block = patch.split(f"+++ b/{path}")[1].split("diff --git ")[0]
            lines = [l[1:] for l in block.splitlines()[1:] if l[:1] in "+ -"]
            idx = next(i for i, l in enumerate(lines) if 'android:priority="-1"' in l)
            self.assertIn("android.intent.category.HOME", "\n".join(lines[idx:idx + 8]), path)
            self.assertNotIn("LOCAL_PRIVILEGED_MODULE", block)
            self.assertNotIn("privapp", block)


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
        self.assertIn("apksigner verification failed", r.stdout)

    def test_development_flag_skips_the_comparison(self):
        (self.dir / "AwaiHome.apk").write_text("x")
        (self.dir / "AwaiStore.apk").write_text("x")
        r = self.run_guard(str(self.dir), "", "", "", "--allow-unverified")
        self.assertEqual(r.returncode, 0, r.stdout)
        self.assertIn("unverified", r.stdout)


@unittest.skipUnless(shutil.which("make"), "GNU make is not installed")
class MakeBehaviour(unittest.TestCase):
    """product.mk itself, included by make (the guard is a product-config include)."""

    HOME = "a" * 64
    STORE = "b" * 64

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        common = root / "device" / "virt" / "virtio-common"
        apps = common / "awai-apps"
        apps.mkdir(parents=True)
        (apps / "product.mk").write_text(
            "\n".join(new_file_payload(text(), f"{APPS}/product.mk")) + "\n")
        script = apps / "verify-apks.sh"
        script.write_text("\n".join(new_file_payload(text(), f"{APPS}/verify-apks.sh")) + "\n")
        script.chmod(0o755)
        self.stub = root / "apksigner"
        self.stub.write_text(
            "#!/bin/sh\n"
            'case "$3" in\n'
            f'  *AwaiHome.apk) d={self.HOME} ;;\n'
            f'  *) d={self.STORE} ;;\n'
            "esac\n"
            'echo "Signer #1 certificate SHA-256 digest: $d"\n')
        self.stub.chmod(0o755)
        self.apps = apps
        self.harness = root / "harness.mk"
        self.harness.write_text(
            f"COMMON_PATH := {common}\n"
            "include $(COMMON_PATH)/awai-apps/product.mk\n"
            "all:\n"
            "\t@echo PRODUCT_PACKAGES=[$(PRODUCT_PACKAGES)]\n")

    def tearDown(self):
        self.tmp.cleanup()

    def add_apks(self):
        (self.apps / "AwaiHome.apk").write_text("x")
        (self.apps / "AwaiStore.apk").write_text("x")

    def run_make(self, *args):
        r = subprocess.run(
            ["make", "-f", str(self.harness),
             f"AWAI_APKSIGNER={self.stub}", *args],
            capture_output=True, text=True)
        return r, r.stdout + r.stderr

    def test_missing_apk_stops_the_build(self):
        r, out = self.run_make(f"AWAI_HOME_EXPECTED_SIGNER_SHA256={self.HOME}",
                               f"AWAI_STORE_EXPECTED_SIGNER_SHA256={self.STORE}")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("AWAI_APPS_FAIL: missing", out)

    def test_without_apps_installs_nothing_on_a_development_build(self):
        r, out = self.run_make("AWAI_WITHOUT_APPS=1", "TARGET_BUILD_VARIANT=userdebug")
        self.assertEqual(r.returncode, 0, out)
        self.assertIn("AWAI_WITHOUT_APPS: Home/Store are NOT preinstalled", out)
        self.assertIn("PRODUCT_PACKAGES=[]", out)
        self.assertNotIn("AWAI_APPS_FAIL", out)

    def test_without_apps_is_refused_on_a_user_build(self):
        r, out = self.run_make("AWAI_WITHOUT_APPS=1", "TARGET_BUILD_VARIANT=user")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("AWAI_WITHOUT_APPS=1 is refused on release builds", out)
        self.assertNotIn("PRODUCT_PACKAGES=", out)

    def test_without_apps_is_refused_on_a_lineage_release(self):
        r, out = self.run_make("AWAI_WITHOUT_APPS=1", "TARGET_BUILD_VARIANT=userdebug",
                               "LINEAGE_BUILDTYPE=RELEASE")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("AWAI_WITHOUT_APPS=1 is refused on release builds", out)

    def test_without_apps_set_to_zero_keeps_the_guard(self):
        r, out = self.run_make("AWAI_WITHOUT_APPS=0", "TARGET_BUILD_VARIANT=userdebug")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("AWAI_APPS_FAIL: missing", out)

    def test_unverified_apks_are_allowed_on_a_development_build(self):
        self.add_apks()
        r, out = self.run_make("AWAI_ALLOW_UNVERIFIED_APKS=1", "TARGET_BUILD_VARIANT=userdebug",
                               "LINEAGE_BUILDTYPE=UNOFFICIAL")
        self.assertEqual(r.returncode, 0, out)
        self.assertIn("AWAI_ALLOW_UNVERIFIED_APKS=1: unverified APKs", out)
        self.assertIn("PRODUCT_PACKAGES=[AwaiHome AwaiStore]", out)

    def test_unverified_apks_are_refused_on_release_builds(self):
        self.add_apks()
        for variant, build_type in (("user", "UNOFFICIAL"), ("userdebug", "RELEASE")):
            with self.subTest(variant=variant, build_type=build_type):
                r, out = self.run_make("AWAI_ALLOW_UNVERIFIED_APKS=1",
                                       f"TARGET_BUILD_VARIANT={variant}",
                                       f"LINEAGE_BUILDTYPE={build_type}")
                self.assertNotEqual(r.returncode, 0, out)
                self.assertIn("AWAI_ALLOW_UNVERIFIED_APKS=1 is refused on release builds", out)
                self.assertNotIn("PRODUCT_PACKAGES=", out)

    def test_release_without_escape_requires_signer_pin(self):
        self.add_apks()
        r, out = self.run_make("TARGET_BUILD_VARIANT=userdebug", "LINEAGE_BUILDTYPE=RELEASE",
                               "AWAI_HOME_EXPECTED_SIGNER_SHA256=")
        self.assertNotEqual(r.returncode, 0, out)
        self.assertIn("AWAI_HOME_EXPECTED_SIGNER_SHA256 is unset", out)

    def test_release_rejects_failed_verification_even_with_matching_digest(self):
        self.add_apks()
        self.stub.write_text(self.stub.read_text() + "exit 1\n")
        r, out = self.run_make(f"AWAI_HOME_EXPECTED_SIGNER_SHA256={self.HOME}",
                               f"AWAI_STORE_EXPECTED_SIGNER_SHA256={self.STORE}",
                               "TARGET_BUILD_VARIANT=userdebug", "LINEAGE_BUILDTYPE=RELEASE")
        self.assertNotEqual(r.returncode, 0, out)
        self.assertIn("AWAI_APPS_FAIL: apksigner verification failed", out)
        self.assertNotIn("PRODUCT_PACKAGES=", out)

    def test_verified_apks_are_added(self):
        self.add_apks()
        r, out = self.run_make(f"AWAI_HOME_EXPECTED_SIGNER_SHA256={self.HOME}",
                               f"AWAI_STORE_EXPECTED_SIGNER_SHA256={self.STORE}",
                               "TARGET_BUILD_VARIANT=userdebug")
        self.assertEqual(r.returncode, 0, out)
        self.assertIn("PRODUCT_PACKAGES=[AwaiHome AwaiStore]", out)


class ApplyWiring(unittest.TestCase):
    def test_apply_sh_applies_both_patches(self):
        apply = (HERE / "apply.sh").read_text()
        self.assertIn("virtio-common-awai-apps.patch", apply)
        self.assertIn("launcher3-home-priority-fallback.patch", apply)
        self.assertIn("packages/apps/Launcher3", apply)


if __name__ == "__main__":
    unittest.main()
