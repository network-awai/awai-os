#!/usr/bin/env python3
"""Release-only rule for medical use of Murakumo (PHI rule, item 5).

A debug build turns on WebView devtools (CDP, wry main_pipe.rs:254, cfg(debug_assertions)) and copies
console.* into logcat (wry RustWebChromeClient.kt:462 through Logger, gated by BuildConfig.DEBUG). Only a
release build may be handed to karute or any other medical caller.

  check-release.py --source                       the release configuration in this checkout
  check-release.py --apk APK                       a built APK: not debuggable, not testOnly, no devtools
                                                   code in the Rust library, native libraries as pinned
  check-release.py --catalog RAW [--assets DIR]    a Store catalog: every medical package it lists must
                                                   point at an APK that passes --apk (DIR holds the assets)

Exit status 1 on any failure. Nothing is installed, signed or published.
"""
import json,pathlib,re,struct,subprocess,sys,zipfile
app=pathlib.Path(__file__).resolve().parents[1]
MEDICAL={'network.awai.murakumo','network.itonami.karute'}
REVIEWED={'tauri':'3.0.0-alpha.6','wry':'0.57.2','tauri-runtime-wry':'3.0.0-alpha.6'}
DEBUGGABLE,TEST_ONLY=0x0101000f,0x01010272

def source_failures(base=app)->list:
 f=[]
 gradle=(base/'src-tauri/gen/android/app/build.gradle.kts').read_text()
 m=re.search(r'getByName\("release"\)\s*\{(.*?)\n        \}',gradle,re.S)
 if not m:f.append('gradle: no release buildType')
 elif re.search(r'is(?:Jni)?Debuggable\s*=\s*true|isTestOnly|debuggable\s*true',m.group(1)):f.append('gradle: release buildType is debuggable')
 manifest=(base/'src-tauri/gen/android/app/src/main/AndroidManifest.xml').read_text()
 if re.search(r'android:(?:debuggable|testOnly)\s*=\s*"true"',manifest):f.append('manifest: debuggable or testOnly')
 cargo=(base/'src-tauri/Cargo.toml').read_text()
 if 'devtools' in cargo:f.append('Cargo.toml: devtools feature (keeps CDP on in release)')
 conf=json.loads((base/'src-tauri/tauri.conf.json').read_text())
 if any(w.get('devtools') for w in conf.get('app',{}).get('windows',[])):f.append('tauri.conf.json: devtools window')
 lock=(base/'src-tauri/Cargo.lock').read_text()
 for name,version in REVIEWED.items():
  if not re.search(r'name = "%s"\nversion = "%s"\n'%(re.escape(name),re.escape(version)),lock):
   f.append(f'Cargo.lock: {name} is not the reviewed {version} (re-check its devtools and console gates)')
 java=base/'src-tauri/gen/android/app/src/main/java'
 for p in java.rglob('*'):
  if p.suffix in('.kt','.java') and 'setWebContentsDebuggingEnabled' in p.read_text():f.append(f'{p.name}: enables WebView debugging')
 return f

def axml_application_flags(data:bytes)->dict:
 """debuggable / testOnly on <application> in a binary AndroidManifest.xml."""
 strings=[];resmap=[];pos=8;flags={}
 while pos<len(data):
  ctype,hsize,size=struct.unpack_from('<HHI',data,pos)
  if ctype==0x0001:  # string pool
   count,_,flag,sstart,_=struct.unpack_from('<IIIII',data,pos+8);utf8=flag&0x100
   offs=struct.unpack_from('<%dI'%count,data,pos+hsize);base=pos+sstart
   for o in offs:
    p=base+o
    if utf8:
     n=data[p];p+=2 if n&0x80 else 1;n=data[p];p+=1
     if n&0x80:n=((n&0x7f)<<8)|data[p];p+=1
     strings.append(data[p:p+n].decode('utf-8','replace'))
    else:
     n,=struct.unpack_from('<H',data,p);p+=2
     if n&0x8000:n=((n&0x7fff)<<16)|struct.unpack_from('<H',data,p)[0];p+=2
     strings.append(data[p:p+2*n].decode('utf-16le','replace'))
  elif ctype==0x0180:resmap=list(struct.unpack_from('<%dI'%((size-hsize)//4),data,pos+hsize))
  elif ctype==0x0102:
   _,name,astart,asize,acount=struct.unpack_from('<IIHHH',data,pos+16)
   if strings[name]=='application':
    for i in range(acount):
     a=pos+16+astart+i*asize;_,aname,_,_,_,dtype,value=struct.unpack_from('<IIIHBBI',data,a)
     rid=resmap[aname] if aname<len(resmap) else None
     if rid in(DEBUGGABLE,TEST_ONLY):flags['debuggable' if rid==DEBUGGABLE else 'testOnly']=dtype==0x12 and value!=0
  pos+=size if ctype!=0x0003 else hsize
 return flags

def apk_failures(apk:pathlib.Path,check_pins=True)->list:
 f=[]
 with zipfile.ZipFile(apk) as z:
  flags=axml_application_flags(z.read('AndroidManifest.xml'))
  if flags.get('debuggable'):f.append('APK is debuggable (debug build: devtools and console forwarding on)')
  if flags.get('testOnly'):f.append('APK is testOnly')
  for n in z.namelist():
   if re.fullmatch(r'lib/[^/]+/libmurakumo_app_lib\.so',n) and b'setWebContentsDebuggingEnabled' in z.read(n):
    f.append(f'{n}: WebView devtools code is compiled in (debug_assertions or the devtools feature)')
 if check_pins:
  r=subprocess.run([sys.executable,str(app/'scripts/verify-native-pins.py'),'--apk',str(apk)],capture_output=True,text=True)
  if r.returncode:f+=[l[5:] for l in r.stdout.splitlines() if l.startswith('FAIL ')] or ['native pins: verification failed']
 return f

def catalog_failures(raw,assets=None)->list:
 f=[];catalog=json.loads(raw.read_text())
 for entry in catalog.get('apps',[]):
  if entry.get('id') not in MEDICAL:continue
  for art in entry.get('artifacts',[]):
   if art.get('kind')!='apk':continue
   apk=(assets or raw.parent)/art['asset']
   if not apk.is_file():f.append(f"{entry['id']}: {art['asset']} not found, cannot prove it is a release build");continue
   f+=[f"{entry['id']}: {x}" for x in apk_failures(apk)]
 return f

def main(argv):
 if argv==['--source']:failures=source_failures()
 elif len(argv)==2 and argv[0]=='--apk':failures=apk_failures(pathlib.Path(argv[1]))
 elif argv[:1]==['--catalog'] and len(argv) in(2,4):failures=catalog_failures(pathlib.Path(argv[1]),pathlib.Path(argv[3]) if len(argv)==4 and argv[2]=='--assets' else None)
 else:raise SystemExit(__doc__)
 for x in failures:print('FAIL',x)
 if not failures:print('release check passed:',' '.join(argv))
 return 1 if failures else 0

if __name__=='__main__':raise SystemExit(main(sys.argv[1:]))
