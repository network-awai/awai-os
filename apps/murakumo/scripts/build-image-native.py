#!/usr/bin/env python3
"""Explicit pinned Android Vulkan image build. No model execution or device mutation.

Reproducible like build-native.py: host paths are mapped out of the binaries and the
build environment is fixed, so the same pinned sources and NDK give the same bytes
on macOS and Linux. verify-native-pins.py compares the result with native-pins.json.
"""
import pathlib,json,hashlib,urllib.request,tarfile,subprocess,shutil,os,sys,platform
root=pathlib.Path(__file__).resolve().parents[3];app=root/'apps/murakumo';p=json.loads((app/'image-pins.json').read_text());out=root/'.agent-output';vendor=out/'vendor';vendor.mkdir(parents=True,exist_ok=True)
NDK_VERSION='27.0.12077973';env={**os.environ,'SOURCE_DATE_EPOCH':'0','LC_ALL':'C','TZ':'UTC'}
def source(repo,rev,sha,name):
 archive=out/(name+'.tar.gz')
 if not archive.exists():urllib.request.urlretrieve('https://codeload.github.com/'+repo+'/tar.gz/'+rev,archive)
 assert hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()==sha,'source-archive-digest-mismatch'
 with tarfile.open(archive)as t:
  prefix=t.getmembers()[0].name;dest=vendor/prefix
  if not dest.exists():t.extractall(vendor,filter='data')
  for m in t.getmembers():
   if m.isfile():assert hashlib.sha256(t.extractfile(m).read()).digest()==hashlib.file_digest((vendor/m.name).open('rb'),'sha256').digest(),'source-tree-drift'
 return dest
engine=p['engine'];sd=source(engine['repo'],engine['revision'],engine['archiveSha256'],'stable-diffusion');gg=source('leejet/ggml',engine['ggmlRevision'],engine['ggmlArchiveSha256'],'ggml')
v=engine['vulkanHeaders'];vk=source(v['repo'],v['revision'],v['archiveSha256'],'vulkan-headers');s=engine['spirvHeaders'];sp=source(s['repo'],s['revision'],s['archiveSha256'],'spirv-headers')
subprocess.run(['cmake','-S',str(sp),'-B',str(out/'spirv-build'),'-DCMAKE_INSTALL_PREFIX='+str(out/'spirv-install')],check=True,env=env);subprocess.run(['cmake','--install',str(out/'spirv-build')],check=True,env=env)
default_ndk=pathlib.Path.home()/('Library/Android/sdk/ndk/' if platform.system()=='Darwin' else 'Android/Sdk/ndk/')/NDK_VERSION
ndk=pathlib.Path(os.environ.get('ANDROID_NDK_HOME') or os.environ.get('ANDROID_NDK_ROOT') or default_ndk)
props=(ndk/'source.properties').read_text() if (ndk/'source.properties').is_file() else ''
if 'Pkg.Revision = '+NDK_VERSION not in props:raise SystemExit(f'ndk-{NDK_VERSION}-required: {ndk}')
host={'Darwin':'darwin-x86_64','Linux':'linux-x86_64'}.get(platform.system()) or sys.exit('unsupported-host')
make=shutil.which('make') or sys.exit('make-required')
for abi in sys.argv[1:] or ['x86_64']:
 assert abi in ['x86_64','arm64-v8a'],'unsupported-abi'
 build=out/'image-android'/abi
 if build.exists():shutil.rmtree(build)
 # Host paths (the extracted sources and build tree under out/, plus this app's native/)
 # must not reach the binaries: __FILE__ in ggml/sd asserts would otherwise differ per checkout.
 maps=' '.join(f'-ffile-prefix-map={q}={n}' for q,n in [(out,'out'),(app/'native','native')])
 args=['cmake','-S',str(app/'native/image'),'-B',str(build),'-G','Unix Makefiles','-DCMAKE_MAKE_PROGRAM='+make,'-DCMAKE_BUILD_TYPE=Release','-DCMAKE_TOOLCHAIN_FILE='+str(ndk/'build/cmake/android.toolchain.cmake'),'-DANDROID_ABI='+abi,'-DANDROID_PLATFORM=android-35','-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON','-DSD_SOURCE='+str(sd),'-DSD_GGML_SOURCE_DIR='+str(gg),'-DVulkan_INCLUDE_DIR='+str(vk/'include'),'-DVulkan_GLSLC_EXECUTABLE='+str(ndk/'shader-tools'/host/'glslc'),'-DSPIRV-Headers_DIR='+str(out/'spirv-install/share/cmake/SPIRV-Headers'),'-DSPIRV_INCLUDE_DIR='+str(out/'spirv-install/include'),'-DCMAKE_C_FLAGS='+maps,'-DCMAKE_CXX_FLAGS='+maps]
 if abi=='x86_64':args+=['-DGGML_AVX=OFF','-DGGML_AVX2=OFF','-DGGML_FMA=OFF','-DGGML_F16C=OFF']
 subprocess.run(args,check=True,env=env);subprocess.run(['cmake','--build',str(build),'--target','awai_diffusion','-j6'],check=True,env=env)
 lib=next(build.rglob('libawai_diffusion.so'));subprocess.run([str(ndk/'toolchains/llvm/prebuilt'/host/'bin/llvm-strip'),'--strip-unneeded',str(lib)],check=True,env=env);dest=app/'src-tauri/gen/android/app/src/main/jniLibs'/abi;dest.mkdir(parents=True,exist_ok=True);shutil.copyfile(lib,dest/lib.name)
 receipt={'schema':'awai.murakumo.image-native-build.v1','abi':abi,'ndk':NDK_VERSION,'host':host,'sha256':hashlib.file_digest(lib.open('rb'),'sha256').hexdigest(),'bytes':lib.stat().st_size,'engine':engine,'backend':'Vulkan0','remote':False}
 (out/('image-native-'+abi+'.json')).write_text(json.dumps(receipt,indent=2)+'\n');print('Built pinned Android image engine',abi)
