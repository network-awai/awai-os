import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('layout',Path(__file__).parents[2]/'otehon/desktop-layout.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Layout(unittest.TestCase):
    def test_ansi_and_disabled_heads(self):
        value=m.heads('\x1b[1mDP-1\x1b[0m \x1b[32m(enabled)\x1b[0m\n  Model: monitor\nHDMI-A-2 (disabled)\n')
        self.assertTrue(value['DP-1']['enabled']);self.assertFalse(value['HDMI-A-2']['enabled'])
    def test_mirrors_second_head_before_browser(self):
        before=m.heads('DP-1 (enabled)\nHDMI-A-2 (enabled)\neDP-1 (disabled)')
        after=m.heads('DP-1 (enabled)\nHDMI-A-2 (mirroring DP-1)\neDP-1 (disabled)')
        with patch.object(m,'query',side_effect=[before,before,after]),patch.object(m.time,'sleep'),patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0)) as run:
            result=m.initialize('/fixed/randr')
        self.assertEqual(result['mirrored'],['HDMI-A-2'])
        self.assertEqual(run.call_args.args[0],['/fixed/randr','mirror','HDMI-A-2','DP-1'])
    def test_existing_mirror_is_idempotent(self):
        value=m.heads('DP-1 (mirroring HDMI-A-2)\nHDMI-A-2 (enabled)')
        with patch.object(m,'query',return_value=value),patch.object(m.time,'sleep'),patch.object(m.subprocess,'run') as run:
            self.assertEqual(m.initialize('/fixed/randr')['result'],'single-logical-output')
        run.assert_not_called()
    def test_command_success_without_observed_mirror_is_not_success(self):
        value=m.heads('DP-1 (enabled)\nHDMI-A-2 (enabled)')
        with patch.object(m,'query',return_value=value),patch.object(m.time,'sleep'),patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=0)):
            with self.assertRaisesRegex(ValueError,'mirror-not-observed'):m.initialize('/fixed/randr')
    def test_duplicate_or_unready_outputs_refused(self):
        with self.assertRaises(ValueError):m.heads('DP-1 (enabled)\nDP-1 (disabled)')
        with self.assertRaisesRegex(ValueError,'outputs-not-ready'):m.initialize('/fixed/randr',wait=0)

if __name__=='__main__':unittest.main()
