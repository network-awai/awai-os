import argparse
from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from xml.etree import ElementTree
from zipfile import ZipFile


spec = spec_from_file_location("updater_feed", Path(__file__).with_name("updater-feed.py"))
updater = module_from_spec(spec)
spec.loader.exec_module(updater)
FEED = "https://release.example/{device}/{type}/{incr}/builds?track=pilot&limit=1"
UPSTREAM = "https://download.lineageos.org/api/v2/devices/{device}/builds"


class UpdaterFeedTest(unittest.TestCase):
    def test_release_target_files_need_apps_and_safe_ab_properties(self):
        test_cases = (
            ("boot\nvendor_boot\nsystem\n", "", True, None),
            ("boot\nvendor_boot\nsystem\nEFI\n", "", True, "protected boot"),
            ("boot\nvendor_boot\nsystem\n", "ro.ota.allow_downgrade=true\n", True, "downgrade"),
            ("boot\nvendor_boot\nsystem\n", f"lineage.updater.uri={UPSTREAM}\n", True, "override"),
            ("boot\nvendor_boot\nsystem\n", "", False, "Awai Welcome"),
        )
        with TemporaryDirectory() as directory:
            package = Path(directory) / "target-files.zip"
            for partitions, extra, welcome, error in test_cases:
                with self.subTest(error=error):
                    with ZipFile(package, "w") as archive:
                        archive.writestr("META/misc_info.txt", "ab_update=true\n")
                        archive.writestr("META/ab_partitions.txt", partitions)
                        archive.writestr("SYSTEM/build.prop", "ro.build.tags=release-keys\n")
                        archive.writestr("PRODUCT/etc/build.prop", "ro.lineage.device=virtio_x86_64\n" + extra)
                        archive.writestr("VENDOR/build.prop", "ro.build.ab_update=true\n")
                        archive.writestr("SYSTEM_EXT/priv-app/Updater/Updater.apk", b"updater")
                        archive.writestr("SYSTEM_EXT/priv-app/LineageSetupWizard/LineageSetupWizard.apk", b"welcome")
                    def resources(apk, _aapt):
                        if apk.read_bytes() == b"updater":
                            return f'  resource 0x7f12045b string/updater_server_url\n    () "{FEED}"\n'
                        return "  resource 0x7f12045b layout/awai_welcome_activity\n" if welcome else ""
                    digest = sha256(package.read_bytes()).hexdigest()
                    args = (package, digest, FEED, "virtio_x86_64", "aapt2")
                    with patch.object(updater, "apk_resources", side_effect=resources):
                        if error:
                            with self.assertRaisesRegex(ValueError, error):
                                updater.verify_target_files(*args)
                        else:
                            self.assertEqual(updater.verify_target_files(*args)["targetFilesSha256"], digest)

    def test_configuration_is_literal_and_idempotent(self):
        with TemporaryDirectory() as directory:
            checkout = Path(directory)
            strings = checkout / updater.STRINGS
            strings.parent.mkdir(parents=True)
            strings.write_text(
                '<resources><string name="updater_server_url" translatable="false">'
                f'{UPSTREAM}</string><string name="app_name">Updater</string></resources>',
                encoding="utf-8",
            )
            updater.configure(checkout, updater.feed_url(FEED))
            first = strings.read_bytes()
            updater.configure(checkout, updater.feed_url(FEED))
            self.assertEqual(first, strings.read_bytes())
            root = ElementTree.fromstring(first)
            self.assertEqual(root.find("./string[@name='updater_server_url']").text, FEED)
            self.assertEqual(root.find("./string[@name='app_name']").text, "Updater")

    def test_rejects_unsafe_or_upstream_feed_values(self):
        for url in (UPSTREAM, "https://lineageos.org./feed", "http://release.example/feed",
                    "https://secret@release.example/feed", "https://release.example/{build}/feed",
                    "https://release.example/feed#", "https://release.example/feed\0"):
            with self.subTest(url=url), self.assertRaises(argparse.ArgumentTypeError):
                updater.feed_url(url)

    def test_built_feed_must_match_exactly(self):
        for url in (FEED, UPSTREAM):
            result = subprocess.CompletedProcess([], 0, stdout=(
                f'  resource 0x7f12045b string/updater_server_url\n    () "{url}"\n'
            ))
            with self.subTest(url=url), patch.object(updater.subprocess, "run", return_value=result):
                if url == FEED:
                    updater.verify_apk(Path("Updater.apk"), FEED, "aapt2")
                else:
                    with self.assertRaisesRegex(ValueError, "does not match"):
                        updater.verify_apk(Path("Updater.apk"), FEED, "aapt2")

    def test_ota_checks_incremental_source_and_both_signature_results(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            cert = root / "cert.pem"
            cert.write_text("-----BEGIN CERTIFICATE-----\nYQ==\n-----END CERTIFICATE-----\n")
            cert_digest = sha256(b"a").hexdigest()

            def target(name, time):
                path = root / f"{name}.zip"
                with ZipFile(path, "w") as archive:
                    archive.writestr("META/misc_info.txt", "ab_update=true\n")
                    archive.writestr("SYSTEM/build.prop", f"ro.build.fingerprint={name}\n"
                                    f"ro.build.version.incremental={name}\nro.build.date.utc={time}\n")
                return path, sha256(path.read_bytes()).hexdigest()

            source, source_sha = target("old", 10)
            latest, latest_sha = target("new", 20)
            different, different_sha = target("other", 12)
            ota = root / "ota.zip"
            with ZipFile(ota, "w") as archive:
                archive.writestr("META-INF/com/android/metadata", "ota-type=AB\n"
                                 "pre-build=old\npre-build-incremental=old\npost-build=new\n"
                                 "post-build-incremental=new\npost-timestamp=20\n")
                archive.writestr("payload.bin", b"fixture")
            with patch.object(updater.subprocess, "run") as verify:
                verify.return_value.stdout = ("Whole package signature VERIFIED\n"
                                              "Payload signatures VERIFIED\n")
                args = (ota, cert, cert_digest, latest, latest_sha)
                with self.assertRaisesRegex(ValueError, "missing OTA streaming ranges"):
                    updater.verify_ota(*args, source, source_sha, "checker", require_streaming=True)
                verify.assert_not_called()
                record = updater.verify_ota(*args, source, source_sha, "checker")
                self.assertFalse(record["streamingVerified"])
                self.assertEqual(record["sourceTargetFilesSha256"], source_sha)
                with self.assertRaisesRegex(ValueError, "source build"):
                    updater.verify_ota(*args, different, different_sha, "checker")
                with self.assertRaisesRegex(ValueError, "expected a full OTA"):
                    updater.verify_ota(*args, None, None, "checker")
                verify.return_value.stdout = "Whole package signature VERIFIED\n"
                with self.assertRaisesRegex(ValueError, "both package and payload"):
                    updater.verify_ota(*args, source, source_sha, "checker")

    def test_index_binds_ota_to_digest_device_and_source(self):
        with TemporaryDirectory() as directory:
            package = Path(directory) / "update.zip"
            url = f"https://release.example/files/{package.name}"
            for source in (None, "build-1"):
                with self.subTest(source=source):
                    with ZipFile(package, "w") as archive:
                        metadata = "ota-type=AB\npre-device=awai_pc\npost-timestamp=1800000000\npost-sdk-level=36\n"
                        if source:
                            metadata += f"pre-build-incremental={source}\n"
                        archive.writestr("META-INF/com/android/metadata", metadata)
                        archive.writestr("payload.bin", b"fixture")
                        archive.writestr("payload_properties.txt", b"fixture")
                    digest = sha256(package.read_bytes()).hexdigest()
                    output = updater.make_index(package, url, digest, "awai_pc", "RELEASE", "24.0", source)
                with self.assertRaisesRegex(ValueError, "missing OTA streaming ranges"):
                    updater.make_index(package, url, digest, "awai_pc", "RELEASE", "24.0", source,
                                       require_streaming=True)
                    self.assertEqual(output, [{
                        "type": "RELEASE", "version": "24.0", "datetime": 1800000000,
                        "files": [{"filename": package.name, "sha256": digest, "size": package.stat().st_size,
                                   "url": url, "os_sdk_level": 36}],
                    }])
                    for invalid_digest, device, build, error in (
                        ("0" * 64, "awai_pc", source, "digest differs"),
                        (digest, "wrong_device", source, "selected device"),
                        (digest, "awai_pc", "another_build", "source build"),
                    ):
                        with self.assertRaisesRegex(ValueError, error):
                            updater.make_index(package, url, invalid_digest, device, "RELEASE", "24.0", build)

    def test_index_checks_ranges_against_signed_zip_layout(self):
        payload = struct.pack(">4sQQI", b"CrAU", 2, 2, 1) + b"met" + b"data"
        properties = b"FILE_SIZE=31\n"
        payload_offset = 30 + len("payload.bin")
        properties_offset = payload_offset + len(payload) + 30 + len("payload_properties.txt")
        ranges = f"payload_metadata.bin:{payload_offset}:27,payload.bin:{payload_offset}:{len(payload)},"
        ranges += f"payload_properties.txt:{properties_offset}:{len(properties)}"
        with TemporaryDirectory() as directory:
            package = Path(directory) / "update.zip"
            url = f"https://release.example/files/{package.name}"
            for candidate, error in (
                (ranges + "   ", None),
                (ranges.replace(f"payload.bin:{payload_offset}:", f"payload.bin:{payload_offset + 1}:"), "differs"),
                (ranges + ",metadata:999999999:1", "exceeds"),
                (ranges + f",payload_metadata.bin:{payload_offset}:27", "duplicate"),
            ):
                with self.subTest(candidate=candidate):
                    with ZipFile(package, "w") as archive:
                        archive.writestr("payload.bin", payload)
                        archive.writestr("payload_properties.txt", properties)
                        archive.writestr("META-INF/com/android/metadata", (
                            "ota-type=AB\npre-device=awai_pc\npost-timestamp=1800000000\n"
                            f"ota-property-files={candidate}\n"
                        ))
                    digest = sha256(package.read_bytes()).hexdigest()
                    args = (package, url, digest, "awai_pc", "RELEASE", "24.0", None)
                    if error:
                        with self.assertRaisesRegex(ValueError, error):
                            updater.make_index(*args)
                    else:
                        files = updater.make_index(*args, require_streaming=True)[0]["files"]
                        self.assertEqual(files[0]["ota_property_files"], candidate)

            with ZipFile(package, "w") as archive:
                large = b"x" * 65_537
                archive.writestr("payload.bin", payload)
                archive.writestr("payload_properties.txt", large)
                oversized = ranges.removesuffix(str(len(properties))) + str(len(large))
                archive.writestr("META-INF/com/android/metadata",
                                 "ota-type=AB\npre-device=awai_pc\npost-timestamp=1800000000\n"
                                 f"ota-property-files={oversized}\n")
            digest = sha256(package.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, "payload properties exceed"):
                updater.make_index(package, url, digest, "awai_pc", "RELEASE", "24.0", None,
                                   require_streaming=True)


if __name__ == "__main__":
    unittest.main()
