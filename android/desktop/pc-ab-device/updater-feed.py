#!/usr/bin/env python3
"""Set the Awai feed in a release source checkout and verify it in the built Updater APK."""

import argparse
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit
from xml.sax.saxutils import escape


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
    args = parser.parse_args()
    try:
        if args.command == "configure":
            configure(args.checkout, args.feed)
        else:
            verify_apk(args.apk, args.feed, args.aapt2)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
