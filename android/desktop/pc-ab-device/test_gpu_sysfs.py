"""AWAI-4090: the GPU PCI function of the Awai PC gets sysfs_gpu, and nothing else changes.

Host-only. This models the kernel's genfscon lookup (longest prefix, default `sysfs`); it is not a policy
build and not a boot. The baseline lines are the ones in the 0712 image's vendor_sepolicy.cil, which come
from device/virt/virtio-common (9d5c9307) and device/virt/virtio_x86_64 (0e8571a0).
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import contextlib
import gzip
import io
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

OLD_ONE_LINE = f'(genfscon sysfs "{GPU}" (u object_r sysfs_gpu ((s0) (s0))))\n'  # the first version of this fix

# What libdrm (drmGetDevices2, flags 0), Mesa's droid_open_device and loader_get_device_name_for_fd read.
READ = ["uevent", "vendor", "device", "subsystem_vendor", "subsystem_device", "revision",
        "drm", "drm/card0/uevent", "drm/renderD128/uevent"]
# Same function, never needed by a loader: they must stay `sysfs` (edid is the monitor's make and serial).
STAY_GENERIC = [
    "drm/card0/card0-DP-1/edid", "drm/card0/card0-DP-1/status", "drm/card0/card0-eDP-1/edid",
    "drm/card0/device", "drm/card0/dev", "drm/card0/gt", "drm/renderD128/dev", "drm/renderD128/device",
    "gpu_busy_percent", "mem_info_vram_used", "mem_info_vram_total", "mem_info_gtt_used", "vbios_version",
    "product_name", "serial_number", "unique_id", "config", "class", "resource", "resource0", "rom", "irq",
    "boot_vga", "current_link_speed", "max_link_width", "d3cold_allowed", "driver_override", "numa_node",
    "local_cpulist", "modalias", "enable", "remove", "rescan", "power/control", "hwmon/hwmon3/temp1_input",
    "pp_dpm_sclk", "power_dpm_force_performance_level", "pp_od_clk_voltage", "ras/features", "fw_version/vce_fw_version",
    "drm/controlD64", "drm/card0/card0-DP-1", "drm/card1/uevent", "drm/renderD129/uevent",
]
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

    def test_added_lines_are_comments_or_genfscon_for_the_gpu_function(self):
        for line in patch_added("sepolicy/vendor/genfs_contexts"):
            if line.startswith("#") or not line.strip():
                continue
            fields = line.split()
            self.assertEqual((fields[0], fields[1]), ("genfscon", "sysfs"), line)
            self.assertIn(fields[3], ("u:object_r:sysfs_gpu:s0", "u:object_r:sysfs:s0"), line)
            self.assertTrue(fields[2].startswith(GPU + "/"), f"not below the GPU function: {line}")

    def test_no_line_labels_the_whole_function(self):
        for path, label in trial.patch_entries(PATCH.read_text()):
            self.assertNotIn(path, (GPU, GPU + "/"), "the whole function must not be labeled")

    def test_nothing_is_removed_and_no_rule_is_added(self):
        text = PATCH.read_text()
        removed = [l for l in text.splitlines() if l.startswith("-") and not l.startswith("---")]
        self.assertEqual(removed, [])
        for word in ("allow", "neverallow", "permissive", "dontaudit", "typeattribute", "genfscon sysfs / "):
            self.assertNotIn(word, "\n".join(patch_added("sepolicy/vendor/genfs_contexts")), word)

    def test_patch_is_the_6600h_gpu(self):
        self.assertEqual(trial.patch_gpus(PATCH.read_text()), [GPU])

    def test_trial_script_generates_exactly_the_patch_lines(self):
        self.assertEqual(sorted(trial.entries_for(GPU)), sorted(trial.patch_entries(PATCH.read_text())))

    def test_apply_sh_applies_it(self):
        self.assertIn("virtio-common-awai-pc-gpu-sysfs.patch", (HERE / "apply.sh").read_text())


def patched_entries():
    """The lookup table of the image with the patch applied: baseline vendor lines + the patch's lines."""
    return trial.genfscon_entries(PLAT + VENDOR) + [("sysfs", p, t) for p, t in trial.patch_entries(PATCH.read_text())]


class Resolution(unittest.TestCase):
    """Without the change the GPU's files stay `sysfs`, which apps may never read. With the old one-line
    change the whole function became readable (edid, gpu_busy_percent, vbios_version, config: 648 files)."""

    def test_baseline_leaves_the_6600h_gpu_generic(self):
        entries = trial.genfscon_entries(PLAT + VENDOR)
        for name in READ:
            self.assertEqual(trial.resolve(entries, f"{GPU}/{name}"), "sysfs", name)

    def test_with_the_change_what_the_loaders_read_is_sysfs_gpu(self):
        for name in READ:
            self.assertEqual(trial.resolve(patched_entries(), f"{GPU}/{name}"), "sysfs_gpu", name)

    def test_edid_gpu_busy_percent_and_the_rest_stay_generic(self):
        for name in STAY_GENERIC:
            self.assertEqual(trial.resolve(patched_entries(), f"{GPU}/{name}"), "sysfs", name)

    def test_the_old_one_line_version_exposes_them(self):
        """Counter-example: this is what the first version did; the test above fails on it."""
        old = trial.genfscon_entries(PLAT + VENDOR + OLD_ONE_LINE)
        exposed = [n for n in STAY_GENERIC if trial.resolve(old, f"{GPU}/{n}") == "sysfs_gpu"]
        self.assertIn("drm/card0/card0-DP-1/edid", exposed)
        self.assertIn("gpu_busy_percent", exposed)
        self.assertIn("config", exposed)

    def test_other_devices_keep_the_generic_label(self):
        for path in NOT_GPU:
            self.assertEqual(trial.resolve(patched_entries(), path), "sysfs", path)

    def test_prefix_collisions_are_only_the_names_that_exist(self):
        """genfscon is a string prefix match: `device` also matches `device_x`. Names that start like an
        allowed attribute exist only as listed here; none of them is in a PCI function directory of amdgpu."""
        collide = [n for n in STAY_GENERIC if any(n.startswith(a) for a in trial.ATTRIBUTES)]
        self.assertEqual(collide, [])
        for name in ("subsystem", "vendor_x", "device_x", "revision_x", "uevent_x"):
            # documented residual: a future attribute with such a name would be readable
            self.assertEqual(trial.resolve(patched_entries(), f"{GPU}/{name}"),
                             "sysfs_gpu" if name != "subsystem" else "sysfs", name)

    def test_drm_children_need_their_own_allow(self):
        self.assertEqual(trial.resolve(patched_entries(), f"{GPU}/drm/card0"), "sysfs")
        self.assertEqual(trial.resolve(patched_entries(), f"{GPU}/drm/card0/uevent"), "sysfs_gpu")


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


ENTRIES = trial.entries_for(GPU)


class BuildCil(unittest.TestCase):
    def test_appends_only_genfscon_lines_and_changes_nothing_else(self):
        out = trial.build_cil(PLAT, ENTRIES, VENDOR)
        self.assertTrue(out.startswith(PLAT))
        added = [l for l in out[len(PLAT):].splitlines() if l and not l.startswith(";")]
        self.assertEqual(len(added), len(ENTRIES))
        for line in added:
            self.assertTrue(line.startswith("(genfscon sysfs "), line)

    def test_cil_gives_the_same_labels_as_the_patch(self):
        out = trial.build_cil(PLAT, ENTRIES, VENDOR)
        cil = trial.genfscon_entries(out + VENDOR)
        for name in READ + STAY_GENERIC:
            self.assertEqual(trial.resolve(cil, f"{GPU}/{name}"), trial.resolve(patched_entries(), f"{GPU}/{name}"), name)

    def test_idempotent_and_no_duplicate_with_the_vendor_policy(self):
        once = trial.build_cil(PLAT, ENTRIES, VENDOR)
        self.assertEqual(trial.build_cil(once, ENTRIES, VENDOR), once)
        dup = [("/devices/pci0000:00/0000:00:03.0", "sysfs_gpu")]
        self.assertEqual(trial.build_cil(PLAT, dup, VENDOR), PLAT)

    def test_refuses_a_conflicting_label(self):
        other = VENDOR + '(genfscon sysfs "/devices/pci0000:00/0000:00:09.0" (u object_r sysfs_wakeup ((s0) (s0))))\n'
        with self.assertRaises(trial.TrialError):
            trial.build_cil(PLAT, [("/devices/pci0000:00/0000:00:09.0", "sysfs_gpu")], other)

    def test_needs_the_platform_types(self):
        with self.assertRaises(trial.TrialError):
            trial.build_cil("(type sysfs)\n", ENTRIES)

    def test_adds_no_rule_of_any_kind(self):
        added = trial.build_cil(PLAT, ENTRIES, VENDOR)[len(PLAT):]
        for word in ("allow", "neverallow", "permissive", "typepermissive", "dontaudit", "typeattribute"):
            self.assertNotIn(word, added)

    def test_drm_node_names_are_checked(self):
        with self.assertRaises(trial.TrialError):
            trial.entries_for(GPU, ("card0/../edid",))


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
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return trial.main(["--plat-cil", str(plat), "--vendor-cil", str(vendor), "--out-dir", str(Path(tmp, "out")), *extra])

    def test_default_paths_come_from_the_patch(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_main(tmp), 0)
            cil = Path(tmp, "out", trial.CIL_NAME).read_text()
            self.assertIn(f'(genfscon sysfs "{GPU}/uevent" (u object_r sysfs_gpu ((s0) (s0))))', cil)
            self.assertIn(f'(genfscon sysfs "{GPU}/drm/" (u object_r sysfs ((s0) (s0))))', cil)
            self.assertNotIn(f'"{GPU}"', cil)
            cpio = Path(tmp, "out", trial.CPIO_NAME).read_bytes()
            self.assertEqual(read_newc(cpio)[trial.CIL_NAME][0], cil.encode())
            self.assertEqual(gzip.decompress(Path(tmp, "out", trial.CPIO_NAME + ".gz").read_bytes()), cpio)

    def test_second_gpu_path_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_main(tmp, "--gpu-path", "/sys/devices/pci0000:00/0000:00:01.1/0000:03:00.0"), 0)
            self.assertIn("0000:03:00.0/uevent", Path(tmp, "out", trial.CIL_NAME).read_text())
            self.assertEqual(self.run_main(tmp), 1)

    def test_wide_path_is_refused_and_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(self.run_main(tmp, "--gpu-path", "/sys/devices/pci0000:00"), 1)
            self.assertFalse(Path(tmp, "out").exists())


if __name__ == "__main__":
    unittest.main()
