import hashlib
import io
import json
import struct
import unittest
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.request import Request
from zipfile import ZipFile

spec = spec_from_file_location("publish_index", Path(__file__).parents[1] / "scripts/publish-index.py")
publisher = module_from_spec(spec)
spec.loader.exec_module(publisher)


def response(content, status, headers):
    stream = io.BytesIO(content)
    stream.status = status
    stream.headers = headers
    return stream


class PublishIndexTest(unittest.TestCase):
    def test_artifact_url_and_transport_size_limits(self):
        sha = "a" * 64
        release = f"{publisher.RELEASE}/pilot-1/{sha}.zip"
        raw = f"{publisher.RAW}/{'b' * 40}/ota/{sha}.zip"
        name = f"{sha}.zip"
        publisher.validate_artifact(release, name, sha, publisher.ASSET_LIMIT - 1)
        publisher.validate_artifact(raw, name, sha, publisher.RAW_LIMIT)
        for url, size in (
            (release, publisher.ASSET_LIMIT),
            (raw, publisher.RAW_LIMIT + 1),
            (release + "?", 1024),
            (release + "#", 1024),
            (release.replace(sha, "f" * 64), 1024),
            (raw.replace("b" * 40, "b" * 39), 1024),
            (raw.replace("b" * 40, "g" * 40), 1024),
            (raw.replace("/ota/", "/../"), 1024),
            (raw.replace("https:", "http:"), 1024),
            (raw.replace("raw.githubusercontent.com", "other.invalid"), 1024),
        ):
            with self.subTest(url=url, size=size), self.assertRaises(ValueError):
                publisher.validate_artifact(url, name, sha, size)

    def test_manifest_verification_requires_an_exact_signed_pin(self):
        sha = "a" * 64
        name = f"{sha}.zip"
        with patch.object(publisher.subprocess, "run") as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(ValueError, "signature or format"):
                publisher.verify_manifest("manifest", "signature", name, sha, 123)
            run.return_value.returncode = 0
            run.return_value.stdout = json.dumps({name: {"bytes": 124, "sha256": sha}})
            with self.assertRaisesRegex(ValueError, "signed OTA manifest differs"):
                publisher.verify_manifest("manifest", "signature", name, sha, 123)
            publisher.verify_manifest("manifest", "signature", name, sha, 124)

    def test_follows_asset_redirect_and_preserves_range(self):
        url = f"{publisher.RELEASE}/pilot-1/{'a' * 64}.zip"
        content = b"verified bytes" * 12
        calls = []

        def transport(request, *, timeout):
            if isinstance(request, str):
                request = Request(request)
            location = "https://release-assets.githubusercontent.com/files/test?se=stub"
            redirected = publisher.AssetRedirect().redirect_request(
                request, None, 302, "Found", {}, location,
            )
            self.assertEqual(redirected.full_url, location)
            calls.append(redirected.get_header("Range"))
            if calls[-1]:
                return response(content[:100], 206, {"Content-Range": f"bytes 0-99/{len(content)}"})
            return response(content, 200, {"Content-Length": str(len(content))})

        with patch.object(publisher, "build_opener") as opener:
            opener.return_value.open.side_effect = transport
            publisher.verify_asset(url, hashlib.sha256(content).hexdigest(), len(content))
        self.assertEqual(calls, ["bytes=0-99", None])

    def test_rejects_unexpected_redirect_targets(self):
        request = Request(f"{publisher.RELEASE}/pilot-1/{'a' * 64}.zip")
        for target in ("https://elsewhere.invalid/asset", "http://release-assets.githubusercontent.com/a"):
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, "unexpected"):
                publisher.AssetRedirect().redirect_request(request, None, 302, "Found", {}, target)

    def test_rejects_public_bytes_with_wrong_digest(self):
        url = f"{publisher.RELEASE}/pilot-1/{'a' * 64}.zip"
        with patch.object(publisher, "build_opener") as opener:
            opener.return_value.open.side_effect = [
                response(b"x" * 100, 206, {"Content-Range": "bytes 0-99/128"}),
                response(b"x" * 128, 200, {
                    "Content-Length": "128", "ETag": hashlib.sha256(b"y" * 128).hexdigest(),
                }),
            ]
            with self.assertRaisesRegex(ValueError, "differs from the signed ZIP"):
                publisher.verify_asset(url, hashlib.sha256(b"y" * 128).hexdigest(), 128)

    def test_rejects_wrong_range_total(self):
        url = f"{publisher.RELEASE}/pilot-1/{'a' * 64}.zip"
        with patch.object(publisher, "build_opener") as opener:
            opener.return_value.open.return_value = response(
                b"x" * 100, 206, {"Content-Range": "bytes 0-99/129"},
            )
            with self.assertRaisesRegex(ValueError, "expected byte range"):
                publisher.verify_asset(url, "a" * 64, 128)

    def test_publish_then_withdraw_using_verified_index_metadata(self):
        with TemporaryDirectory() as scratch:
            root = Path(scratch)
            (root / "src").mkdir()
            (root / "indexes").mkdir()
            audit = root / "indexes/indexes.json"
            audit.write_text("{}")
            ota = root / "fixture.zip"
            payload = struct.pack(">4sQQI", b"CrAU", 2, 0, 0)
            properties = b"FILE_SIZE=24\n"
            payload_offset = 30 + len("payload.bin")
            properties_offset = payload_offset + len(payload) + 30 + len("payload_properties.txt")
            with ZipFile(ota, "w") as archive:
                archive.writestr("payload.bin", payload)
                archive.writestr("payload_properties.txt", properties)
                archive.writestr("META-INF/com/android/metadata", (
                    "ota-type=AB\npre-device=virtio_x86_64\npost-timestamp=1800000000\n"
                    f"ota-property-files=payload_metadata.bin:{payload_offset}:24,"
                    f"payload.bin:{payload_offset}:24,payload_properties.txt:{properties_offset}:{len(properties)}\n"
                ))
            digest = hashlib.sha256(ota.read_bytes()).hexdigest()
            ota = ota.rename(root / f"{digest}.zip")
            size = ota.stat().st_size
            url = f"{publisher.RELEASE}/pilot-1/{ota.name}"
            base = ["publish-index.py", "--root", scratch, "--device", "virtio_x86_64", "--incr", "200"]
            args = [
                str(ota), "--artifact-url", url, "--release-type", "RELEASE", "--version", "23.2",
                "--manifest", "manifest", "--manifest-signature", "signature",
            ]
            with patch("sys.argv", base + args + ["--sha256", digest]), patch.object(
                publisher, "verify_asset",
            ) as verify_asset, patch.object(publisher, "verify_manifest"):
                publisher.main()
                verify_asset.assert_called_once_with(url, digest, size)
            key = "virtio_x86_64/200"
            asset = json.loads(audit.read_text())[key][0]["files"][0]
            self.assertEqual((asset["url"], asset["sha256"], asset["size"]), (url, digest, size))

            # A differently named, otherwise valid archive still has to match the signing-record digest.
            fake = ota.rename(root / f"{'0' * 64}.zip")
            fake_url = url.replace(digest, "0" * 64)
            fake_args = [str(fake), "--artifact-url", fake_url, *args[3:], "--sha256", "0" * 64]
            with patch("sys.argv", base + fake_args), patch.object(
                publisher, "verify_asset",
            ) as verify_asset, patch.object(publisher, "verify_manifest"), patch(
                "sys.stderr", new_callable=io.StringIO,
            ) as stderr:
                with self.assertRaises(SystemExit):
                    publisher.main()
                self.assertIn("ZIP digest differs", stderr.getvalue())
                verify_asset.assert_not_called()
            with patch("sys.argv", base + ["--withdraw"]):
                publisher.main()
            self.assertEqual(json.loads(audit.read_text())[key], [])
            self.assertIn(f'"{key}": []', (root / "src/indexes.js").read_text())


if __name__ == "__main__":
    unittest.main()
