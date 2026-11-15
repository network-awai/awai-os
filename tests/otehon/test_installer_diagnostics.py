import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('diagnostics', Path(__file__).parents[2] / 'nixos/otehon/installer-diagnostics.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)


class Diagnostics(unittest.TestCase):
    def test_actual_socket_only_asks_for_status_and_inventory(self):
        with tempfile.TemporaryDirectory() as temp:
            path = str(Path(temp) / 'control.sock')
            received = []
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
                server.bind(path)
                server.listen(2)
                server.settimeout(3)
                def serve():
                    for _ in range(2):
                        conn, _ = server.accept()
                        with conn:
                            line = conn.makefile('rb').readline()
                            received.append(line)
                            value = {'readOnly': True} if line == b'JSON\tSTATUS\n' else {'devices': []}
                            conn.sendall(json.dumps({'ok': True, 'value': value}).encode() + b'\n')
                thread = threading.Thread(target=serve)
                thread.start()
                with patch.object(d, 'SOCKET', path):
                    self.assertTrue(d.broker('STATUS')['readOnly'])
                    self.assertEqual(d.broker('LIST')['devices'], [])
                    with self.assertRaises(ValueError): d.broker('INSTALL')
                thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertEqual(received, [b'JSON\tSTATUS\n', b'JSON\tLIST\n'])

    def test_refuses_non_diagnostic_broker_and_does_not_return_logs(self):
        with tempfile.TemporaryDirectory() as temp:
            info = Path(temp) / 'info.json'
            info.write_text('{}')
            output = io.StringIO()
            with patch.dict(os.environ, {'OTEHON_INSTALLER_INFO': str(info)}), \
                 patch.object(d, 'broker', return_value={'readOnly': False}), \
                 patch.object(d, 'journal') as journal, patch('sys.stdout', output):
                self.assertEqual(d.main(), 1)
            journal.assert_not_called()
            self.assertEqual(json.loads(output.getvalue())['error'], 'diagnostics-unavailable')

    def test_journal_transfer_is_bounded_and_fixed_command(self):
        class Result: stdout = b'x' * (d.MAX_LOG + 1)
        with patch.object(d.subprocess, 'run', return_value=Result()) as run:
            value = d.journal()
        self.assertEqual(len(value['text']), d.MAX_LOG)
        self.assertTrue(value['truncated'])
        self.assertIn('--unit=otehon-install-broker.service', run.call_args.args[0])
