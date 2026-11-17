import pathlib,subprocess,zipfile,shutil
root=pathlib.Path(__file__).resolve().parents[3];src=pathlib.Path(__file__).parent;out=root/'.agent-output/pin-probe';out.mkdir(parents=True,exist_ok=True)
sdk=pathlib.Path.home()/'Library/Android/sdk';tool=sdk/'build-tools/36.1.0';java=pathlib.Path('/opt/homebrew/opt/openjdk/bin');jar=sdk/'platforms/android-37.0/android.jar'
def run(a):subprocess.run([str(v) for v in a],check=True)
for name in ['classes','dex','assets']:(out/name).mkdir(exist_ok=True)
shutil.copyfile(root/'.agent-output/pin-overlay/AwaiPinOverlay.apk',out/'assets/AwaiPinOverlay.apk')
manifest=out/'AndroidManifest.xml';manifest.write_text('<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="network.awai.pinprobe" android:versionCode="1"><uses-sdk android:minSdkVersion="37" android:targetSdkVersion="37"/><queries><package android:name="com.android.systemui"/></queries><application android:debuggable="true" android:label="Awai resource probe"/><instrumentation android:name="network.awai.pinprobe.ResourceProbe" android:targetPackage="network.awai.pinprobe"/></manifest>')
run([java/'javac','--release','8','-cp',jar,'-d',out/'classes',src/'ResourceProbe.java'])
run([tool/'d8','--min-api','37','--lib',jar,'--output',out/'dex',*list((out/'classes').rglob('*.class'))])
unsigned=out/'unsigned.apk';run([tool/'aapt2','link','-o',unsigned,'--manifest',manifest,'-I',jar,'-A',out/'assets'])
with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as z:
 for f in (out/'dex').glob('*.dex'):z.write(f,f.name)
run([tool/'zipalign','-f','4',unsigned,out/'aligned.apk']);run([tool/'apksigner','sign','--ks',pathlib.Path.home()/'.android/debug.keystore','--ks-key-alias','androiddebugkey','--ks-pass','pass:android','--out',out/'probe.apk',out/'aligned.apk'])
