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
    assert options["bs"] == "512" and options["count"] == "1"
    data = Path(options["if"]).read_bytes()[:512]
    if "of" in options:
        target = root / "dev/nvme0n1"
        assert Path(options["of"]) == target
        with target.open("r+b") as disk:
            disk.write(data)
    else:
        sys.stdout.buffer.write(b"B" * 512 if fault == "readback-digest" else data)
        sys.exit(int(fault == "readback-status"))
    sys.exit(0)
assert command in {"awk", "cat", "mkdir", "mkfifo"}, command
os.execvp(command, [command, *args])
'''


class InitInstallTest(unittest.TestCase):
    def run_installer(self, fault="", *, before_network=False, writes=0):
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
            mode = "shared" if fault == "shared" else "erase"
            profile = "2" if fault == "profile" else "1"
            (base / "proc/cmdline").write_text(
                f"awai.install.profile={profile} awai.install.mode={mode} awai.install.sectors={sectors}\n"
            )
            available = 262144 if fault == "low-memory" else 1048576
            (base / "proc/meminfo").write_text(f"MemAvailable: {available} kB\n")
            (base / "sys/block/nvme0n1/size").write_text(sectors)
            (base / "sys/class/net/eth0/address").write_text(
                "00:00:00:00:00:00" if fault == "mac" else "0c:47:a9:60:9d:34"
            )
            if fault == "local-disk":
                (base / "sys/block/sda").mkdir()
            if fault == "namespace":
                (base / "sys/block/nvme1n1").mkdir()
            pins = f"image_url=http://10.77.0.1:18091/install.img\nimage_sha={DIGEST}\n"
            pins += f"img_bytes={513 if fault == 'unaligned' else 512}\n"
            if fault == "malformed-pins":
                pins += f"image_sha={DIGEST}\n"
            if fault != "missing-pins":
                (base / "awai/install.pins").write_text(pins)
            script = Path(__file__).with_name("init-install.sh").read_text()
            script = script.replace("exec </dev/console >/dev/console 2>&1\n", "", 1)
            script = re.sub(r"/(?:awai|sys|proc|dev)(?=[/ -])", lambda m: str(base) + m[0], script)
            init = base / "init.sh"
            init.write_text(script)
            result = subprocess.run(
                ["/bin/sh", str(init)], input=("wrong" if fault == "confirm" else DIGEST) + "\n",
                text=True, capture_output=True, timeout=10, check=True,
                env={**os.environ, "INSTALL_TEST_FAULT": fault},
            )
            calls = (base / "calls").read_text().splitlines()
            self.assertEqual(sum(call.startswith("dd ") and " of=" in call for call in calls), writes)
            self.assertEqual(target.read_bytes(), IMAGE + ORIGINAL_DISK[512:] if writes else ORIGINAL_DISK)
            if before_network:
                self.assertFalse(any(call.startswith(("ip ", "httpd ", "wget ", "sh ")) for call in calls))
                self.assertFalse((base / "awai-status").exists())
                self.assertFalse((base / "sys/module/firmware_class/parameters/path").exists())
            return result.stdout + result.stderr, calls

    def assert_refusal(self, fault, reason, *, before_network=True):
        output, _ = self.run_installer(fault, before_network=before_network)
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


if __name__ == "__main__":
    unittest.main()
