"""AWAI-4090: the GPU PCI function of the Awai PC gets sysfs_gpu, and nothing else changes.

Host-only. This models the kernel's genfscon lookup (longest prefix, default `sysfs`); it is not a policy
build and not a boot. The baseline lines are the ones in the 0712 image's vendor_sepolicy.cil, which come
from device/virt/virtio-common (9d5c9307) and device/virt/virtio_x86_64 (0e8571a0).
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import gzip
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = spec_from_file_location("gpu_sysfs_trial", HERE / "gpu-sysfs-trial.py")
trial = module_from_spec(spec)
spec.loader.exec_module(trial)

PATCH = HERE / "patches" / "virtio-common-awai-pc-gpu-sysfs.patch"

GPU = "/devices/pci0000:00/0000:00:08.1/0000:05:00.0"

# vendor_sepolicy.cil of the 0712 image (genfscon lines that label GPUs) and plat's own /class/gpu.
PLAT = """(type sysfs)
(type sysfs_gpu)
(roletype object_r sysfs_gpu)
(genfscon sysfs "/class/gpu" (u object_r sysfs_gpu ((s0) (s0))))
(allow gpu_sphal_domain sysfs_gpu (file (read open getattr)))
"""
VENDOR = """(genfscon sysfs "/devices/platform/10000.pci/pci0000:00/0000:00:01.0" (u object_r sysfs_gpu ((s0) (s0))))
(genfscon sysfs "/devices/pci0000:00/0000:00:01.6/0000:07:00.0" (u object_r sysfs_gpu ((s0) (s0))))
(genfscon sysfs "/devices/pci0000:00/0000:00:03.0" (u object_r sysfs_gpu ((s0) (s0))))
(genfscon sysfs "/devices/pci0000:00/0000:00:01.0" (u object_r sysfs_gpu ((s0) (s0))))
(genfscon sysfs "/devices/pci0000:00/0000:00:02.0" (u object_r sysfs_gpu ((s0) (s0))))
(genfscon sysfs "/devices/pci0000:00/0000:00:1e.0" (u object_r sysfs_gpu ((s0) (s0))))
(genfscon sysfs "/devices/pci0000:00/0000:00:08.0/wakeup/wakeup" (u object_r sysfs_wakeup ((s0) (s0))))
"""

# What libdrm (drmGetDevices2, flags 0) and Mesa's droid_open_device read for one DRM device.
READ = ["uevent", "vendor", "device", "subsystem_vendor", "subsystem_device", "subsystem", "drm", "drm/card0",
        "drm/renderD128", "config"]
# Same bus, other devices: must keep the generic label.
NOT_GPU = [
    "/devices/pci0000:00/0000:00:08.1/0000:05:00.1/uevent",        # another function of the same slot
    "/devices/pci0000:00/0000:00:08.1/uevent",                      # the bridge above the GPU
    "/devices/pci0000:00/0000:00:02.4/0000:04:00.0/uevent",        # a device behind another port
    "/devices/pci0000:00/0000:00:14.3/uevent",                      # a device on the root bus
    "/devices/platform/rtc_cmos/uevent",
]


def patch_added(path):
    lines, inside = [], False
    for line in PATCH.read_text().splitlines():
        if line.startswith("+++ "):
            inside = line == f"+++ b/{path}"
        elif inside and line.startswith("+"):
            lines.append(line[1:])
    return lines


class SourcePatch(unittest.TestCase):
    def test_only_genfs_contexts_changes(self):
        files = [l[len("+++ b/"):] for l in PATCH.read_text().splitlines() if l.startswith("+++ ")]
        self.assertEqual(files, ["sepolicy/vendor/genfs_contexts"])

    def test_added_lines_are_comments_or_one_sysfs_gpu_genfscon(self):
        for line in patch_added("sepolicy/vendor/genfs_contexts"):
            if line.startswith("#") or not line.strip():
                continue
            fields = line.split()
            self.assertEqual((fields[0], fields[1], fields[3]), ("genfscon", "sysfs", "u:object_r:sysfs_gpu:s0"), line)
            self.assertRegex(fields[2], trial.PCI_PATH, line)

    def test_nothing_is_removed_and_no_rule_is_added(self):
        text = PATCH.read_text()
        removed = [l for l in text.splitlines() if l.startswith("-") and not l.startswith("---")]
        self.assertEqual(removed, [])
        for word in ("allow", "neverallow", "permissive", "dontaudit", "typeattribute", "genfscon sysfs / "):
            self.assertNotIn(word, "\n".join(patch_added("sepolicy/vendor/genfs_contexts")), word)

    def test_patch_paths_are_the_6600h_gpu(self):
        self.assertEqual(trial.patch_paths(PATCH.read_text()), [GPU])

    def test_apply_sh_applies_it(self):
        self.assertIn("virtio-common-awai-pc-gpu-sysfs.patch", (HERE / "apply.sh").read_text())


class Resolution(unittest.TestCase):
    """The counter-example: without the change the GPU's files stay `sysfs`, which apps may never read."""

    def labels(self, vendor):
        return trial.genfscon_entries(PLAT + vendor)

    def test_baseline_leaves_the_6600h_gpu_generic(self):
        entries = self.labels(VENDOR)
        for name in READ:
            self.assertEqual(trial.resolve(entries, f"{GPU}/{name}"), "sysfs", name)

    def test_with_the_change_the_gpu_files_are_sysfs_gpu(self):
        added = f'(genfscon sysfs "{GPU}" (u object_r sysfs_gpu ((s0) (s0))))\n'
        entries = self.labels(VENDOR + added)
        for name in READ:
            self.assertEqual(trial.resolve(entries, f"{GPU}/{name}"), "sysfs_gpu", name)

    def test_other_devices_keep_the_generic_label(self):
        added = f'(genfscon sysfs "{GPU}" (u object_r sysfs_gpu ((s0) (s0))))\n'
        entries = self.labels(VENDOR + added)
        for path in NOT_GPU:
            self.assertEqual(trial.resolve(entries, path), "sysfs", path)

    def test_the_patch_line_is_the_same_label(self):
        entries = self.labels(VENDOR)
        for line in patch_added("sepolicy/vendor/genfs_contexts"):
            if line.startswith("genfscon"):
                _, fs, path, ctx = line.split()
                entries.append((fs, path, ctx.split(":")[2]))
        self.assertEqual(trial.resolve(entries, f"{GPU}/uevent"), "sysfs_gpu")


class PathChecks(unittest.TestCase):
    def test_accepts_gpu_functions(self):
        for path in (GPU, "/sys" + GPU, "/devices/pci0000:00/0000:00:1e.0", "/devices/pci0000:00/0000:00:01.6/0000:07:00.0"):
            self.assertTrue(trial.normalize_path(path).startswith("/devices/pci"))

    def test_rejects_wide_or_malformed_paths(self):
        for path in ("/devices", "/devices/pci0000:00", "/devices/pci0000:00/", "/devices/pci0000:00/0000:00:08.1/",
                     "/devices/pci0000:00/*", "/devices/pci0000:00/0000:00:08.1/..", "/", "/sys", "",
                     '/devices/pci0000:00/0000:00:08.1" (u object_r sysfs ((s0) (s0))))(allow x y',
                     "/devices/platform/vkms"):
            with self.assertRaises(trial.TrialError, msg=path):
                trial.normalize_path(path)


class BuildCil(unittest.TestCase):
    def test_appends_one_genfscon_and_changes_nothing_else(self):
        out = trial.build_cil(PLAT, [GPU], VENDOR)
        self.assertTrue(out.startswith(PLAT))
        added = out[len(PLAT):]
        self.assertEqual([l for l in added.splitlines() if l and not l.startswith(";")],
                         [f'(genfscon sysfs "{GPU}" (u object_r sysfs_gpu ((s0) (s0))))'])

    def test_label_is_visible_to_the_resolver_only_after_the_build(self):
        before = trial.genfscon_entries(PLAT + VENDOR)
        after = trial.genfscon_entries(trial.build_cil(PLAT, [GPU], VENDOR) + VENDOR)
        self.assertEqual(trial.resolve(before, GPU + "/uevent"), "sysfs")
        self.assertEqual(trial.resolve(after, GPU + "/uevent"), "sysfs_gpu")

    def test_idempotent_and_no_duplicate_with_the_vendor_policy(self):
        once = trial.build_cil(PLAT, [GPU], VENDOR)
        self.assertEqual(trial.build_cil(once, [GPU], VENDOR), once)
        dup = "/devices/pci0000:00/0000:00:03.0"
        self.assertEqual(trial.build_cil(PLAT, [dup], VENDOR), PLAT)

    def test_refuses_a_conflicting_label(self):
        other = VENDOR + '(genfscon sysfs "/devices/pci0000:00/0000:00:09.0" (u object_r sysfs_wakeup ((s0) (s0))))\n'
        with self.assertRaises(trial.TrialError):
            trial.build_cil(PLAT, ["/devices/pci0000:00/0000:00:09.0"], other)

    def test_needs_the_platform_type(self):
        with self.assertRaises(trial.TrialError):
            trial.build_cil("(type sysfs)\n", [GPU])

    def test_adds_no_rule_of_any_kind(self):
        added = trial.build_cil(PLAT, [GPU], VENDOR)[len(PLAT):]
        for word in ("allow", "neverallow", "permissive", "typepermissive", "dontaudit", "typeattribute"):
            self.assertNotIn(word, added)


def read_newc(data):
    files, pos = {}, 0
    while True:
        assert data[pos:pos + 6] == b"070701", "bad magic"
        f = [int(data[pos + 6 + 8 * i:pos + 14 + 8 * i], 16) for i in range(13)]
        size, namesize = f[6], f[11]
        name = data[pos + 110:pos + 110 + namesize - 1].decode()
        pos += 110 + namesize
        pos += -pos % 4
        if name == "TRAILER!!!":
            return files
        files[name] = (data[pos:pos + size], f[1])
        pos += size
        pos += -pos % 4


class Cpio(unittest.TestCase):
    def test_roundtrip(self):
        files = read_newc(trial.newc_cpio({"userdebug_plat_sepolicy.cil": b"abc\n"}))
        self.assertEqual(files, {"userdebug_plat_sepolicy.cil": (b"abc\n", 0o100644)})

    def test_bsdtar_reads_it(self):
        tar = shutil.which("bsdtar")
        if not tar:
            self.skipTest("bsdtar is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            Path(tmp, "a.cpio").write_bytes(trial.newc_cpio({"userdebug_plat_sepolicy.cil": b"x" * 7}))
            out = subprocess.run([tar, "-tvf", str(Path(tmp, "a.cpio"))], capture_output=True, text=True, check=True)
            self.assertIn("userdebug_plat_sepolicy.cil", out.stdout)
            self.assertNotIn("TRAILER", out.stdout)


class Cli(unittest.TestCase):
    def run_main(self, tmp, *extra):
        plat = Path(tmp, "plat_sepolicy.cil")
        plat.write_text(PLAT)
        vendor = Path(tmp, "vendor_sepolicy.cil")
        vendor.write_text(VENDOR)
        return trial.main(["--plat-cil", str(plat), "--vendor-cil", str(vendor), "--out-dir", str(Path(tmp, "out")), *extra])

    def test_default_paths_come_from_the_patch(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_main(tmp), 0)
            cil = Path(tmp, "out", trial.CIL_NAME).read_text()
            self.assertIn(f'(genfscon sysfs "{GPU}" (u object_r sysfs_gpu ((s0) (s0))))', cil)
            cpio = Path(tmp, "out", trial.CPIO_NAME).read_bytes()
            self.assertEqual(read_newc(cpio)[trial.CIL_NAME][0], cil.encode())
            self.assertEqual(gzip.decompress(Path(tmp, "out", trial.CPIO_NAME + ".gz").read_bytes()), cpio)

    def test_second_gpu_path_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_main(tmp, "--gpu-path", "/sys/devices/pci0000:00/0000:00:01.1/0000:03:00.0"), 0)
            self.assertIn("0000:03:00.0", Path(tmp, "out", trial.CIL_NAME).read_text())
            self.assertEqual(self.run_main(tmp), 1)

    def test_wide_path_is_refused_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_main(tmp, "--gpu-path", "/sys/devices/pci0000:00"), 1)
            self.assertFalse(Path(tmp, "out").exists())


if __name__ == "__main__":
    unittest.main()
