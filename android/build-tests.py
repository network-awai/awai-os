#!/usr/bin/env python3
"""Build only the Store instrumentation APK. Install/run is an explicit separate command."""
import argparse, pathlib, subprocess, zipfile, shutil
ROOT=pathlib.Path(__file__).resolve().parent.parent
def run(args):subprocess.run([str(a)for a in args],check=True)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--version',type=int,default=1);ap.add_argument('--kind',choices=['store','setup'],default='store');ap.add_argument('--target-package',choices=['network.awai.store','network.awai.store.p2p.preview'],default='network.awai.store');a=ap.parse_args()
    out=ROOT/'.agent-output/android';stage=out/f'tests-v{a.version}';stage.mkdir(parents=True,exist_ok=True)
    java=pathlib.Path('/opt/homebrew/opt/openjdk/bin');sdk=pathlib.Path.home()/'Library/Android/sdk';tools=sdk/'build-tools/36.1.0';jar=sdk/'platforms/android-37.0/android.jar';key=pathlib.Path.home()/'.android/debug.keystore'
    classes=stage/'classes';classes.mkdir(exist_ok=True);dex=stage/'dex';dex.mkdir(exist_ok=True)
    target=out/f'{"home" if a.kind=="setup" else "store"}-v{a.version}'/'classes';cp=stage/'target.jar'
    with zipfile.ZipFile(cp,'w')as z:
        for f in target.rglob('*.class'):z.write(f,str(f.relative_to(target)))
    testclass='SetupInstrumentation' if a.kind=='setup' else 'StoreInstrumentation'
    testpkg='network.awai.home' if a.kind=='setup' else a.target_package
    test_package='network.awai.tests.p2p.preview' if testpkg.endswith('.p2p.preview') else 'network.awai.tests'
    auto='' if a.kind=='setup' else f'<instrumentation android:name="network.awai.tests.AutoUpdateInstrumentation" android:targetPackage="{testpkg}"/>'
    manifest=stage/'AndroidManifest.xml';manifest.write_text(f'''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{test_package}" android:versionCode="1" android:versionName="1"><uses-sdk android:minSdkVersion="33" android:targetSdkVersion="37"/><application android:label="Awai tests" android:debuggable="true"/><instrumentation android:name="network.awai.tests.{testclass}" android:targetPackage="{testpkg}"/>{auto}</manifest>''')
    run([java/'javac','--release','8','-encoding','UTF-8','-cp',str(jar)+':'+str(cp),'-d',classes,*list((ROOT/'android/tests/src').rglob('*.java'))])
    run([tools/'d8','--min-api','33','--lib',jar,'--classpath',cp,'--output',dex,*classes.rglob('*.class')])
    apk=stage/'unsigned.apk';run([tools/'aapt2','link','-o',apk,'--manifest',manifest,'-I',jar])
    with zipfile.ZipFile(apk,'a',compression=zipfile.ZIP_DEFLATED)as z:
        for f in dex.glob('*.dex'):z.write(f,f.name)
    run([tools/'zipalign','-f','4',apk,stage/'aligned.apk'])
    run([tools/'apksigner','sign','--ks',key,'--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--key-pass','pass:android','--out',out/'tests.apk',stage/'aligned.apk'])
if __name__=='__main__':main()
