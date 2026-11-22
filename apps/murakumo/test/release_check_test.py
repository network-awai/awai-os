#!/usr/bin/env python3
"""Tests for scripts/check-release.py and scripts/verify-native-pins.py, with negative controls.

Synthetic APKs only (aapt2 from the Android SDK). Set REQUIRE_ANDROID_SDK=1 to fail instead of skip
when aapt2 or android.jar is missing (CI does). Run: python3 -m unittest apps/murakumo/test/release_check_test.py
"""
import importlib.util,json,os,pathlib,shutil,subprocess,tempfile,unittest,zipfile
app=pathlib.Path(__file__).resolve().parents[1];repo=app.parents[1]
def load(name):
 spec=importlib.util.spec_from_file_location(name.replace('-','_'),app/'scripts'/f'{name}.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
release=load('check-release');pins=load('verify-native-pins')

def sdk():
 home=pathlib.Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or pathlib.Path.home()/'Library/Android/sdk')
 tools=sorted(home.glob('build-tools/*/aapt2'));jars=sorted(home.glob('platforms/android-3*/android.jar'))
 return (tools[-1],jars[-1]) if tools and jars else (None,None)
AAPT2,ANDROID_JAR=sdk()
need_sdk=unittest.skipUnless(AAPT2 or os.environ.get('REQUIRE_ANDROID_SDK')=='1','Android SDK (aapt2, android.jar) not found')

class Source(unittest.TestCase):
 def copy(self):
  d=pathlib.Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,d)
  for rel in ['src-tauri/gen/android/app/build.gradle.kts','src-tauri/gen/android/app/src/main/AndroidManifest.xml','src-tauri/Cargo.toml','src-tauri/tauri.conf.json','src-tauri/Cargo.lock']:
   (d/rel).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(app/rel,d/rel)
  shutil.copytree(app/'src-tauri/gen/android/app/src/main/java',d/'src-tauri/gen/android/app/src/main/java');return d
 def edit(self,d,rel,old,new):
  p=d/rel;s=p.read_text();self.assertIn(old,s);p.write_text(s.replace(old,new,1))
 def test_tree_is_release_only(self):self.assertEqual(release.source_failures(),[])
 def test_negative_controls(self):
  cases=[('src-tauri/gen/android/app/build.gradle.kts','getByName("release") {','getByName("release") {\n            isDebuggable = true','debuggable'),
   ('src-tauri/Cargo.toml','features = []','features = ["devtools"]','devtools'),
   ('src-tauri/tauri.conf.json','"label": "main",','"label": "main", "devtools": true,','devtools'),
   ('src-tauri/gen/android/app/src/main/AndroidManifest.xml','<application','<application android:debuggable="true"','debuggable'),
   ('src-tauri/gen/android/app/src/main/java/network/awai/murakumo/MainActivity.kt','enableEdgeToEdge();','android.webkit.WebView.setWebContentsDebuggingEnabled(true);enableEdgeToEdge();','WebView debugging'),
   ('src-tauri/Cargo.lock','name = "wry"\nversion = "0.57.2"','name = "wry"\nversion = "0.57.3"','reviewed')]
  for rel,old,new,word in cases:
   with self.subTest(rel=rel,word=word):
    d=self.copy();self.edit(d,rel,old,new);f=release.source_failures(d);self.assertTrue(any(word in x for x in f),f)

@need_sdk
class Apk(unittest.TestCase):
 def apk(self,attrs='',libs=None):
  self.assertIsNotNone(AAPT2,'REQUIRE_ANDROID_SDK=1 but aapt2/android.jar missing')
  d=pathlib.Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,d)
  (d/'M.xml').write_text(f'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="network.awai.murakumo"><application android:label="Synthetic" {attrs}/></manifest>')
  subprocess.run([str(AAPT2),'link','--manifest',str(d/'M.xml'),'-I',str(ANDROID_JAR),'-o',str(d/'a.apk')],check=True)
  with zipfile.ZipFile(d/'a.apk','a') as z:
   for name,data in (libs or {}).items():z.writestr(name,data)
  return d/'a.apk'
 def test_release_manifest_passes(self):
  self.assertEqual(release.apk_failures(self.apk(),check_pins=False),[])
  self.assertEqual(release.apk_failures(self.apk('android:debuggable="false"'),check_pins=False),[])
 def test_negative_controls(self):
  for attrs,libs,word in [('android:debuggable="true"',None,'debuggable'),('android:testOnly="true"',None,'testOnly'),
    ('',{'lib/arm64-v8a/libmurakumo_app_lib.so':b'\x7fELF...setWebContentsDebuggingEnabled...'},'devtools')]:
   with self.subTest(word=word):f=release.apk_failures(self.apk(attrs,libs),check_pins=False);self.assertTrue(any(word in x for x in f),f)
 def test_apk_without_pinned_native_libraries_fails(self):
  f=release.apk_failures(self.apk());self.assertTrue(any('native pins' in x or 'pinned ABI' in x for x in f),f)
 def test_catalog_with_medical_debug_apk_fails(self):
  d=pathlib.Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,d);(d/'packages').mkdir()
  shutil.copyfile(self.apk('android:debuggable="true"'),d/'packages/karute.apk');shutil.copyfile(self.apk('android:debuggable="true"'),d/'packages/yotei.apk')
  art=lambda a:[{'platform':'android','kind':'apk','asset':a,'sha256':'0'*64}]
  raw=d/'raw.json';raw.write_text(json.dumps({'apps':[{'id':'network.itonami.yotei','artifacts':art('packages/yotei.apk')},{'id':'network.itonami.karute','artifacts':art('packages/karute.apk')}]}))
  f=release.catalog_failures(raw,d);self.assertTrue(f and all(x.startswith('network.itonami.karute') for x in f),f)
  raw.write_text(json.dumps({'apps':[{'id':'network.awai.murakumo','artifacts':art('packages/missing.apk')}]}))
  self.assertTrue(any('not found' in x for x in release.catalog_failures(raw,d)),'a missing medical APK fails closed')

class Catalogs(unittest.TestCase):
 def test_committed_store_catalogs_carry_no_unproven_medical_apk(self):
  raws=sorted((repo/'store/distribution').glob('*/catalog-rev*-raw.json'));self.assertTrue(raws)
  for raw in raws:
   with self.subTest(raw=raw.parent.name):self.assertEqual(release.catalog_failures(raw,None),[])

class NativePins(unittest.TestCase):
 def test_pin_file_covers_both_abis_and_the_engine(self):
  p=json.loads((app/'native-pins.json').read_text());self.assertEqual(set(p['abis']),{'arm64-v8a','x86_64'})
  self.assertEqual(p['engine'],json.loads((app/'pins.json').read_text())['engine']['revision'])
  for libs in p['abis'].values():self.assertIn('libawai_llama.so',libs);self.assertTrue(all(len(h)==64 for h in libs.values()))
 def test_negative_controls(self):
  libs=pathlib.Path(os.environ.get('MURAKUMO_NATIVE_DIR',app/'src-tauri/gen/android/app/src/main/jniLibs'))
  p=json.loads((app/'native-pins.json').read_text());found=pins.read_dir(libs)
  if pins.check(found,p):
   if os.environ.get('MURAKUMO_NATIVE_DIR'):self.fail(pins.check(found,p))
   self.skipTest('no pinned build in '+str(libs))
  tampered={a:dict(v) for a,v in found.items()};name='libawai_llama.so';b=bytearray(tampered['arm64-v8a'][name]);b[-1]^=1;tampered['arm64-v8a'][name]=bytes(b)
  self.assertTrue(any('sha256' in x for x in pins.check(tampered,p)))
  missing={a:dict(v) for a,v in found.items()};del missing['x86_64']['libllama.so'];self.assertTrue(any('missing' in x for x in pins.check(missing,p)))
  # A pinned library that imports Android logging fails even when its digest is pinned.
  logging=self.with_import(found['arm64-v8a'][name],'llama_batch_ext_set_output_logits','__android_log_print')
  self.assertIsNotNone(logging)
  if logging:
   p2=json.loads(json.dumps(p));import hashlib;p2['abis']['arm64-v8a'][name]=hashlib.sha256(logging).hexdigest()
   f={a:dict(v) for a,v in found.items()};f['arm64-v8a'][name]=logging;self.assertTrue(any('forbidden imports' in x for x in pins.check(f,p2)))
 @staticmethod
 def with_import(data,old,new):
  """Overwrite an undefined dynamic symbol's name in place to simulate a forbidden import."""
  old=b'\0'+old.encode()+b'\0';new=new.encode()+b'\0';assert len(new)<len(old)
  i=data.find(old);return data[:i+1]+new+data[i+1+len(new):] if i>=0 else None
 def test_symbol_reader_sees_forbidden_imports(self):
  logging=pins.FORBIDDEN&{'__android_log_print','socket','getaddrinfo'};self.assertEqual(len(logging),3)
  self.assertTrue(pins.CRASH_ONLY.isdisjoint(pins.FORBIDDEN))

if __name__=='__main__':unittest.main()
