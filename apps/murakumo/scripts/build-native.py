#!/usr/bin/env python3
"""Pinned, reproducible Android build of the text engine (libawai_llama.so and its llama/ggml libraries).

Never connects to a device, downloads a model or starts a host model. Downloads only the pinned
llama.cpp archive, checks it and every extracted file, then builds with flags that keep host paths
out of the binaries, so the same source and NDK give the same bytes on macOS and Linux.

  build-native.py [ABI...]            build into src-tauri/gen/android/app/src/main/jniLibs/<abi>
  build-native.py --out DIR [ABI...]  build into DIR/<abi> instead (the reproduction check uses this)
  build-native.py --verify-only       check the source archive and tree only

After a build, verify-native-pins.py compares the libraries with native-pins.json.
"""
import hashlib,json,os,pathlib,platform,shutil,subprocess,sys,tarfile
root=pathlib.Path(__file__).resolve().parents[3];app=root/'apps/murakumo';pins=json.loads((app/'pins.json').read_text())
out=root/'.agent-output';source=out/'vendor/llama';archive=out/'vendor/llama.tar.gz';archive.parent.mkdir(parents=True,exist_ok=True)
NDK_VERSION='27.0.12077973';ABIS=['arm64-v8a','x86_64']
args=sys.argv[1:];dest_root=app/'src-tauri/gen/android/app/src/main/jniLibs'
if args[:1]==['--out']:dest_root=pathlib.Path(args[1]).resolve();args=args[2:]
if not archive.exists():
 import urllib.request;urllib.request.urlretrieve('https://codeload.github.com/ggml-org/llama.cpp/tar.gz/'+pins['engine']['revision'],archive)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=pins['engine']['archiveSha256']:raise SystemExit('source-digest-mismatch')
if not source.exists():
 source.mkdir()
 with tarfile.open(archive)as t:
  prefix=t.getmembers()[0].name+'/'
  for member in t.getmembers():
   if member.name.startswith(prefix):member.name=member.name[len(prefix):];t.extract(member,source,filter='data')
# Reuse the extraction only after checking every file against the admitted archive.
expected=set()
with tarfile.open(archive) as t:
 prefix=t.getmembers()[0].name+'/'
 for member in t.getmembers():
  if not member.name.startswith(prefix) or not member.isfile():continue
  rel=member.name[len(prefix):];expected.add(rel);target=source/rel
  if not target.is_file() or not target.resolve().is_relative_to(source.resolve()):raise SystemExit('source-tree-missing')
  if hashlib.sha256(t.extractfile(member).read()).digest()!=hashlib.sha256(target.read_bytes()).digest():raise SystemExit('source-tree-drift')
actual={str(p.relative_to(source)) for p in source.rglob('*') if p.is_file()}
if actual!=expected:raise SystemExit('source-tree-extra-or-missing')
if args==['--verify-only']:
 print('Verified immutable engine archive and extracted tree');raise SystemExit(0)
default_ndk=pathlib.Path.home()/('Library/Android/sdk/ndk/' if platform.system()=='Darwin' else 'Android/Sdk/ndk/')/NDK_VERSION
ndk=pathlib.Path(os.environ.get('ANDROID_NDK_HOME') or os.environ.get('ANDROID_NDK_ROOT') or default_ndk).resolve()
props=(ndk/'source.properties').read_text() if (ndk/'source.properties').is_file() else ''
if 'Pkg.Revision = '+NDK_VERSION not in props:raise SystemExit(f'ndk-{NDK_VERSION}-required: {ndk}')
host={'Darwin':'darwin-x86_64','Linux':'linux-x86_64'}.get(platform.system()) or sys.exit('unsupported-host')
llvm=ndk/'toolchains/llvm/prebuilt'/host
make=shutil.which('make') or sys.exit('make-required')
for abi in args or ABIS:
 if abi not in ABIS:raise SystemExit('unsupported-abi')
 build=out/'llama-android'/abi
 if build.exists():shutil.rmtree(build)
 # Host paths (source, app, build directory) must not reach the binaries: __FILE__ in GGML_ASSERT and
 # the debug info would otherwise differ per checkout. The libraries are stripped below as well.
 maps=' '.join(f'-ffile-prefix-map={p}={n}' for p,n in [(source,'llama'),(app/'native','native'),(build,'build')])
 # LLD computes the Build ID before stripping DWARF. Map NDK header paths
 # as well, so moving the same toolchain cannot change the shipped Build ID.
 maps += f' -fdebug-prefix-map={ndk}=android-ndk'
 cmake=['cmake','-S',str(app/'native'),'-B',str(build),'-G','Unix Makefiles','-DCMAKE_MAKE_PROGRAM='+make,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_TOOLCHAIN_FILE='+str(ndk/'build/cmake/android.toolchain.cmake'),'-DANDROID_ABI='+abi,'-DANDROID_PLATFORM=android-35','-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON','-DLLAMA_SOURCE='+str(source),'-DCMAKE_C_FLAGS='+maps,'-DCMAKE_CXX_FLAGS='+maps,'-DLLAMA_BUILD_NUMBER=0','-DLLAMA_BUILD_COMMIT='+pins['engine']['revision'][:7]]
 if abi=='x86_64':cmake+=['-DGGML_AVX=OFF','-DGGML_AVX2=OFF','-DGGML_FMA=OFF','-DGGML_F16C=OFF']
 env={**os.environ,'SOURCE_DATE_EPOCH':'0','LC_ALL':'C','TZ':'UTC'}
 subprocess.run(cmake,check=True,env=env);subprocess.run(['cmake','--build',str(build),'--target','awai_llama','-j','6'],check=True,env=env)
 dest=dest_root/abi;dest.mkdir(parents=True,exist_ok=True)
 for old in dest.glob('*.so'):
  if old.name!='libawai_diffusion.so':old.unlink()
 libs=sorted({p.name:p for p in build.rglob('*.so')}.items())
 for name,lib in libs:
  shutil.copyfile(lib,dest/name);subprocess.run([str(llvm/'bin/llvm-strip'),'--strip-unneeded',str(dest/name)],check=True)
 triple='aarch64-linux-android'if abi=='arm64-v8a'else'x86_64-linux-android'
 shutil.copyfile(llvm/'sysroot/usr/lib'/triple/'libc++_shared.so',dest/'libc++_shared.so')
 receipt={'schema':'awai.murakumo.native-build.v1','abi':abi,'ndk':NDK_VERSION,'host':host,'engine':pins['engine'],
  'libraries':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(dest.glob('*.so')) if p.name!='libawai_diffusion.so'}}
 (out/f'native-build-{abi}.json').write_text(json.dumps(receipt,indent=2)+'\n');print('Built',abi,json.dumps(receipt['libraries']))
