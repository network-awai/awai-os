#!/usr/bin/env python3
"""Set the Awai feed in a release source checkout and verify it in the built Updater APK."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import shutil
import struct
import subprocess
import tempfile
from urllib.parse import urlsplit
from xml.sax.saxutils import escape
from zipfile import BadZipFile, ZIP_STORED, ZipFile


STRINGS = Path("app/src/main/res/values/strings.xml")
RESOURCE = re.compile(r'(<string name="updater_server_url" translatable="false">)([^<]*)(</string>)')
APK_DEFAULT = re.compile(r'^\s*resource [^\s]+ string/updater_server_url\n\s*\(\) "([^"]+)"', re.MULTILINE)
PLACEHOLDER = re.compile(r"\{(?:device|type|incr)\}")


def feed_url(value):
    try:
        url = urlsplit(value)
        url.port  # Validate the port when one is present.
    except ValueError as error:
        raise argparse.ArgumentTypeError("invalid HTTPS feed URL") from error
    remainder = PLACEHOLDER.sub("", url.path + url.query)
    host = (url.hostname or "").rstrip(".").lower()
    if (
        url.scheme != "https" or not host or not url.path or url.username is not None
        or url.password is not None or "#" in value or any(not 33 <= ord(char) <= 126 for char in value)
        or any(char in "{}\\<>\"" for char in remainder)
        or any(char in "{}\\<>\"" for char in url.netloc)
        or host == "lineageos.org" or host.endswith(".lineageos.org")
    ):
        raise argparse.ArgumentTypeError("specify an explicit HTTPS release feed outside lineageos.org")
    return value


def configure(checkout, url):
    path = checkout / STRINGS
    content = path.read_text(encoding="utf-8")
    matches = list(RESOURCE.finditer(content))
    if len(matches) != 1:
        raise ValueError(f"{path}: expected exactly one static updater_server_url resource")
    match = matches[0]
    replacement = escape(url)
    if match[2] != replacement:
        path.write_text(content[:match.start(2)] + replacement + content[match.end(2):], encoding="utf-8")


def configure_release(checkout, url):
    revision = "1445c6104ffb33123d4e449a60e3c054ed5a9ee0"
    git = ["git", "-C", str(checkout)]
    actual = subprocess.check_output([*git, "rev-parse", "HEAD"], text=True).strip()
    if actual != revision:
        raise ValueError("unexpected Updater source revision")
    patch = Path(__file__).resolve().parent / "patches/updater-empty-feed-withdrawal.patch"
    apply = [*git, "apply", "--unidiff-zero"]
    already_applied = subprocess.run(
        [*apply, "--reverse", "--check", str(patch)], capture_output=True
    ).returncode == 0
    if not already_applied:
        subprocess.run([*apply, "--check", str(patch)], check=True)
    configure(checkout, url)
    if not already_applied:
        subprocess.run([*apply, str(patch)], check=True)


def apk_resources(apk, aapt2):
    result = subprocess.run([aapt2, "dump", "resources", str(apk)], capture_output=True, text=True, check=True)
    return result.stdout


def verify_apk(apk, url, aapt2):
    if APK_DEFAULT.findall(apk_resources(apk, aapt2)) != [url]:
        raise ValueError("built Updater default feed does not match the configured release URL")


def verified_sha256(file, expected):
    digest = hashlib.sha256()
    for chunk in iter(lambda: file.read(1024 * 1024), b""):
        digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError("ZIP digest differs from the signing record")


def properties(text):
    return dict(line.split("=", 1) for line in text.splitlines() if "=" in line)


def verify_target_files(package, expected_sha256, url, device, aapt2):
    with package.open("rb") as file:
        verified_sha256(file, expected_sha256)
        with ZipFile(file) as archive, tempfile.TemporaryDirectory() as stage:
            def read_text(name):
                return archive.read(name).decode("utf-8")

            metadata = properties(read_text("META/misc_info.txt"))
            if metadata.get("ab_update") != "true" or "META/ab_partitions.txt" not in archive.namelist():
                raise ValueError("target-files are missing PC A/B metadata")
            partitions = set(read_text("META/ab_partitions.txt").split())
            if not {"boot", "vendor_boot"} <= partitions:
                raise ValueError("target-files lack the PC A/B partition set")
            if {"efi", "bios", "esp", "awai_esp"} & {name.lower() for name in partitions}:
                raise ValueError("target-files include a protected boot partition in A/B updates")

            props = [properties(read_text(name)) for name in archive.namelist()
                     if name.endswith("/build.prop") and name.split("/", 1)[0] in
                     {"SYSTEM", "SYSTEM_EXT", "PRODUCT", "VENDOR", "ODM", "SYSTEM_DLKM", "VENDOR_DLKM", "ODM_DLKM"}]
            def values(key):
                return {p[key] for p in props if p.get(key)}

            if values("ro.lineage.device") != {device} or values("ro.build.ab_update") != {"true"}:
                raise ValueError("built device or A/B identity does not match the release target")
            if values("ro.build.tags") != {"release-keys"}:
                raise ValueError("built properties do not identify release keys")
            if any(values(key) - {"false", "0"} for key in
                   ("ro.ota.allow_downgrade", "lineage.updater.allow_downgrading")):
                raise ValueError("built properties enable OTA downgrade")
            if values("lineage.updater.uri") - {url}:
                raise ValueError("built properties override the selected release feed")

            apk_paths = {}
            for name in ("Updater", "LineageSetupWizard"):
                members = [entry for entry in archive.infolist() if entry.filename.endswith(f"/{name}.apk")]
                if len(members) != 1:
                    raise ValueError(f"expected one built {name}.apk")
                destination = Path(stage) / f"{name}.apk"
                with archive.open(members[0]) as content, destination.open("wb") as output:
                    shutil.copyfileobj(content, output)
                apk_paths[name] = destination

            verify_apk(apk_paths["Updater"], url, aapt2)
            if not re.search(r"\bresource \S+ layout/awai_welcome_activity\b",
                             apk_resources(apk_paths["LineageSetupWizard"], aapt2)):
                raise ValueError("built SetupWizard does not include Awai Welcome")
    return {"targetFilesSha256": expected_sha256, "device": device,
            "feed": url, "abPartitions": sorted(partitions), "welcome": True}


def zip_data_range(file, entry):
    if entry.compress_type != ZIP_STORED:
        raise ValueError(f"{entry.filename}: streaming ZIP entry is compressed")
    file.seek(entry.header_offset)
    magic, name_length, extra_length = struct.unpack("<4s22xHH", file.read(30))
    if magic != b"PK\x03\x04":
        raise ValueError(f"{entry.filename}: invalid ZIP local header")
    return entry.header_offset + 30 + name_length + extra_length, entry.file_size


def validate_stream_ranges(file, ota, properties, package_size):
    ranges = {}
    for item in properties.split(","):
        match = re.fullmatch(r"([^:\s]+):([0-9]+):([0-9]+)", item.strip())
        if not match or match[1] in ranges:
            raise ValueError("invalid or duplicate OTA streaming range")
        offset, size = int(match[2]), int(match[3])
        if offset >= package_size or offset + size > package_size:
            raise ValueError(f"{match[1]}: streaming range exceeds the OTA ZIP")
        ranges[match[1]] = offset, size

    payload_offset, payload_size = zip_data_range(file, ota.getinfo("payload.bin"))
    properties_range = zip_data_range(file, ota.getinfo("payload_properties.txt"))
    file.seek(payload_offset)
    magic, _, manifest_size, signature_size = struct.unpack(">4sQQI", file.read(24))
    metadata_size = 24 + manifest_size + signature_size
    if magic != b"CrAU" or metadata_size > payload_size or not properties_range[1]:
        raise ValueError("invalid A/B payload metadata")
    expected = {
        "payload.bin": (payload_offset, payload_size),
        "payload_metadata.bin": (payload_offset, metadata_size),
        "payload_properties.txt": properties_range,
    }
    for name, location in expected.items():
        if ranges.get(name) != location:
            raise ValueError(f"{name}: streaming range differs from the OTA ZIP")


def make_index(package, url, expected_sha256, device, release_type, version, source_build):
    if (urlsplit(url).path.rsplit("/", 1)[-1] != package.name
        or PLACEHOLDER.search(url) or package.suffix != ".zip"):
        raise ValueError("package URL must name the exact OTA ZIP and contain no placeholders")
    with package.open("rb") as file:
        verified_sha256(file, expected_sha256)
        file.seek(0, 2)
        size = file.tell()
        with ZipFile(file) as ota:
            metadata_file = ota.getinfo("META-INF/com/android/metadata")
            if metadata_file.file_size > 65536:
                raise ValueError("OTA metadata exceeds 64 KiB")
            raw = ota.read(metadata_file).decode("utf-8")
            ota.getinfo("payload.bin")
            ota.getinfo("payload_properties.txt")
            metadata = properties(raw)
            if metadata.get("ota-property-files"):
                validate_stream_ranges(file, ota, metadata["ota-property-files"], size)
    if metadata.get("ota-type") != "AB" or device not in metadata.get("pre-device", "").split("|"):
        raise ValueError("OTA is not an A/B payload for the selected device")
    required_source = metadata.get("pre-build-incremental")
    if required_source != source_build or (source_build is None and metadata.get("pre-build")):
        raise ValueError("OTA source build does not match the selected feed")
    timestamp = int(metadata.get("post-timestamp", "0"))
    if timestamp <= 0:
        raise ValueError("OTA metadata has no valid target timestamp")
    artifact = {"filename": package.name, "sha256": expected_sha256, "size": size, "url": url}
    for metadata_key, key, convert in (
        ("post-security-patch-level", "os_patch_level", str),
        ("post-sdk-level", "os_sdk_level", int),
        ("ota-property-files", "ota_property_files", str),
    ):
        if metadata.get(metadata_key):
            artifact[key] = convert(metadata[metadata_key])
    return [{"datetime": timestamp, "files": [artifact], "type": release_type, "version": version}]


def target_build(package, digest):
    with package.open("rb") as file:
        verified_sha256(file, digest)
        with ZipFile(file) as target:
            build = properties(target.read("SYSTEM/build.prop").decode())
            if properties(target.read("META/misc_info.txt").decode()).get("ab_update") != "true":
                raise ValueError("expected A/B target-files")
            return build


def verify_ota(ota, cert, cert_digest, target, target_digest, source, source_digest, checker):
    certificate = ssl.PEM_cert_to_DER_cert(cert.read_text())
    if hashlib.sha256(certificate).hexdigest() != cert_digest:
        raise ValueError("OTA certificate SHA-256 differs from the signing record")
    build = target_build(target, target_digest)
    with ota.open("rb") as file:
        ota_digest = hashlib.file_digest(file, "sha256").hexdigest()
        with ZipFile(file) as package:
            if package.getinfo("META-INF/com/android/metadata").file_size > 65536:
                raise ValueError("OTA metadata exceeds 64 KiB")
            metadata = properties(package.read("META-INF/com/android/metadata").decode())
            if metadata.get("ota-type") != "AB" or "payload.bin" not in package.namelist():
                raise ValueError("expected an A/B OTA payload")

    for field, prop in (
        ("post-build", "ro.build.fingerprint"),
        ("post-build-incremental", "ro.build.version.incremental"),
        ("post-timestamp", "ro.build.date.utc"),
    ):
        if metadata.get(field) != build[prop]:
            raise ValueError(f"{field} does not match the target build")

    if source is None:
        if source_digest is not None or {"pre-build", "pre-build-incremental"} & metadata.keys():
            raise ValueError("expected a full OTA")
    else:
        if source_digest is None:
            raise ValueError("source target-files SHA-256 is required for an incremental OTA")
        before = target_build(source, source_digest)
        if (metadata.get("pre-build") != before["ro.build.fingerprint"] or
            metadata.get("pre-build-incremental") != before["ro.build.version.incremental"]):
            raise ValueError("OTA does not match the source build")
        if int(build["ro.build.date.utc"]) <= int(before["ro.build.date.utc"]):
            raise ValueError("expected an incremental OTA to a newer build")

    result = subprocess.run(
        [checker, str(cert), str(ota)], capture_output=True, text=True, check=True,
        env={key: value for key, value in os.environ.items() if key != "PYTHONOPTIMIZE"},
    )
    if any(line not in result.stdout.splitlines() for line in (
        "Whole package signature VERIFIED", "Payload signatures VERIFIED",
    )):
        raise ValueError("AOSP checker did not verify both package and payload signatures")
    with ota.open("rb") as file:
        verified_sha256(file, ota_digest)
    return {"otaSha256": ota_digest, "certificateSha256": cert_digest,
            "targetFilesSha256": target_digest, "sourceTargetFilesSha256": source_digest,
            "incremental": metadata["post-build-incremental"], "payloadVerified": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    source = subcommands.add_parser("configure")
    source.add_argument("checkout", type=Path)
    source.add_argument("feed", type=feed_url)
    release = subcommands.add_parser("configure-release")
    release.add_argument("checkout", type=Path)
    release.add_argument("feed", type=feed_url)
    apk = subcommands.add_parser("verify-apk")
    apk.add_argument("apk", type=Path)
    apk.add_argument("feed", type=feed_url)
    apk.add_argument("--aapt2", default="aapt2")
    target = subcommands.add_parser("verify-target-files")
    target.add_argument("target_files", type=Path)
    target.add_argument("feed", type=feed_url)
    target.add_argument("--sha256", required=True, help="SHA-256 from the trusted signing record")
    target.add_argument("--device", required=True)
    target.add_argument("--aapt2", default="aapt2")
    ota = subcommands.add_parser("verify-ota")
    ota.add_argument("ota_zip", type=Path)
    ota.add_argument("certificate", type=Path)
    ota.add_argument("target_files", type=Path)
    ota.add_argument("--certificate-sha256", required=True)
    ota.add_argument("--target-sha256", required=True)
    ota.add_argument("--source-target-files", type=Path)
    ota.add_argument("--source-sha256")
    ota.add_argument("--checker", default="check_ota_package_signature")
    index = subcommands.add_parser("make-index")
    index.add_argument("ota_zip", type=Path)
    index.add_argument("artifact_url", type=feed_url)
    index.add_argument("--sha256", required=True, help="SHA-256 from the trusted signing record")
    index.add_argument("--device", required=True)
    index.add_argument("--release-type", required=True)
    index.add_argument("--version", required=True)
    index.add_argument("--source-build", help="OTA source incremental version, omitted for a full OTA")
    args = parser.parse_args()
    try:
        if args.command == "configure":
            configure(args.checkout, args.feed)
        elif args.command == "configure-release":
            configure_release(args.checkout, args.feed)
        elif args.command == "verify-apk":
            verify_apk(args.apk, args.feed, args.aapt2)
        elif args.command == "verify-target-files":
            print(json.dumps(verify_target_files(
                args.target_files, args.sha256, args.feed, args.device, args.aapt2,
            ), indent=2))
        elif args.command == "verify-ota":
            print(json.dumps(verify_ota(
                args.ota_zip, args.certificate, args.certificate_sha256,
                args.target_files, args.target_sha256, args.source_target_files,
                args.source_sha256, args.checker,
            ), indent=2))
        else:
            print(json.dumps(make_index(
                args.ota_zip, args.artifact_url, args.sha256, args.device,
                args.release_type, args.version, args.source_build,
            ), indent=2))
    except (OSError, ValueError, KeyError, BadZipFile, struct.error, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
