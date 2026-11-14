"""Regression guards from actual installed-boot OCR, not storage normalization."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('visual',Path(os.environ.get('OTEHON_VISUAL_HELPER',Path(__file__).parents[2]/'scripts/otehon-installed-boot.py')))
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class GraphicalBootGuard(unittest.TestCase):
    markers=['Awai','データを保護','12文字以上']
    def test_actual_graphical_compatibility_digit(self):
        actual='Awai Otehon 内 蔵 NVMe か ら 起 動 中\nこ の PC の デ ー タ を 保 護\n⑫ 文 字 以 上 の パ ス フ レ ー ズ を 設 定 し て く だ さ い 。'
        self.assertTrue(v.screen_matches(actual,self.markers))
    def test_legacy_console_is_not_graphical_success(self):
        actual="Starting Unlock the encrypted Awai Otehon state volume... Choose a passphrase for this PC's data (12 characters or more). Without it the data is lost::"
        self.assertFalse(v.screen_matches(actual,self.markers))
    def test_graphical_loading_without_request_is_not_success(self):
        self.assertFalse(v.screen_matches('Awai Otehon この PC のデータを保護 起動を準備しています',self.markers))
    @unittest.skipUnless(all(shutil.which(t) for t in ['pngtopnm','pamcut','ppmtopgm','pgmtopbm','pnminvert','pamenlarge','tesseract']), 'real OCR tools are required in the Nix VM gate')
    def test_actual_logo_onboarding_has_both_hello_and_primary_action(self):
        png=Path(os.environ.get('OTEHON_HELLO_FIXTURE',Path(__file__).parent/'fixtures'/'desktop-hello-logo.png'))
        with tempfile.TemporaryDirectory() as directory:
            ppm=Path(directory)/'screen.ppm'
            ppm.write_bytes(subprocess.check_output(['pngtopnm',str(png)]))
            self.assertTrue(v.screen_matches(v.read_screen(ppm,png),['hello','get started']))
        self.assertFalse(v.screen_matches('Hello',['hello','get started']))

if __name__=='__main__': unittest.main()
