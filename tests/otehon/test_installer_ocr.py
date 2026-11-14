"""Regression guards from actual installed-boot OCR, not storage normalization."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('visual',Path(__file__).parents[2]/'scripts/otehon-installed-boot.py')
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

if __name__=='__main__': unittest.main()
