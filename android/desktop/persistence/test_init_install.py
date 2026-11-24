import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest


IMAGE = b"A" * 512
DIGEST = hashlib.sha256(IMAGE).hexdigest()
ORIGINAL_DISK = b"X" * 1024
MOCK_BUSYBOX = r'''
import hashlib
import os
from pathlib import Path
import sys

command, *args = sys.argv[1:]
root = Path(__file__).parent.parent
with (root / "calls").open("a") as calls:
    calls.write(" ".join([command, *args]) + "\n")
fault = os.environ["INSTALL_TEST_FAULT"]
if command in {"mount", "insmod", "sleep", "ip", "httpd", "sync", "sh"}:
    sys.exit(0)
if command == "blkid":
    is_root = args[0].endswith("p2")
    name = "root" if is_root else "state"
    uuid = ("9476f840-c703-4d5b-af77-41ea3c7986fb" if is_root
            else "68bf9494-e41b-4ab6-ae28-3ade4cdce29d")
    print(f'{args[0]}: PARTUUID="{uuid}" UUID="{uuid if fault != name else "bad"}"')
    sys.exit(int(fault == "blkid-status"))
if command == "wget":
    data = b"B" * 512 if fault == "image-digest" else b"A" * 512
    Path(args[2]).write_bytes(data * (2 if fault == "overlong" else 1))
    if fault == "disk-replaced":
        (root / "sys/block/nvme1n1/diskseq").write_text("3\n")
    sys.exit(int(fault == "wget-status"))
if command == "stat":
    print(Path(args[2]).stat().st_size)
    sys.exit(0)
if command == "sha256sum":
    data = Path(args[0]).read_bytes() if args else sys.stdin.buffer.read()
    print(hashlib.sha256(data).hexdigest(), "", args[0] if args else "-")
    sys.exit(int(not args and fault == "hash-status"))
if command == "dd":
    options = dict(arg.split("=", 1) for arg in args)
    if options.get("if") == str(root / "dev/zero"):
        sys.stdout.buffer.write(bytes(int(options["bs"]) * int(options["count"])))
        sys.exit(0)
    assert options["bs"] == "512" and options["count"] == "1"
    data = Path(options["if"]).read_bytes()[:512] if "if" in options else sys.stdin.buffer.read(512)
    if "of" in options:
        target = root / "dev/nvme0n1"
        assert Path(options["of"]) == target
        with target.open("r+b") as disk:
            disk.write(data)
    elif "conv" in options:
        assert os.path.samestat(os.fstat(1), (root / "dev/nvme1n1").stat())
        sys.stdout.buffer.write(data)
    else:
        if "if" not in options:
            assert os.path.samestat(os.fstat(0), (root / "dev/nvme1n1").stat())
        sys.stdout.buffer.write(b"B" * 512 if fault == "readback-digest" else data)
        sys.exit(int(fault == "readback-status"))
    sys.exit(0)
assert command in {"awk", "cat", "cmp", "mkdir", "mkfifo", "tr"}, command
os.execvp(command, [command, *args])
'''


class InitInstallTest(unittest.TestCase):
    def run_installer(self, fault="", *, before_network=False, writes=0, second=False,
                      macs="default", nic_mac=None, cmdline_macs=False):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            target = base / "dev/nvme0n1"
            for path in ("awai", "dev", "proc", "sys/block/nvme0n1", "sys/class/net/eth0",
                         "sys/module/firmware_class/parameters"):
                (base / path).mkdir(parents=True)
            busybox = base / "awai/busybox"
            busybox.write_text(f"#!{sys.executable}\n" + MOCK_BUSYBOX)
            busybox.chmod(0o700)
            target.write_bytes(ORIGINAL_DISK)
            sectors = "600000000" if fault == "capacity" else "500118192"
            mode = "second" if second else "shared" if fault == "shared" else "erase"
            target_sectors = "1" if fault == "undersized" else "2"
            command_sectors = target_sectors if second else sectors
            profile = "2" if fault == "profile" else "1"
            (base / "proc/cmdline").write_text(
                f"awai.install.profile={profile} awai.install.mode={mode} awai.install.sectors={command_sectors}\n"
            )
            # NIC allowlist: the installer reads AWAI_INSTALLER_MACS (or the
            # awai.install.macs= kernel arg) and fails closed without it.
            macs_path = base / "awai/installer-macs.txt"
            macs_contents = {
                "default": "0c:47:a9:60:9d:34\n",
                "empty": "# comments only\n\n",
                "malformed": "not-a-mac\n",
                "normalized": "0C-47-A9-60-9D-34\n",
            }.get(macs)
            if macs_contents is not None:
                macs_path.write_text(macs_contents)
            if cmdline_macs:
                (base / "proc/cmdline").write_text(
                    f"awai.install.profile={profile} awai.install.mode={mode} "
                    f"awai.install.sectors={command_sectors} awai.install.macs={macs_path}\n"
                )
            available = 262144 if fault == "low-memory" else 1048576
            (base / "proc/meminfo").write_text(f"MemAvailable: {available} kB\n")
            (base / "sys/block/nvme0n1/size").write_text(sectors)
            (base / "sys/class/net/eth0/address").write_text(
                nic_mac if nic_mac is not None
                else ("00:00:00:00:00:00" if fault == "mac" else "0c:47:a9:60:9d:34")
            )
            if fault == "local-disk":
                (base / "sys/block/sda").mkdir()
            if fault == "namespace":
                (base / "sys/block/nvme1n1").mkdir()
            pins = f"image_url=http://10.77.0.1:18091/install.img\nimage_sha={DIGEST}\n"
            image_bytes = {"unaligned": 513, "undersized": 1024}.get(fault, 512)
            pins += f"img_bytes={image_bytes}\n"
            if second:
                first_sys = base / "sys/block/nvme0n1"
                second_sys = base / "sys/block/nvme1n1"
                second_target = base / "dev/nvme1n1"
                for disk, serial in ((first_sys, "old-serial"), (second_sys, "new-serial")):
                    (disk / "device").mkdir(parents=True)
                    if disk != second_sys or fault != "serial-absent":
                        (disk / "device/serial").write_text(serial + "   \n")
                if fault != "existing-missing":
                    for number in (2, 3):
                        part = first_sys / f"nvme0n1p{number}"
                        part.mkdir()
                        (part / "partition").write_text(str(number))
                if fault == "serial-duplicate":
                    duplicate = base / "sys/block/nvme2n1/device"
                    duplicate.mkdir(parents=True)
                    (duplicate / "serial").write_text("new-serial\n")
                (second_sys / "queue").mkdir()
                (second_sys / "queue/logical_block_size").write_text("4096" if fault == "4kn" else "512")
                (second_sys / "size").write_text(target_sectors)
                (second_sys / "diskseq").write_text("2\n")
                original_second = bytes(int(target_sectors) * 512 - 1) + (b"X" if fault == "nonblank" else b"\0")
                second_target.write_bytes(original_second)
                serial_pin = {
                    "target-is-existing": "old-serial",
                    "placeholder-serial": "<second-disk-device-serial>",
                }.get(fault, "new-serial")
                capacity_pin = "<second-disk-size-in-512-byte-sectors>" if fault == "placeholder-capacity" else target_sectors
                pins += f"install_mode=second\ntarget_serial={serial_pin}\ntarget_sectors={capacity_pin}\n"
            if fault == "malformed-pins":
                pins += f"image_sha={DIGEST}\n"
            if fault != "missing-pins":
                (base / "awai/install.pins").write_text(pins)
            script = Path(__file__).with_name("init-install.sh").read_text()
            script = script.replace("exec </dev/console >/dev/console 2>&1\n", "", 1)
            script = re.sub(r"/(?:awai|sys|proc|dev)(?=[/ -])", lambda m: str(base) + m[0], script)
            init = base / "init.sh"
            init.write_text(script)
            env = {**os.environ, "INSTALL_TEST_FAULT": fault}
            if cmdline_macs:
                # Deliberately point the env var at a missing file: the
                # kernel arg must win over the environment.
                env["AWAI_INSTALLER_MACS"] = str(base / "awai/no-such-macs.txt")
            else:
                # macs="missing" points at a path that does not exist; the
                # other modes point at the allowlist file written above.
                env["AWAI_INSTALLER_MACS"] = (
                    str(base / "awai/no-such-macs.txt") if macs == "missing" else str(macs_path)
                )
            result = subprocess.run(
                ["/bin/sh", str(init)], input=("wrong" if fault == "confirm" else DIGEST) + "\n",
                text=True, capture_output=True, timeout=10, check=True, env=env,
            )
            calls = (base / "calls").read_text().splitlines()
            self.assertEqual(sum(call.startswith("dd ") and " conv=notrunc" in call for call in calls), writes)
            self.assertEqual(target.read_bytes(), IMAGE + ORIGINAL_DISK[512:] if writes and not second else ORIGINAL_DISK)
            if second:
                expected_second = IMAGE + original_second[512:] if writes else original_second
                self.assertEqual(second_target.read_bytes(), expected_second)
            if before_network:
                self.assertFalse(any(call.startswith(("ip ", "httpd ", "wget ", "sh ")) for call in calls))
                self.assertFalse((base / "awai-status").exists())
                self.assertFalse((base / "sys/module/firmware_class/parameters/path").exists())
            return result.stdout + result.stderr, calls

    def assert_refusal(self, fault, reason, *, before_network=True, **kwargs):
        output, _ = self.run_installer(fault, before_network=before_network, **kwargs)
        self.assertIn(f"REFUSED {reason} (disk untouched)", output)
        self.assertNotIn("AWAI_INSTALL_COMPLETE", output)

    def assert_failed_readback(self, fault, reason):
        output, _ = self.run_installer(fault, writes=1)
        self.assertIn(f"PARTIALLY WRITTEN {reason} (disk contents unverified)", output)
        self.assertNotIn("AWAI_INSTALL_COMPLETE", output)

    def test_shared_mode_refuses(self):
        self.assert_refusal("shared", "shared-not-implemented")

    def test_other_local_disk_refuses(self):
        self.assert_refusal("local-disk", "other-local-disk")

    def test_wrong_root_uuid_refuses(self):
        self.assert_refusal("root", "wrong-root")

    def test_wrong_state_uuid_refuses(self):
        self.assert_refusal("state", "wrong-state")

    def test_multiple_namespaces_refuse(self):
        self.assert_refusal("namespace", "namespace-count")

    def test_wrong_mac_refuses_before_network(self):
        self.assert_refusal("mac", "wrong-target")

    def test_allowlisted_mac_installs(self):
        output, _ = self.run_installer(writes=1)
        self.assertIn("AWAI_INSTALL_COMPLETE", output)

    def test_missing_allowlist_refuses_before_network(self):
        self.assert_refusal("", "missing-installer-macs", macs="missing")

    def test_empty_allowlist_refuses_before_network(self):
        self.assert_refusal("", "empty-installer-macs", macs="empty")

    def test_malformed_allowlist_refuses_before_network(self):
        self.assert_refusal("", "malformed-installer-macs", macs="malformed")

    def test_allowlist_normalizes_case_and_separators(self):
        output, _ = self.run_installer(writes=1, macs="normalized")
        self.assertIn("AWAI_INSTALL_COMPLETE", output)

    def test_sysfs_mac_normalizes_case_and_separators(self):
        output, _ = self.run_installer(writes=1, nic_mac="0C-47-A9-60-9D-34")
        self.assertIn("AWAI_INSTALL_COMPLETE", output)

    def test_cmdline_macs_path_overrides_env(self):
        output, _ = self.run_installer(writes=1, cmdline_macs=True)
        self.assertIn("AWAI_INSTALL_COMPLETE", output)

    def test_installer_script_has_no_mac_literal(self):
        script = Path(__file__).with_name("init-install.sh").read_text()
        self.assertEqual(
            re.findall(r"([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}", script), []
        )

    def test_bundled_default_allowlist_keeps_existing_machine(self):
        lines = Path(__file__).with_name("installer-macs.txt").read_text().splitlines()
        entries = [line.strip() for line in lines if line.strip() and not line.strip().startswith("#")]
        self.assertIn("0c:47:a9:60:9d:34", entries)

    def test_cmdline_cannot_override_capacity(self):
        self.assert_refusal("capacity", "unexpected-capacity")

    def test_wrong_profile_refuses_before_network(self):
        self.assert_refusal("profile", "invalid-mode")

    def test_missing_install_pins_refuse(self):
        self.assert_refusal("missing-pins", "missing-install-pins")

    def test_malformed_install_pins_refuse(self):
        self.assert_refusal("malformed-pins", "malformed-install-pins")

    def test_unaligned_image_refuses(self):
        self.assert_refusal("unaligned", "invalid-img-bytes")

    def test_typed_confirmation_mismatch_refuses(self):
        self.assert_refusal("confirm", "confirm-mismatch", before_network=False)

    def test_overlong_fetch_refuses(self):
        self.assert_refusal("overlong", "image-size", before_network=False)

    def test_wrong_download_digest_refuses(self):
        self.assert_refusal("image-digest", "image-digest", before_network=False)

    def test_insufficient_ram_refuses_before_network(self):
        self.assert_refusal("low-memory", "insufficient-image-ram")

    def test_readback_digest_mismatch_stops_after_one_write(self):
        self.assert_failed_readback("readback-digest", "readback-digest")

    def test_pipeline_exit_masking_cannot_hide_producer_failure(self):
        subprocess.run(["/bin/sh", "-c", "false | true"], check=True)
        self.assert_refusal("blkid-status", "wrong-root")
        self.assert_refusal("wget-status", "image-fetch", before_network=False)
        self.assert_failed_readback("readback-status", "readback")

    def test_readback_hash_failure_stops_after_one_write(self):
        self.assert_failed_readback("hash-status", "readback-hash")

    def test_verified_bytes_written_once_with_bounded_count(self):
        output, calls = self.run_installer(writes=1)
        self.assertIn("AWAI_INSTALL_COMPLETE", output)
        self.assertEqual(sum(call.startswith("wget ") for call in calls), 1)

    def assert_second_refusal(self, fault, reason, *, before_network=True):
        output, calls = self.run_installer(fault, second=True, before_network=before_network)
        self.assertIn(f"REFUSED {reason} (disk untouched)", output)
        self.assertNotIn("AWAI_INSTALL_COMPLETE", output)
        self.assertNotIn("dd bs=512 count=1", calls)

    def test_second_disk_absent_serial_refuses(self):
        self.assert_second_refusal("serial-absent", "target-serial-absent")

    def test_second_disk_duplicate_serial_refuses(self):
        self.assert_second_refusal("serial-duplicate", "duplicate-target-serial")

    def test_second_disk_4kn_refuses(self):
        self.assert_second_refusal("4kn", "target-sector-size")

    def test_second_disk_undersized_refuses(self):
        self.assert_second_refusal("undersized", "target-too-small")

    def test_second_disk_existing_nvme_as_target_refuses(self):
        self.assert_second_refusal("target-is-existing", "target-is-existing-nvme")

    def test_second_disk_missing_existing_nvme_refuses(self):
        self.assert_second_refusal("existing-missing", "missing-existing-nvme")

    def test_second_disk_nonzero_tail_refuses(self):
        self.assert_second_refusal(
            "nonblank", "target is not blank; deliberately blank the second disk before retrying"
        )

    def test_second_disk_placeholder_pins_refuse(self):
        self.assert_second_refusal("placeholder-serial", "invalid-target-serial")
        self.assert_second_refusal("placeholder-capacity", "invalid-target-capacity")

    def test_second_disk_wrong_mac_refuses_before_network(self):
        self.assert_second_refusal("mac", "wrong-target")

    def test_second_disk_replacement_after_fetch_refuses(self):
        self.assert_second_refusal("disk-replaced", "target-changed", before_network=False)

    def test_second_disk_writes_and_reads_back_only_the_pinned_target(self):
        output, calls = self.run_installer(second=True, writes=1)
        self.assertIn("AWAI_INSTALL_COMPLETE", output)
        self.assertEqual(calls.count("dd bs=512 count=1"), 1)
        self.assertEqual(sum(call.startswith("wget ") for call in calls), 1)


if __name__ == "__main__":
    unittest.main()
