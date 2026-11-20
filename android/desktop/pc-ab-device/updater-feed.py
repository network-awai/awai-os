#!/usr/bin/env python3
"""Set the Awai feed in a release source checkout and verify it in the built Updater APK."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
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


def verify_apk(apk, url, aapt2):
    result = subprocess.run([aapt2, "dump", "resources", str(apk)], capture_output=True, text=True, check=True)
    if APK_DEFAULT.findall(result.stdout) != [url]:
        raise ValueError("built Updater default feed does not match the configured release URL")


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
        hash_state = hashlib.sha256()
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            hash_state.update(chunk)
        digest = hash_state.hexdigest()
        if digest != expected_sha256:
            raise ValueError("OTA ZIP digest differs from the signing record")
        file.seek(0, 2)
        size = file.tell()
        with ZipFile(file) as ota:
            metadata_file = ota.getinfo("META-INF/com/android/metadata")
            if metadata_file.file_size > 65536:
                raise ValueError("OTA metadata exceeds 64 KiB")
            raw = ota.read(metadata_file).decode("utf-8")
            ota.getinfo("payload.bin")
            ota.getinfo("payload_properties.txt")
            metadata = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
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
    artifact = {"filename": package.name, "sha256": digest, "size": size, "url": url}
    for metadata_key, key, convert in (
        ("post-security-patch-level", "os_patch_level", str),
        ("post-sdk-level", "os_sdk_level", int),
        ("ota-property-files", "ota_property_files", str),
    ):
        if metadata.get(metadata_key):
            artifact[key] = convert(metadata[metadata_key])
    return [{"datetime": timestamp, "files": [artifact], "type": release_type, "version": version}]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    source = subcommands.add_parser("configure")
    source.add_argument("checkout", type=Path)
    source.add_argument("feed", type=feed_url)
    apk = subcommands.add_parser("verify-apk")
    apk.add_argument("apk", type=Path)
    apk.add_argument("feed", type=feed_url)
    apk.add_argument("--aapt2", default="aapt2")
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
        elif args.command == "verify-apk":
            verify_apk(args.apk, args.feed, args.aapt2)
        else:
            print(json.dumps(make_index(
                args.ota_zip, args.artifact_url, args.sha256, args.device,
                args.release_type, args.version, args.source_build,
            ), indent=2))
    except (OSError, ValueError, KeyError, BadZipFile, struct.error, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
