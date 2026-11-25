#!/usr/bin/env python3
"""Build the Sanka confirmation APK (ADR 0027 V4, AWAI-3123), the same way android/build.py builds
Home, Store and Yotei: aapt2, javac, d8, zipalign and apksigner from the installed SDK, signed with
the existing Android debug identity. It never connects to a device. Output: .agent-output/sanka/.

usage: python3 android/sanka/build.py [--sdk DIR] [--java DIR]
"""
import argparse, hashlib, os, pathlib, shutil, subprocess, zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def run(cmd, **kw):
    subprocess.run([str(c) for c in cmd], check=True, **kw)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sdk", type=pathlib.Path, default=pathlib.Path.home() / "Library/Android/sdk")
    ap.add_argument("--java", type=pathlib.Path,
                    default=pathlib.Path(os.environ.get("JAVA_HOME", "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home")) / "bin")
    args = ap.parse_args()
    tools = args.sdk / "build-tools/36.1.0"
    jar = args.sdk / "platforms/android-37.0/android.jar"
    key = pathlib.Path.home() / ".android/debug.keystore"
    for f in [jar, tools / "aapt2", tools / "d8", tools / "apksigner", tools / "zipalign", key, args.java / "javac"]:
        if not f.exists():
            raise SystemExit(f"missing {f}")
    out = ROOT / ".agent-output/sanka"
    stage = out / "stage"
    shutil.rmtree(stage, ignore_errors=True)
    (stage / "classes").mkdir(parents=True)
    run([tools / "aapt2", "link", "-o", stage / "resources.apk", "--manifest", HERE / "AndroidManifest.xml",
         "-I", jar, "--debug-mode"])
    sources = sorted((HERE / "src").rglob("*.java")) + sorted((ROOT / "packages/awai-system-bars/android").rglob("*.java"))
    run([args.java / "javac", "--release", "8", "-encoding", "UTF-8", "-cp", jar, "-d", stage / "classes", *sources])
    run([tools / "d8", "--min-api", "35", "--lib", jar, "--output", stage, *sorted((stage / "classes").rglob("*.class"))])
    unsigned = stage / "unsigned.apk"
    shutil.copy(stage / "resources.apk", unsigned)
    with zipfile.ZipFile(unsigned, "a") as z:
        z.write(stage / "classes.dex", "classes.dex")
    run([tools / "zipalign", "-f", "4", unsigned, stage / "aligned.apk"])
    apk = out / "sanka-debug.apk"
    run([tools / "apksigner", "sign", "--ks", key, "--ks-key-alias", "androiddebugkey", "--ks-pass", "pass:android",
         "--key-pass", "pass:android", "--out", apk, stage / "aligned.apk"])
    run([tools / "apksigner", "verify", apk], stdout=subprocess.DEVNULL)
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    print(f"{apk} {apk.stat().st_size} bytes sha256 {digest}")


if __name__ == "__main__":
    main()
