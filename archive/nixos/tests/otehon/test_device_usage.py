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

spec=importlib.util.spec_from_file_location('usage_broker',Path(__file__).parents[2]/'otehon/installer-broker.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class Usage(unittest.TestCase):
 def fixture(self,root):
  proc=root/'proc';proc.mkdir();sys=root/'sys';node=sys/'nvme0n1';(node/'holders').mkdir(parents=True)
  (node/'dev').write_text('259:0')
  child=node/'nvme0n1p1';child.mkdir();(child/'partition').write_text('1');(child/'dev').write_text('259:1')
  (child/'holders').mkdir()
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
 def test_partition_mapper_graph_connects_owner_and_mount_without_uuid_or_paths(self):
  with tempfile.TemporaryDirectory() as temp:
   proc,sys,rows=self.fixture(Path(temp));mapper=sys/'dm-0';(mapper/'holders').mkdir(parents=True)
   (mapper/'dev').write_text('253:0');(mapper/'dm').mkdir()
   (mapper/'dm/name').write_text('previous--os-root');(mapper/'dm/uuid').write_text('LVM-private-uuid')
   (sys/'nvme0n1/nvme0n1p1/holders/dm-0').symlink_to(mapper)
   for pid in ('10','20'):
    (proc/pid/'mountinfo').write_text('7 1 253:0 / /private-fixture rw - ext4 /dev/mapper/previous--os-root rw\n')
   with patch.object(b.os,'open',side_effect=OSError(errno.EBUSY,'busy')): report=b.device_usage(rows,proc,sys)
   target=report['devices'][0];edge=target['holderGraph'][0]
   self.assertEqual(edge['sourceMajorMinor'],'259:1');self.assertEqual(edge['majorMinor'],'253:0')
   self.assertEqual(edge['mapperKind'],'LVM');self.assertEqual(edge['mapperName'],'previous--os-root')
   self.assertEqual(target['mountNamespaceReferences'][0]['majorMinor'],'253:0')
   self.assertNotIn('private-fixture',json.dumps(report));self.assertNotIn('private-uuid',json.dumps(report))
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

 def test_anonymous_filesystem_source_and_swap_match_without_paths(self):
  with tempfile.TemporaryDirectory() as temp:
   proc,sys,rows=self.fixture(Path(temp))
   for pid in ('10','20'):
    (proc/pid/'mountinfo').write_text('7 1 0:33 / /private-fixture rw - btrfs /dev/nvme0n1 rw\n')
   (proc/'swaps').write_text('Filename Type Size Used Priority\n/dev/nvme0n1 partition 1 0 -2\n')
   with patch.object(b.os,'open',side_effect=OSError(errno.EBUSY,'busy')):
    result=b.device_usage(rows,proc,sys)
   target=result['devices'][0]
   self.assertEqual(target['mountNamespaceReferences'][0]['fsType'],'btrfs')
   self.assertEqual(target['swapReferences'],[{'type':'partition'}])
   self.assertNotIn('private-fixture',json.dumps(result))
 def test_loop_backing_device_ioctl_without_disclosing_filename(self):
  with tempfile.TemporaryDirectory() as temp:
   proc,sys,rows=self.fixture(Path(temp));(sys/'loop7').mkdir()
   payload=b.struct.pack('=QQQ',5,0,66304)+bytes(208)
   def opening(path,flags):
    self.assertEqual(flags & os.O_ACCMODE,os.O_RDONLY)
    if path=='/dev/loop7':return 77
    raise OSError(errno.EBUSY,'busy')
   with patch.object(b.os,'open',side_effect=opening),patch.object(b.os,'close') as closing,patch.object(b.fcntl,'ioctl',return_value=payload) as ioctl:
    result=b.device_usage(rows,proc,sys)
   self.assertEqual(result['devices'][0]['loopReferences'],[{'device':'loop7'}])
   ioctl.assert_called_once_with(77,0x4C05,bytes(232));closing.assert_called_once_with(77)

 def test_loop_inspection_unavailable_refuses_instead_of_reporting_empty(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);(root/'loop0').mkdir()
   with patch.object(b.os,'open',side_effect=OSError(errno.EACCES,'blocked')):
    with self.assertRaisesRegex(b.Refused,'loop-inspection-unavailable'):b.loop_backing_references(root)
