#!/usr/bin/env python3
"""Build the AWAI-3058 nearby probe (test-only APK) from installed SDK tools; no Gradle.
Output goes to .agent-output/nearby-probe by default. Never installs on a device."""
import argparse, pathlib, shutil, subprocess, zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent.parent
MANIFEST = '''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="network.awai.nearbyprobe" android:versionCode="1" android:versionName="0.0.1">
  <uses-sdk android:minSdkVersion="35" android:targetSdkVersion="37"/>
  <uses-permission android:name="android.permission.INTERNET"/>
  <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
  <uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>
  <uses-permission android:name="android.permission.CHANGE_WIFI_STATE"/>
  <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE"/>
  <uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK"/>
  <uses-permission android:name="android.permission.NEARBY_WIFI_DEVICES" android:usesPermissionFlags="neverForLocation"/>
  <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation"/>
  <uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE"/>
  <uses-permission android:name="android.permission.BLUETOOTH_CONNECT"/>
  <application android:label="Awai nearby probe" android:testOnly="true" android:allowBackup="false" android:debuggable="true">
    <activity android:name="network.awai.nearbyprobe.ProbeActivity" android:exported="true" android:launchMode="singleTop">
      <intent-filter><action android:name="android.intent.action.MAIN"/></intent-filter>
    </activity>
  </application>
</manifest>
'''

def run(args): subprocess.run([str(a) for a in args], check=True)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--sdk', type=pathlib.Path, default=pathlib.Path.home() / 'Library/Android/sdk')
    ap.add_argument('--java', type=pathlib.Path, default=pathlib.Path('/opt/homebrew/opt/openjdk/bin'))
    ap.add_argument('--out', type=pathlib.Path, default=ROOT / '.agent-output/nearby-probe')
    a = ap.parse_args()
    tools, jar = a.sdk / 'build-tools/36.1.0', a.sdk / 'platforms/android-37.0/android.jar'
    key = pathlib.Path.home() / '.android/debug.keystore'
    out = a.out.resolve(); shutil.rmtree(out, ignore_errors=True)
    classes, dex = out / 'classes', out / 'dex'; classes.mkdir(parents=True); dex.mkdir()
    (out / 'AndroidManifest.xml').write_text(MANIFEST)
    run([tools / 'aapt2', 'link', '-o', out / 'resources.apk', '--manifest', out / 'AndroidManifest.xml', '-I', jar])
    run([a.java / 'javac', '--release', '17', '-encoding', 'UTF-8', '-cp', jar, '-d', classes, *(HERE / 'src').rglob('*.java')])
    run([tools / 'd8', '--min-api', '35', '--lib', jar, '--output', dex, *classes.rglob('*.class')])
    unsigned = out / 'unsigned.apk'; shutil.copyfile(out / 'resources.apk', unsigned)
    with zipfile.ZipFile(unsigned, 'a', compression=zipfile.ZIP_DEFLATED) as z:
        for f in dex.glob('*.dex'): z.write(f, f.name)
    run([tools / 'zipalign', '-f', '4', unsigned, out / 'aligned.apk'])
    run([tools / 'apksigner', 'sign', '--ks', key, '--ks-key-alias', 'androiddebugkey', '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--out', out / 'nearby-probe.apk', out / 'aligned.apk'])
    print(out / 'nearby-probe.apk')

if __name__ == '__main__':
    main()
