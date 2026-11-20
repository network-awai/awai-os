import argparse
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from xml.etree import ElementTree


spec = spec_from_file_location("updater_feed", Path(__file__).with_name("updater-feed.py"))
updater = module_from_spec(spec)
spec.loader.exec_module(updater)
FEED = "https://release.example/{device}/{type}/{incr}/builds?track=pilot&limit=1"
UPSTREAM = "https://download.lineageos.org/api/v2/devices/{device}/builds"


class UpdaterFeedTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
