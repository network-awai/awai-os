import importlib.util
import os
import threading
import unittest
import http.client
from pathlib import Path
from unittest.mock import patch

os.environ['OTEHON_NET_PORT'] = '8773'
spec = importlib.util.spec_from_file_location('net_setup', Path(__file__).parents[2] / 'nixos/otehon/net-service.py')
net = importlib.util.module_from_spec(spec)
spec.loader.exec_module(net)

class NetworkServiceTests(unittest.TestCase):
    def test_escaped_ssids(self):
        self.assertEqual(net.terse_fields(r'home\:lab:85:WPA2'), ['home:lab', '85', 'WPA2'])
        self.assertEqual(net.terse_fields(r'slash\\net:85:WPA2')[0], 'slash\\net')

    def test_secret_validation_and_no_subprocess_join(self):
        with self.assertRaises(net.Refused):
            net.clean_psk('fixture\nsecret')
        async def activate(ssid, psk):
            self.assertEqual((ssid, psk), ('fixture', 'fixture-secret'))
        with patch.object(net, 'activate_wifi', activate), patch.object(net, 'run', side_effect=AssertionError('no subprocess with secret')):
            self.assertEqual(net.wifi_join({'ssid':'fixture', 'psk':'fixture-secret'}), {'connected':'fixture'})

    def test_error_payload_does_not_include_dbus_secret(self):
        async def activate(*args):
            raise RuntimeError('private-fixture-secret')
        with patch.object(net, 'activate_wifi', activate):
            with self.assertRaises(net.Refused) as err:
                net.wifi_join({'ssid':'fixture', 'psk':'fixture-secret'})
            self.assertEqual(err.exception.reason, 'join-failed')

    def test_parallel_join_rejected(self):
        net.JOIN_LOCK.acquire()
        try:
            with self.assertRaises(net.Refused) as err:
                net.wifi_join({'ssid':'fixture'})
            self.assertEqual(err.exception.status, 409)
        finally:
            net.JOIN_LOCK.release()

    def test_exact_origin_host_and_json_required(self):
        server = net.ThreadingHTTPServer(('127.0.0.1', 0), net.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def request(method, origin, host='127.0.0.1:8773', ctype='application/json'):
            c = http.client.HTTPConnection('127.0.0.1', server.server_port)
            c.request(method, '/v1/status' if method == 'GET' else '/v1/wifi/join', body='{}' if method=='POST' else None,
                      headers={'Host': host, 'Origin': origin, 'Content-Type':ctype})
            r = c.getresponse(); value = (r.status, r.getheader('Access-Control-Allow-Origin'), r.read());c.close();return value
        try:
            with patch.object(net, 'status', return_value={'link':'down'}):
                self.assertEqual(request('GET', 'http://127.0.0.1:8780')[:2], (200,'http://127.0.0.1:8780'))
                self.assertEqual(request('GET', 'null')[0],403)
                self.assertEqual(request('OPTIONS','http://127.0.0.1:8780',host='attacker:8773')[0],403)
                self.assertEqual(request('POST','http://127.0.0.1:8780',ctype='text/plain')[0],415)
        finally:
            server.shutdown();server.server_close();thread.join()

if __name__ == '__main__': unittest.main()

class DeviceBoundaryTests(unittest.TestCase):
    def test_unmanaged_debug_link_is_not_reconfigured(self):
        with patch.object(net, 'network_devices', return_value={'devices':[{'name':'eno1','route':'ethernet','managed':False}]}), patch.object(net,'run',side_effect=AssertionError('must not reconfigure debug link')):
            with self.assertRaises(net.Refused) as error:
                net.connect_wired({'device':'eno1'})
            self.assertEqual(error.exception.reason,'unmanaged-device')

    def test_forget_never_deletes_non_wifi_profile_with_same_name(self):
        with patch.object(net,'nm_ok',return_value='11111111-1111-1111-1111-111111111111:home:802-3-ethernet'), patch.object(net,'run',side_effect=AssertionError('must not delete wired profile')):
            with self.assertRaises(net.Refused):net.wifi_forget({'name':'home'})

    def test_connection_result_requires_device_readback(self):
        device={'name':'usb0','route':'iphone-usb','managed':True,'connected':False}
        from types import SimpleNamespace
        with patch.object(net,'network_devices',return_value={'devices':[device]}),patch.object(net,'run',return_value=SimpleNamespace(returncode=0)):
            with self.assertRaises(net.Refused):net.connect_wired({'device':'usb0'})

class IphoneTrustBoundaryTests(unittest.TestCase):
    def test_phone_confirmation_stays_on_the_phone(self):
        from types import SimpleNamespace
        reply=SimpleNamespace(returncode=1,stdout='Please accept the trust dialog device-private-id',stderr='')
        with patch.object(net,'iphone_attached',return_value=True),patch.object(net,'run',return_value=reply):
            self.assertEqual(net.iphone_trust({}),{'trust':'confirm-on-iphone'})
    def test_absent_phone_never_starts_pairing(self):
        with patch.object(net,'iphone_attached',return_value=False),patch.object(net,'run',side_effect=AssertionError('no device')):
            with self.assertRaises(net.Refused):net.iphone_trust({})

class ConnectedSsidTests(unittest.TestCase):
    def test_ssid_comes_from_active_ap_and_escaped_fields(self):
        devices=[{'name':'wlan0','route':'wifi','connected':True}]
        with patch.object(net,'network_devices',return_value={'devices':devices}),patch.object(net,'nm_ok',return_value=':not-active:wlan0\n*:home\\:lab:wlan0'):
            self.assertEqual(net.connected_devices()[0]['ssid'],'home:lab')
    def test_disconnected_selection_is_not_labelled_connected(self):
        devices=[{'name':'wlan0','route':'wifi','connected':False}]
        with patch.object(net,'network_devices',return_value={'devices':devices}),patch.object(net,'nm_ok',side_effect=AssertionError('no connected wifi')):
            self.assertNotIn('ssid',net.connected_devices()[0])
