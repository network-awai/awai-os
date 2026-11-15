import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

root = Path(__file__).parents[2]
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, root/'nixos/otehon'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result
c = module('console', 'installer-console.py')
b = module('console_broker', 'installer-broker.py')

class Stop(BaseException): pass

class Console(unittest.TestCase):
    row = {'id':'id', 'path':'/dev/nvme0n1', 'model':'Internal', 'serial':'HARDWARE-ID',
           'size':200, 'partitions':[], 'used':False, 'readOnly':False, 'ambiguous':False}

    def test_no_default_or_escape_sequence_selects_a_disk(self):
        for value in ['', '0', '-1', '2', '\x1b[A', '/dev/nvme0n1', 'HARDWARE-ID', '１', '10000']:
            self.assertIsNone(c.choose([self.row], value), value)
        self.assertEqual(c.choose([self.row], '1'), self.row)

    def test_terminal_metadata_cannot_inject_controls(self):
        value = c.safe('label\x1b[2J\n\u202econfirm')
        self.assertNotIn('\x1b', value)
        self.assertNotIn('\n', value)
        self.assertNotIn('\u202e', value)

    def test_back_and_invalid_disk_do_not_request_install(self):
        for inputs in [['1','0'], ['0'], ['\x1b[A'], ['4']]:
            calls = self.run_ui(inputs)
            self.assertNotIn('INSTALL', [op for op, args in calls])

    def test_approval_binds_backend_selection_without_manual_serial(self):
        calls = self.run_ui(['1', '1'])
        self.assertIn(('INSTALL', ('ticket', 'HARDWARE-ID', 'ERASE')), calls)

    def run_ui(self, inputs):
        calls = []
        def rpc(op, *args):
            calls.append((op, args))
            return {'STATUS':{'phase':'idle'}, 'LIST':{'devices':[self.row], 'rawBytes':100},
                    'SELECT':{'target':self.row, 'ticket':'ticket'}, 'INSTALL':{}}[op]
        with tempfile.TemporaryDirectory() as temp:
            info=Path(temp)/'info.json';info.write_text(json.dumps({'version':'0.7.2','buildId':'a'*64,'nixos':'test','nix':'test'}))
            with patch.dict(c.os.environ, {'OTEHON_INSTALLER_INFO':str(info)}), patch.object(c,'rpc',side_effect=rpc), \
                 patch.object(c,'observe'), patch('builtins.input',side_effect=[*inputs,Stop()]), patch('sys.stdout',new=io.StringIO()):
                with self.assertRaises(Stop): c.main()
        return calls

    def test_json_observer_preserves_japanese_and_edn_remains_default(self):
        a, z = socket.socketpair()
        with a,z:
            self.assertTrue(b.send_response(z, {'ok':True,'value':'保存先'}, as_json=True))
            self.assertEqual(json.loads(a.recv(4096))['value'],'保存先')
            self.assertTrue(b.send_response(z, {'ok':True,'value':'保存先'}))
            self.assertTrue(a.recv(4096).startswith(b'{"ok" true'))
