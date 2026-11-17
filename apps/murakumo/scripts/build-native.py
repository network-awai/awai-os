#!/usr/bin/env python3
"""Pinned Android Otehon engine build; never connects to a device or starts a host model."""
import pathlib,json,hashlib,subprocess,urllib.request,tarfile,os,sys
root=pathlib.Path(__file__).resolve().parents[3];app=root/'apps/murakumo';pins=json.loads((app/'pins.json').read_text());out=root/'.agent-output';source=out/'vendor/llama';archive=out/'vendor/llama.tar.gz';archive.parent.mkdir(parents=True,exist_ok=True)
if not archive.exists():urllib.request.urlretrieve('https://codeload.github.com/ggml-org/llama.cpp/tar.gz/'+pins['engine']['revision'],archive)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=pins['engine']['archiveSha256']:raise SystemExit('source-digest-mismatch')
if not source.exists():
 source.mkdir();
 with tarfile.open(archive)as t:
  prefix=t.getmembers()[0].name+'/'
  for member in t.getmembers():
   if member.name.startswith(prefix):member.name=member.name[len(prefix):];t.extract(member,source,filter='data')
ndk=pathlib.Path(os.environ.get('ANDROID_NDK_HOME',str(pathlib.Path.home()/'Library/Android/sdk/ndk/27.0.12077973')))
for abi in sys.argv[1:] or ['arm64-v8a','x86_64']:
 if abi not in ['arm64-v8a','x86_64']:raise SystemExit('unsupported-abi')
 build=out/'llama-android'/abi
 args=['cmake','-S',str(app/'native'),'-B',str(build),'-G','Unix Makefiles','-DCMAKE_MAKE_PROGRAM=/usr/bin/make','-DCMAKE_BUILD_TYPE=Release','-DCMAKE_TOOLCHAIN_FILE='+str(ndk/'build/cmake/android.toolchain.cmake'),'-DANDROID_ABI='+abi,'-DANDROID_PLATFORM=android-35','-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON','-DLLAMA_SOURCE='+str(source)]
 if abi=='x86_64':args+=['-DGGML_AVX=OFF','-DGGML_AVX2=OFF','-DGGML_FMA=OFF','-DGGML_F16C=OFF']
 subprocess.run(args,check=True);subprocess.run(['cmake','--build',str(build),'--target','awai_llama','-j','6'],check=True)
 import shutil
 dest=app/'src-tauri/gen/android/app/src/main/jniLibs'/abi;dest.mkdir(parents=True,exist_ok=True)
 for lib in build.rglob('*.so'):shutil.copyfile(lib,dest/lib.name)
 triple='aarch64-linux-android'if abi=='arm64-v8a'else'x86_64-linux-android'
 shutil.copyfile(ndk/'toolchains/llvm/prebuilt/darwin-x86_64/sysroot/usr/lib'/triple/'libc++_shared.so',dest/'libc++_shared.so')
 print('Built',abi)
