import importlib.util
import io
import json
from pathlib import Path
import socket
import tempfile
import threading
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

    def test_failed_screen_includes_japanese_operation_and_write_boundary(self):
        state={'error':'target-sync: OSError: ENOSPC (28)', 'done':8, 'total':16,
               'writeStarted':True, 'diagnostic':{'operation':'target-sync'}}
        lines='\n'.join(c.diagnostic_lines(state))
        self.assertIn('NVMe の書込みを同期',lines)
        self.assertIn('ENOSPC (28)',lines)
        self.assertIn('書込み開始済み',lines)
        state['writeStarted']=False
        self.assertIn('書込みを開始していません','\n'.join(c.diagnostic_lines(state)))

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

    def test_disconnect_before_confirmation_exits_without_install(self):
        for inputs in ([EOFError()], ['1', EOFError()]):
            calls = []
            def rpc(op, *args):
                calls.append(op)
                return {'STATUS': {'phase': 'idle'},
                        'LIST': {'devices': [self.row], 'rawBytes': 100},
                        'SELECT': {'target': self.row, 'ticket': 'ticket'}}[op]
            with tempfile.TemporaryDirectory() as temp:
                info = Path(temp) / 'info.json'
                info.write_text(json.dumps({'version':'test','buildId':'a'*64,'nixos':'test','nix':'test'}))
                with patch.dict(c.os.environ, {'OTEHON_INSTALLER_INFO': str(info)}), \
                     patch.object(c, 'rpc', side_effect=rpc), \
                     patch('builtins.input', side_effect=inputs), patch('sys.stdout', new=io.StringIO()):
                    c.main()
            self.assertNotIn('INSTALL', calls)

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

    def test_console_json_request_uses_bounded_existing_operation_decoder(self):
        with tempfile.TemporaryDirectory() as temp:
            path=str(Path(temp)/'control.sock')
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
                server.bind(path);server.listen(1);server.settimeout(3)
                received=[]
                def answer():
                    connection,_=server.accept()
                    with connection:
                        data=connection.makefile('rb').readline(4098)
                        self.assertTrue(data.startswith(b'JSON\t'))
                        received.append(b.decode(data[5:]))
                        b.send_response(connection,{'ok':True,'value':{'message':'保存先を確認'}},True)
                thread=threading.Thread(target=answer);thread.start()
                with patch.object(c,'SOCKET',path):
                    self.assertEqual(c.rpc('SELECT','disk-identity')['message'],'保存先を確認')
                thread.join(timeout=3);self.assertFalse(thread.is_alive())
                self.assertEqual(received,[('SELECT',['disk-identity'])])
