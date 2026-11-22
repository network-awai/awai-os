#!/usr/bin/env python3
"""Check Murakumo's native libraries against native-pins.json (PHI rule, text engine).

  verify-native-pins.py [--dir DIR]       DIR/<abi>/*.so (default: the app's jniLibs)
  verify-native-pins.py --apk APK         lib/<abi>/*.so inside a built APK
  verify-native-pins.py --pins FILE ...   another pin file (the tests use this)
  verify-native-pins.py --write [--dir DIR]   rewrite native-pins.json from DIR (maintainers, after a reproduced build)

Every pinned library must be present with its SHA-256. The text-engine libraries must not import Android
logging, sockets or name resolution (read from the ELF dynamic symbol table, no NDK needed). The Rust
library and the image engine are reported as not pinned. Exit status 1 on any mismatch.
"""
import hashlib,json,pathlib,struct,sys,zipfile
app=pathlib.Path(__file__).resolve().parents[1]
# Imports no pinned library may have: Android logging, sockets and name resolution.
FORBIDDEN={'__android_log_print','__android_log_write','__android_log_vprint','__android_log_buf_write','__android_log_buf_print',
 '__android_log_assert','__android_log_write_log_message','socket','socketpair','connect','bind','listen','accept','accept4',
 'send','sendto','sendmsg','sendmmsg','recv','recvfrom','recvmsg','recvmmsg','getaddrinfo','gethostbyname','gethostbyname2',
 'gethostbyname_r','gethostbyaddr','getnameinfo','res_query','res_search','android_getaddrinfofornetwork'}
# Only the C++ runtime's terminate path writes an abort message (syslog and the tombstone). It runs on a
# crash, never on a normal request; engine.cpp catches every exception at the JNI boundary so that a
# failed request does not reach it. Allowed only in the two libraries that carry that code.
CRASH_ONLY={'syslog','openlog','closelog','vsyslog','android_set_abort_message'}
CRASH_ONLY_LIBS={'libc++_shared.so','libggml-base.so'}
# Libraries an APK may carry without a pin: the Rust app library (built by Tauri from this checkout's
# Cargo.lock; checked by check-release.py for devtools code) and the image engine, not reproducible yet.
UNPINNED={'libmurakumo_app_lib.so','libawai_diffusion.so'}

def undefined_symbols(data:bytes)->set:
 """Undefined dynamic symbols of a 64-bit little-endian ELF shared object."""
 if data[:4]!=b'\x7fELF' or data[4]!=2 or data[5]!=1:raise ValueError('not-elf64-le')
 shoff,=struct.unpack_from('<Q',data,0x28);shentsize,shnum=struct.unpack_from('<HH',data,0x3a)
 sections=[struct.unpack_from('<IIQQQQIIQQ',data,shoff+i*shentsize) for i in range(shnum)]
 names=set()
 for s in sections:
  if s[1]!=11:continue  # SHT_DYNSYM
  strtab=sections[s[6]];off,size,entsize=s[4],s[5],s[9] or 24
  for i in range(1,size//entsize):
   name,info,other,shndx,value,sz=struct.unpack_from('<IBBHQQ',data,off+i*entsize)
   if shndx==0 and name:
    end=data.index(b'\0',strtab[4]+name);names.add(data[strtab[4]+name:end].decode().split('@')[0])
 return names

def check(libs:dict,pins:dict,present_abis_only=False)->list:
 """libs: {abi: {name: bytes}}. Returns the list of failures (empty when everything matches).
 present_abis_only: check only the ABIs the input carries (an APK built for one target), at least one."""
 failures=[]
 abis={a:e for a,e in pins['abis'].items() if not present_abis_only or a in libs}
 if not abis:failures.append('no pinned ABI in the input')
 for abi,expected in abis.items():
  found=libs.get(abi,{})
  for name,sha in expected.items():
   if name not in found:failures.append(f'{abi}/{name}: missing');continue
   actual=hashlib.sha256(found[name]).hexdigest()
   if actual!=sha:failures.append(f'{abi}/{name}: sha256 {actual} != pinned {sha}')
   bad=undefined_symbols(found[name])&(FORBIDDEN|(set() if name in CRASH_ONLY_LIBS else CRASH_ONLY))
   if bad:failures.append(f'{abi}/{name}: forbidden imports {sorted(bad)}')
 for abi,found in libs.items():
  for name in found:
   if abi not in pins['abis'] or name not in pins['abis'][abi]:
    # In a shipped APK every native library is pinned, except the documented ones below.
    if present_abis_only and name not in UNPINNED:failures.append(f'{abi}/{name}: not pinned (add it to native-pins.json or UNPINNED with a reason)')
    else:print(f'not pinned: {abi}/{name}')
 return failures

def read_dir(d:pathlib.Path)->dict:
 return {a.name:{p.name:p.read_bytes() for p in sorted(a.glob('*.so'))} for a in sorted(d.iterdir()) if a.is_dir()} if d.is_dir() else {}

def read_apk(apk:pathlib.Path)->dict:
 out={}
 with zipfile.ZipFile(apk) as z:
  for n in z.namelist():
   parts=n.split('/')
   if len(parts)==3 and parts[0]=='lib' and parts[2].endswith('.so'):out.setdefault(parts[1],{})[parts[2]]=z.read(n)
 return out

def main(argv):
 opts={};i=0;flags=set()
 while i<len(argv):
  if argv[i] in('--dir','--apk','--pins'):opts[argv[i]]=argv[i+1];i+=2
  elif argv[i]=='--write':flags.add('write');i+=1
  else:raise SystemExit('usage: verify-native-pins.py [--dir DIR | --apk APK] [--pins FILE] [--write]')
 pin_file=pathlib.Path(opts.get('--pins',app/'native-pins.json'))
 libs=read_apk(pathlib.Path(opts['--apk'])) if '--apk' in opts else read_dir(pathlib.Path(opts.get('--dir',app/'src-tauri/gen/android/app/src/main/jniLibs')))
 if 'write' in flags:
  pins=json.loads(pin_file.read_text())
  pins['abis']={abi:{n:hashlib.sha256(b).hexdigest() for n,b in sorted(found.items()) if n!='libawai_diffusion.so'} for abi,found in sorted(libs.items())}
  pin_file.write_text(json.dumps(pins,indent=2)+'\n');print('wrote',pin_file);return 0
 failures=check(libs,json.loads(pin_file.read_text()),present_abis_only='--apk' in opts)
 for f in failures:print('FAIL',f)
 if not failures:print('native pins: all pinned libraries match')
 return 1 if failures else 0

if __name__=='__main__':raise SystemExit(main(sys.argv[1:]))
