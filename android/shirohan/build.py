#!/usr/bin/env python3
"""Compile the pinned upstream Shirohan engine and produce a Store development APK."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
from zipfile import ZipFile, ZIP_DEFLATED

APP = Path(__file__).resolve().parent
ROOT = APP.parents[1]
SOURCE = "f92d06345ae093061aecf1848be980840d1842b1"
DEVELOPMENT_SIGNER = "2507930b6c21b3c1cd0655527227dba75772096eff85e887bfcce2fb25b49b29"


def run(*args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def git(source, *args):
    return run("git", "-C", source, *args, stdout=subprocess.PIPE).stdout


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--sdk", type=Path, default=Path.home() / "Library/Android/sdk")
    parser.add_argument("--java", type=Path, default=Path("/opt/homebrew/opt/openjdk/bin"))
    parser.add_argument("--keystore", type=Path, default=Path.home() / ".android/debug.keystore")
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    src, assets, classes, dex = (out / name for name in ("cljs", "assets", "classes", "dex"))
    for directory in (src, assets, classes, dex):
        directory.mkdir()
    for path in git(args.source_repo, "ls-tree", "-r", "--name-only", SOURCE, "src/shirohan").decode().splitlines():
        rel = Path(path).relative_to("src").with_suffix(".cljc")
        dest = src / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(git(args.source_repo, "show", f"{SOURCE}:{path}"))
    for file in (APP / "web").iterdir():
        shutil.copyfile(file, assets / file.name)
    (assets / "LICENSE-shirohan.txt").write_bytes(git(args.source_repo, "show", f"{SOURCE}:LICENSE"))
    vendor = ROOT / "otehon/shell"
    runtime = vendor / "vendor/kotoba-client-runtime.js"
    if digest(runtime) != json.loads((runtime.parent / "PINS.json").read_text())["files"][runtime.name]:
        raise SystemExit("Canonical runtime pin drift")
    shutil.copyfile(runtime, assets / "runtime.js")
    text = vendor / "vendor-dougaka/kotoba/lang/text.cljs"
    if f"{digest(text)}  kotoba/lang/text.cljs" not in (vendor / "vendor-dougaka/SHA256SUMS").read_text().splitlines():
        raise SystemExit("Vendored Kotoba text pin drift")
    dest = src / "kotoba/lang/text.cljc"
    dest.parent.mkdir(parents=True)
    shutil.copyfile(text, dest)
    shutil.copyfile(APP / "cljs/bridge.cljs", src / "shirohan/android.cljs")
    shutil.copyfile(APP / "cljs/deps.edn", out / "deps.edn")
    env = {**os.environ, "JAVA_HOME": str(args.java.parent)}
    engine = out / "engine.js"
    run("clojure", "-M", "-m", "cljs.main", "-O", "simple", "-o", engine,
        "-d", out / "cljs-cache", "-co", "{:browser-repl false :preloads nil}", "-c", "shirohan.android", cwd=out, env=env)

    # Android WebView serves the worker as one local resource, including its engine.
    worker = assets / "worker.js"
    worker.write_bytes(engine.read_bytes() + b"\n" + worker.read_bytes())

    tools = args.sdk / "build-tools/36.1.0"
    jar = args.sdk / "platforms/android-37.0/android.jar"
    run(tools / "aapt2", "compile", "--dir", APP / "res", "-o", out / "res.zip")
    run(tools / "aapt2", "link", "-o", out / "unsigned.apk", "--manifest", APP / "AndroidManifest.xml",
        "-I", jar, "-A", assets, "-R", out / "res.zip", "--auto-add-overlay")
    run(args.java / "javac", "--release", "11", "-encoding", "UTF-8", "-cp", jar, "-d", classes,
        *sorted((APP / "src").rglob("*.java")), *sorted((ROOT / "packages/awai-system-bars/android").rglob("*.java")))
    run(tools / "d8", "--min-api", "35", "--lib", jar, "--output", dex, *sorted(classes.rglob("*.class")), env=env)
    with ZipFile(out / "unsigned.apk", "a", ZIP_DEFLATED) as apk:
        apk.write(dex / "classes.dex", "classes.dex")
    run(tools / "zipalign", "-f", "4", out / "unsigned.apk", out / "aligned.apk")
    apk = out / "shirohan.apk"
    run(tools / "apksigner", "sign", "--ks", args.keystore, "--ks-key-alias", "androiddebugkey",
        "--ks-pass", "pass:android", "--key-pass", "pass:android", "--out", apk, out / "aligned.apk", env=env)
    certs = run(tools / "apksigner", "verify", "--print-certs", apk, stdout=subprocess.PIPE, env=env).stdout.decode()
    fingerprints = [line.split()[-1] for line in certs.splitlines() if "certificate SHA-256 digest:" in line]
    if fingerprints != [DEVELOPMENT_SIGNER]:
        raise SystemExit("APK does not carry the Itonami Store development signer")
    print(json.dumps({"source": SOURCE, "apk": str(apk), "bytes": apk.stat().st_size,
                      "sha256": digest(apk), "signerSha256": DEVELOPMENT_SIGNER}))


if __name__ == "__main__":
    main()
