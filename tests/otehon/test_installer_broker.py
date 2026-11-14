"""Fixed protocol / admission negative controls; no real device or root access."""
import base64
import importlib.util
from pathlib import Path
import tempfile
import hashlib
import os
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('broker', Path(__file__).parents[2]/'nixos/otehon/installer-broker.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)

class Protocol(unittest.TestCase):
    def test_bounded_fixed_operations(self):
        self.assertEqual(b.decode(b'STATUS\n'), ('STATUS', []))
        self.assertEqual(b.decode(b'SELECT\t'+base64.b64encode(b'target')+b'\n'), ('SELECT',['target']))
        for bad in [b'EXEC\n',b'STATUS\tx\n',b'SELECT\t!!!!\n',b'SELECT\tCg==\n',b'LIST',b'x'*4097+b'\n']:
            with self.subTest(bad=bad[:30]), self.assertRaises(b.Refused): b.decode(bad)
    def test_admission_refuses_unsafe_targets(self):
        good={'id':'x','size':101,'ambiguous':False,'used':False,'readOnly':False,'serial':'EXACT'}
        self.assertEqual(b.admit([good],'x',100),good)
        for mutation in [{'used':True},{'readOnly':True},{'ambiguous':True},{'size':100},{'id':'changed'}]:
            with self.subTest(mutation=mutation), self.assertRaises(b.Refused): b.admit([{**good,**mutation}],'x',100)
        with self.assertRaises(b.Refused): b.admit([good,good],'x',100)
    def test_ticket_and_exact_approval_and_replay(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp); (d/'image').write_text('a'*64);(d/'raw').write_text('b'*64);(d/'bytes').write_text('100')
            broker=b.Broker(d,d)
            good={'id':'x','size':101,'ambiguous':False,'used':False,'readOnly':False,'serial':'EXACT'}
            with patch.object(b,'inventory',return_value=[good]),patch.object(b.threading.Thread,'start'):
                selected=broker.select('x')
                for args in [('wrong','EXACT','ERASE'),(selected['ticket'],'wrong','ERASE'),(selected['ticket'],'EXACT','erase')]:
                    with self.assertRaises(b.Refused): broker.begin(*args)
                self.assertEqual(broker.state['phase'],'idle')
                broker.begin(selected['ticket'],'EXACT','ERASE')
                self.assertEqual(broker.state['phase'],'verify')
                with self.assertRaises(b.Refused): broker.begin(selected['ticket'],'EXACT','ERASE')
                broker.dispatch('CANCEL',[]); self.assertTrue(broker.cancel.is_set())
                broker.state.update(phase='write',writeStarted=True)
                for op in ['CANCEL','REBOOT','POWEROFF','TEXT']:
                    with self.assertRaises(b.Refused): broker.dispatch(op,[])
    def test_interrupted_write_is_never_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);(d/'image').write_text('a'*64);(d/'raw').write_text('b'*64);(d/'bytes').write_text('100')
            (d/'state.json').write_text('{"phase":"readback","writeStarted":true}')
            state=b.Broker(d,d).snapshot()
            self.assertEqual(state['phase'],'failed');self.assertTrue(state['writeStarted'])

class FailureBoundary(unittest.TestCase):
    def test_corrupt_source_never_opens_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);source=d/'payload';source.write_bytes(b'corrupt')
            (d/'image').write_text('a'*64);(d/'raw').write_text('b'*64);(d/'bytes').write_text('100')
            broker=b.Broker(d,d)
            with patch.object(b,'SOURCE',source),patch.object(b,'LOCK',d/'lock'),patch.object(b,'command',side_effect=['iso9660','ro']),patch.object(b.os,'open',wraps=os.open) as opened:
                broker.install({'id':'x'})
                self.assertEqual(opened.call_count,1) # Source only, no target open.
            self.assertEqual(broker.state['error'],'image-digest-mismatch')
            self.assertFalse(broker.state['writeStarted'])
    def test_first_destructive_operation_failure_is_partial(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);source=d/'payload';source.write_bytes(b'valid compressed fixture')
            target=d/'fake-target';target.write_bytes(b'preserved')
            (d/'image').write_text(hashlib.sha256(source.read_bytes()).hexdigest());(d/'raw').write_text('b'*64);(d/'bytes').write_text('100')
            broker=b.Broker(d,d)
            row={'id':'x','path':str(target),'size':101,'rdev':123,'used':False,'readOnly':False,'ambiguous':False}
            original_fstat=os.fstat
            def fstat(fd):
                info=original_fstat(fd)
                return SimpleNamespace(st_mode=stat.S_IFBLK,st_rdev=123) if info.st_ino==target.stat().st_ino else info
            with patch.object(b,'SOURCE',source),patch.object(b,'LOCK',d/'lock'),patch.object(b,'command',side_effect=['iso9660','ro']),patch.object(b,'inventory',return_value=[row]),patch.object(b.os,'fstat',side_effect=fstat),patch.object(b.subprocess,'run',side_effect=OSError('fixture write failure')):
                broker.install(row)
            self.assertEqual(broker.state['phase'],'failed');self.assertTrue(broker.state['writeStarted'])
            self.assertEqual(target.read_bytes(),b'preserved')

if __name__=='__main__': unittest.main()
