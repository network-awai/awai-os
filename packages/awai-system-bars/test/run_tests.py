#!/usr/bin/env python3
"""Run the awai-system-bars unit tests (SystemBarAppearanceTest, no Android
runtime) on any host with a JDK: compile, run, print the count. Exit 1 on
failure. No emulator, no device, no network.
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
LIB = ROOT / "packages/awai-system-bars/android/network/awai/systembars"


def find_javac():
    for candidate in ("/opt/homebrew/opt/openjdk/bin/javac",
                      "/opt/homebrew/opt/openjdk@17/bin/javac",
                      "/opt/homebrew/opt/openjdk@21/bin/javac"):
        if pathlib.Path(candidate).is_file():
            return candidate
    import shutil
    return shutil.which("javac")


def main():
    javac = find_javac()
    if not javac:
        print("javac not found; install a JDK (openjdk@17 homebrew or temurin-21)")
        return 1
    java = str(pathlib.Path(javac).parent / "java")
    with tempfile.TemporaryDirectory(prefix="awai-system-bars-test-") as tmp:
        subprocess.run([javac, "-d", tmp,
                        str(LIB / "SystemBarAppearance.java"),
                        str(ROOT / "packages/awai-system-bars/test/SystemBarAppearanceTest.java")],
                       check=True)
        result = subprocess.run(
            [java, "-cp", tmp, "network.awai.systembars.SystemBarAppearanceTest"],
            capture_output=True, text=True)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        return result.returncode


if __name__ == "__main__":
    sys.exit(main())
