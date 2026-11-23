#!/usr/bin/env python3
"""System-bar duplication gate for AWAI-3443 (packages/awai-system-bars/).

Fails if any Android app in this repo sets bar colors or icon appearance
directly instead of calling the shared library, and fails if any expected
app is not wired to the library.

  python3 scripts/check-system-bars.py          # custom exit code on failure

This is the "grep-based check that fails if duplicated per-app color logic
remains" from the AWAI-3443 acceptance: the library itself is the only file
allowed to contain direct bar-color / icon-appearance tokens. Historical
evidence (docs/) and deprecated material (archive/) are excluded; they are
records, not code.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Tokens that must appear only inside the library.
FORBIDDEN = [
    r"setStatusBarColor",
    r"setNavigationBarColor",
    r"setNavigationBarContrastEnforced",
    r"isNavigationBarContrastEnforced",
    r"isAppearanceLightStatusBars",
    r"isAppearanceLightNavigationBars",
    r"APPEARANCE_LIGHT_STATUS_BARS",
    r"APPEARANCE_LIGHT_NAVIGATION_BARS",
    r"SYSTEM_UI_FLAG_LIGHT_STATUS_BAR",
    r"SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR",
    r"decorView\.setBackgroundColor",
    r"getDecorView\(\)\.setBackgroundColor",
    r"getInsetsController\(\)\.setSystemBarsAppearance",
]

# Directories scanned (relative to the repo root).
SCAN_DIRS = ["apps", "android", "packages", "tests"]

# Paths (relative) that are allowed to carry the library tokens.
LIB_DIRS = ("packages/awai-system-bars",)
IGNORED_PARTS = ("node_modules", "/build/", "dist/", ".git/")

# Tauri apps whose MainActivity must call the library.
TAURI_APPS = [
    "apps/data-contribution", "apps/horei", "apps/isekai", "apps/itonami",
    "apps/murakumo", "apps/murakumo-net", "apps/payment-drafts",
    "apps/public-funds", "apps/securities-drafts", "apps/soudan",
    "apps/x402", "apps/yotei", "tests/android-webgpu-probe",
]

failures = []


def check_duplication():
    pattern = re.compile("|".join(FORBIDDEN))
    for base_rel in SCAN_DIRS:
        base = ROOT / base_rel
        for path in base.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel.startswith(LIB_DIRS) or "scripts/check-system-bars.py" in rel:
                continue
            if any(part in rel for part in IGNORED_PARTS):
                continue
            if path.suffix not in (".kt", ".java", ".kts", ".py", ".mjs", ".js"):
                continue
            text = path.read_text(errors="replace")
            for line_no, line in enumerate(text.splitlines(), 1):
                if pattern.search(line):
                    failures.append(f"duplication: {rel}:{line_no}: {line.strip()}")


def check_tauri_apps():
    for app in TAURI_APPS:
        main_dir = ROOT / app / "src-tauri/gen/android/app/src/main/java"
        mains = sorted(main_dir.rglob("MainActivity.kt"))
        if not mains:
            failures.append(f"wire: {app}: MainActivity.kt missing")
            continue
        text = mains[0].read_text()
        if "SystemBars.applyForUiMode(this, resources.configuration)" not in text:
            failures.append(f"wire: {app}: onCreate does not apply the library")
        if "SystemBars.applyForUiMode(this, newConfig)" not in text:
            failures.append(f"wire: {app}: onConfigurationChanged does not apply the library")
        if "applySystemBarAppearance" in text:
            failures.append(f"wire: {app}: stale applySystemBarAppearance remains")
        gradle = ROOT / app / "src-tauri/gen/android/app/build.gradle.kts"
        if "awai-system-bars" not in gradle.read_text():
            failures.append(f"wire: {app}: build.gradle.kts does not include the library")
        manifest = ROOT / app / "src-tauri/gen/android/app/src/main/AndroidManifest.xml"
        if "uiMode" not in manifest.read_text():
            failures.append(f"wire: {app}: manifest is missing uiMode in configChanges")


def check_java_hosts():
    hosts = {
        "android HostActivity (home/store/yotei/torihiki)":
            ROOT / "android/shared/src/network/awai/platform/HostActivity.java",
        "android Shirohan":
            ROOT / "android/shirohan/src/network/itonami/shirohan/ShirohanActivity.java",
        "android Sanka":
            ROOT / "android/sanka/src/network/awai/sanka/MainActivity.java",
    }
    for name, path in hosts.items():
        if "SystemBars.applyForUiMode(this" not in path.read_text():
            failures.append(f"wire: {name}: does not apply the library")
    # Builders must compile the library alongside the host activity.
    for name in ("android/build.py", "android/sanka/build.py", "android/shirohan/build.py"):
        if "awai-system-bars" not in (ROOT / name).read_text():
            failures.append(f"wire: {name}: does not compile the library")


def check_theme_match():
    """Per-app check that the system bar matches the app theme: each app's
    page background must equal the library's canonical light/dark background
    (the bar color IS the page --bg, painted behind the edge-to-edge bars)."""
    for app in TAURI_APPS:
        if app == "tests/android-webgpu-probe":
            continue  # WebGL probe has no page --bg; its bar still follows the system.
        name = app.split("/")[-1]
        css = ROOT / app / "src/style.css"
        if not css.is_file():
            continue  # murakumo / murakumo-net / itonami: shared CSS / shell below
        text = css.read_text()
        if "--bg:#fff" not in text or "--bg:#14110f" not in text:
            failures.append(f"theme: {name}: --bg is not #ffffff/#14110f")
    # Murakumo's page background comes from the shared awai-ui adapter:
    # --awai-background is #ffffff (light) / #14110f (dark) in the palette.
    palette = (ROOT / "android/contracts/src/itonami/store/domain.cljc").read_text()
    if ':background "#ffffff"' not in palette or ':background "#14110f"' not in palette:
        failures.append("theme: palette is not #ffffff/#14110f")
    # itonami's page is the Otehon shell: default dark #15181c, Asa #ffffff, Hiru #eaf7ff.
    shell = (ROOT / "otehon/shell/src/shell/styles/main.cljc").read_text()
    for bg in ('#15181c', '#ffffff', '#eaf7ff'):
        if bg not in shell:
            failures.append(f"theme: shell --bg {bg} changed; re-check lib shell constants")


def main():
    check_duplication()
    check_tauri_apps()
    check_java_hosts()
    check_theme_match()
    if failures:
        print("system-bar check FAILED:")
        for failure in failures:
            print(f"  {failure}")
        return 1
    print(f"system-bar check OK ({len(TAURI_APPS)} Tauri apps, 3 Java hosts, "
          f"no direct bar-color logic outside packages/awai-system-bars/)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
