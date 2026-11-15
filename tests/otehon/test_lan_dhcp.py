import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('lan_dhcp', Path(__file__).parents[2] / 'scripts/otehon-lan-dhcp.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class DirectLan(unittest.TestCase):
    def test_http_boot_and_one_client_scope(self):
        c = d.config('en15', '00:11:22:33:44:55', Path('/tmp/image'), Path('/tmp/leases'))
        for item in ('interface=en15', 'dhcp-host=00:11:22:33:44:55,10.77.0.2',
                     'dhcp-ignore=tag:!known', 'dhcp-vendorclass=set:httpclient,HTTPClient',
                     'dhcp-option-force=tag:httpclient,60,HTTPClient',
                     'dhcp-boot=tag:httpclient,http://10.77.0.1:8080/ipxe.efi', 'port=0'):
            self.assertIn(item, c)

    def test_rejects_multiple_clients_and_config_injection(self):
        for interface, mac, path in [('en15\nport=53', '00:11:22:33:44:55', '/tmp/image'),
                                     ('en15', '00:11:22:33:44:55\ndhcp-range=1', '/tmp/image'),
                                     ('en15', '00:11:22:33:44:55', '/tmp/x\nport=53'),
                                     ('en0', '*', '/tmp/image')]:
            with self.subTest(interface=interface, mac=mac), self.assertRaises(ValueError):
                d.config(interface, mac, Path(path), Path('/tmp/leases'))
