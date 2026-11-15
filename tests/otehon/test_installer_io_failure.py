import errno
import importlib.util
import io
import hashlib
import json
import os
from pathlib import Path
import stat
import struct
import tempfile
from contextlib import ExitStack
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('io_broker',Path(__file__).parents[2]/'nixos/otehon/installer-broker.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)

class Faults(unittest.TestCase):
    def test_source_and_target_failures_keep_errno_and_write_boundary(self):
        for operation,number,written in [('source-open',errno.EIO,False),('source-read',errno.EIO,False),
                                        ('target-open',errno.EBUSY,False),('target-sector-size',errno.EINVAL,False),
                                        ('target-write',errno.EIO,True),('target-sync',errno.ENOSPC,True),
                                        ('target-cache-flush',errno.EIO,True),('target-readback',errno.EIO,True)]:
            with self.subTest(operation=operation),tempfile.TemporaryDirectory() as tmp:
                d=Path(tmp);source=d/'payload';source.write_bytes(b'compressed')
                target=d/'target';original=b'preserved'*512;target.write_bytes(original);raw=b'OS fixture bytes'
                for name,value in [('image',hashlib.sha256(source.read_bytes()).hexdigest()),('raw',hashlib.sha256(raw).hexdigest()),('bytes',str(len(raw)))]: (d/name).write_text(value)
                broker=b.Broker(d,d)
                row={'id':'disk','path':str(target),'serial':'EXACT','size':len(original),'rdev':123,'used':False,'readOnly':False,'ambiguous':False}
                fs=os.fstat;opened=os.open;write=os.write;read=os.read;sync=os.fsync;fdopen=os.fdopen
                inode=target.stat().st_ino
                writes=0
                def is_target(fd):return fs(fd).st_ino==inode
                def fstat(fd):return SimpleNamespace(st_mode=stat.S_IFBLK,st_rdev=123) if is_target(fd) else fs(fd)
                def fail():raise OSError(number,os.strerror(number))
                def open_fd(path,*args,**kwargs):
                    if (operation=='source-open' and path==source) or (operation=='target-open' and str(path)==str(target)):fail()
                    return opened(path,*args,**kwargs)
                def write_fd(fd,data):
                    nonlocal writes
                    if operation=='target-write' and is_target(fd):
                        writes+=1
                        if writes>1:fail()
                        return write(fd,data[:4])
                    return write(fd,data)
                def sync_fd(fd):
                    if operation=='target-sync' and is_target(fd):fail()
                    return sync(fd)
                def read_fd(fd,count):
                    if operation=='target-readback' and is_target(fd):fail()
                    return read(fd,count)
                def ioctl(fd,op,*args):
                    if op==0x1268 and operation=='target-sector-size':fail()
                    if op==0x1261 and operation=='target-cache-flush':fail()
                    return struct.pack('I',512) if op==0x1268 else 0
                class SourceRead:
                    def __init__(self,stream):self.stream=stream;self.first=True
                    def __enter__(self):return self
                    def __exit__(self,*args):self.stream.close()
                    def fileno(self):return self.stream.fileno()
                    def read(self,count):
                        if not self.first:fail()
                        self.first=False;return self.stream.read(4)
                def open_stream(fd,*args,**kwargs):
                    stream=fdopen(fd,*args,**kwargs)
                    return SourceRead(stream) if operation=='source-read' else stream
                process=SimpleNamespace(stdout=io.BytesIO(raw),wait=lambda:0,poll=lambda:0)
                with ExitStack() as stack:
                    for obj,name,value in [(b,'SOURCE',source),(b,'LOCK',d/'lock'),(b,'inventory',lambda:[row]),
                                           (b,'boot_check',lambda:None),(b.os,'fstat',fstat),(b.os,'open',open_fd),
                                           (b.os,'write',write_fd),(b.os,'read',read_fd),(b.os,'fsync',sync_fd),(b.os,'fdopen',open_stream),(b.fcntl,'ioctl',ioctl)]:stack.enter_context(patch.object(obj,name,value))
                    stack.enter_context(patch.object(b,'command',side_effect=['iso9660','ro']))
                    stack.enter_context(patch.object(b.subprocess,'Popen',return_value=process))
                    stack.enter_context(patch.object(b.subprocess,'run',return_value=SimpleNamespace(stdout=json.dumps({'bootEntry':'Awai Otehon','bootNumber':'0001'}))))
                    broker.install(row)
                self.assertEqual(broker.state['phase'],'failed')
                diagnostic=broker.state['diagnostic'];self.assertEqual(diagnostic['operation'],operation)
                self.assertEqual(diagnostic['errno'],number);self.assertEqual(diagnostic['errnoName'],errno.errorcode[number])
                self.assertEqual(broker.state['writeStarted'],written)
                if operation=='source-read':self.assertEqual(diagnostic['done'],4)
                if not written:self.assertEqual(target.read_bytes(),original)
                if operation=='target-write':self.assertEqual(target.read_bytes()[:4],raw[:4])
                for action in ['REBOOT','POWEROFF']:
                    with self.assertRaises(b.Refused):broker.dispatch(action,[])
                self.assertEqual(b.Broker(d,d).state['diagnostic'],diagnostic)

    def test_diagnostic_excludes_filename_and_terminal_controls(self):
        error=OSError(errno.EIO,'device\x1b[2J\nfailure','/private/secret')
        result=b.failure_diagnostic(error,'source-read',{'phase':'verify'})
        text=json.dumps(result)
        self.assertNotIn('/private/secret',text);self.assertNotIn('\x1b',result['detail']);self.assertNotIn('\n',result['detail'])
