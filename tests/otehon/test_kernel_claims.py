import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

root=Path(__file__).parents[2]
def load(name,file):
 spec=importlib.util.spec_from_file_location(name,root/'nixos/otehon'/file)
 value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
k=load('claims','installer-kernel-claims.py');b=load('claim_broker','installer-broker.py')

class Claims(unittest.TestCase):
 def test_only_fixed_pid_device_filtered_read_probes_are_generated(self):
  source=k.program(123,[259<<20])
  self.assertIn('pid == 123',source);self.assertIn('$b->bd_dev == 271581184',source)
  self.assertIn('kprobe:bdev_open',source);self.assertIn('interval:s:2',source)
  for forbidden in ('system(', 'override(', 'signal(', 'bpf_probe_write', 'ustack(', 'path('):self.assertNotIn(forbidden,source)
  for pid,devices in [(0,[1]),(1,[]),(1,[1]*5),(1,[-1])]:
   with self.assertRaises(AssertionError):k.program(pid,devices)
 def test_parser_returns_symbol_metadata_but_no_kernel_addresses(self):
  target={};devices={7:target}
  k.parse('BDEV 7 1 2 3 0 1 9\nOPS 7 fs_holder_ops\nFS 7 ext4\nKIND 7 filesystem\nFILE 7 128 0\nRETURN 7 -16\n',devices)
  self.assertEqual(target['kernel']['holderKind'],'filesystem');self.assertEqual(target['kernel']['holderFileFlags'],128)
  self.assertEqual(target['kernel']['fileSystem'],'ext4');self.assertEqual(target['kernel']['returnCode'],-16)
  k.parse('OPS 7 0xffff123456789abc\n',devices)
  self.assertEqual(target['kernel']['holderOps'],'unknown');self.assertNotIn('0xffff',str(target))
 def test_unsupported_paths_and_count_do_not_start_tracer(self):
  with patch.object(k.subprocess,'Popen') as process:
   self.assertFalse(k.inspect([])['available'])
   self.assertFalse(k.inspect([{'path':'/etc/shadow','majorMinor':'1:1','id':'x'}])['available'])
   process.assert_not_called()
 def test_fixed_operation_disabled_by_default_and_refused_while_writing(self):
  self.assertEqual(b.decode(b'KERNEL_INSPECT\n'),('KERNEL_INSPECT',[]))
  with self.assertRaises(b.Refused):b.decode(b'KERNEL_INSPECT\tL2V0Yy9zaGFkb3c=\n')
  with tempfile.TemporaryDirectory() as temp,patch.dict(os.environ,{},clear=True):
   path=Path(temp)
   for name,value in [('image','a'*64),('raw','b'*64),('bytes','1')]: (path/name).write_text(value)
   broker=b.Broker(path,path)
   with patch.object(b.subprocess,'Popen') as process:
    self.assertEqual(broker.dispatch('KERNEL_INSPECT',[])['reason'],'disabled')
    broker.state['phase']='write'
    self.assertEqual(broker.dispatch('KERNEL_INSPECT',[])['reason'],'install-in-progress')
    process.assert_not_called()
   broker=b.Broker(path,path,read_only=True)
   with self.assertRaises(b.Refused):broker.dispatch('KERNEL_INSPECT',[])
