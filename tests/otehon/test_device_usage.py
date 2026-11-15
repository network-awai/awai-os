import errno
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import socket
import threading
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('usage_broker',Path(__file__).parents[2]/'nixos/otehon/installer-broker.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class Usage(unittest.TestCase):
 def fixture(self,root):
  proc=root/'proc';proc.mkdir();sys=root/'sys';node=sys/'nvme0n1';(node/'holders').mkdir(parents=True)
  child=node/'nvme0n1p1';child.mkdir();(child/'partition').write_text('1');(child/'dev').write_text('259:1')
  for pid in ('10','20'):
   p=proc/pid;(p/'fd').mkdir(parents=True);(p/'fdinfo').mkdir();(p/'ns').mkdir()
   (p/'ns/mnt').symlink_to('mnt:[42]');(p/'comm').write_text('fixture-holder\n')
   (p/'mountinfo').write_text('7 1 259:1 / /private-fixture rw - ext4 /dev/nvme0n1p1 rw\n')
   (p/'fd/9').symlink_to('/private-fixture/never-disclose-this-file')
   (p/'fdinfo/9').write_text('flags:\t0100000\nmnt_id:\t7\n')
   (p/'fd/8').symlink_to('/dev/nvme0n1');(p/'fdinfo/8').write_text('flags:\t0100200\nmnt_id:\t2\n')
   (p/'cgroup').write_text('0::/system.slice/fixture.service\n')
   (p/'cmdline').write_text('private-command-argument');(p/'environ').write_text('private-env-value')
  return proc,sys,[{'id':'fixture','path':'/dev/nvme0n1','majorMinor':'259:0'}]
 def test_private_namespace_and_fd_metadata_without_payloads_or_writes(self):
  with tempfile.TemporaryDirectory() as temp:
   proc,sys,rows=self.fixture(Path(temp));original=Path.open
   def guarded(path,*a,**kw):
    self.assertNotIn(path.name,('cmdline','environ'))
    return original(path,*a,**kw)
   with patch.object(Path,'open',guarded),patch.object(b.os,'open',side_effect=OSError(errno.EBUSY,'busy')) as opening:
    result=b.device_usage(rows,proc,sys)
   self.assertTrue(result['readOnly']);self.assertEqual(result['namespaceViewsScanned'],1)
   device=result['devices'][0]
   self.assertEqual(len(device['mountNamespaceReferences']),1)
   self.assertEqual(len(device['openFdReferences']),4)
   self.assertEqual(device['exclusiveReadOnlyOpen']['errno'],errno.EBUSY)
   self.assertTrue(all(r['unit']=='fixture.service' for r in device['openFdReferences']))
   self.assertNotIn('never-disclose',json.dumps(result));self.assertNotIn('private-command',json.dumps(result));self.assertNotIn('private-env',json.dumps(result))
   flags=opening.call_args.args[1]
   self.assertEqual(flags & os.O_ACCMODE,os.O_RDONLY);self.assertTrue(flags & os.O_EXCL)
 def test_inspect_crosses_real_socket_decoder_and_dispatch(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   for name,value in [('image','a'*64),('raw','b'*64),('bytes','1')]: (root/name).write_text(value)
   broker=b.Broker(root,rundir=root,read_only=True)
   path=str(root/'control.sock')
   expected={'available':True,'readOnly':True,'devices':[]}
   with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as server:
    server.bind(path);server.listen(1);server.settimeout(3)
    def serve():
     conn,_=server.accept()
     with conn:
      request=conn.makefile('rb').readline()
      try:
       self.assertTrue(request.startswith(b'JSON\t'))
       op,args=b.decode(request[5:]);value=broker.dispatch(op,args)
       result={'ok':True,'value':value}
      except Exception as error:result={'ok':False,'error':type(error).__name__}
      conn.sendall(json.dumps(result).encode()+b'\n')
    with patch.object(b,'inventory',return_value=[]),patch.object(b,'device_usage',return_value=expected):
     thread=threading.Thread(target=serve);thread.start()
     with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
      client.settimeout(3);client.connect(path);client.sendall(b'JSON\tINSPECT\n')
      response=json.loads(client.makefile('rb').readline())
     thread.join(3)
    self.assertEqual(response,{'ok':True,'value':expected});self.assertFalse(thread.is_alive())
   with self.assertRaises(b.Refused):b.decode(b'INSPECT\tL2V0Yy9zaGFkb3c=\n')
 def test_zero_budget_marks_incomplete_and_never_probes_device(self):
  with tempfile.TemporaryDirectory() as temp:
   proc,sys,rows=self.fixture(Path(temp))
   with patch.object(b.os,'open') as opening:result=b.device_usage(rows,proc,sys,budget=0)
   self.assertTrue(result['truncated']);opening.assert_not_called()
 def test_inspection_has_fixed_arity_and_skips_active_writer(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   for name,value in [('image','a'*64),('raw','b'*64),('bytes','1')]: (root/name).write_text(value)
   broker=b.Broker(root,rundir=root,read_only=True)
   with patch.object(b,'inventory') as inv:
    with self.assertRaises(b.Refused):broker.dispatch('INSPECT',['/etc/shadow'])
    inv.assert_not_called()
   broker.state['phase']='write'
   with patch.object(b,'inventory') as inv:
    self.assertEqual(broker.dispatch('INSPECT',[])['reason'],'install-in-progress');inv.assert_not_called()
