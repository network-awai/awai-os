#!/usr/bin/env python3
"""Check the AWAI-4094 integration consumed by the shipping virtio build."""

from pathlib import Path
import re
import subprocess
import sys


PATCH = "virtio-common-awai-apps.patch"
PROJECT = "device/virt/virtio-common"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def check(kit):
    apply_script = kit / "pc-ab-device/apply.sh"
    patch = kit / "pc-ab-device/patches" / PATCH
    require(apply_script.is_file() and patch.is_file(), f"missing {PATCH} or pc-ab-device/apply.sh")
    subprocess.run(["sh", "-n", apply_script], check=True, capture_output=True)
    route = apply_script.read_text()
    one = re.search(r"^one\(\) \{[^\n]*\n(.*?)^}", route, re.M | re.S)
    require(
        one and all(line in one[1].splitlines() for line in (
            '  dir="$src/$1"; patch="$here/patches/$2"',
            '  git -C "$dir" apply --check "$patch"',
            '  git -C "$dir" apply "$patch"',
        )) and re.search(rf"^one {PROJECT} {re.escape(PATCH)} '[^'\n]+'$", route, re.M),
        f"apply.sh must apply {PATCH} in {PROJECT}",
    )

    # Have git validate the unified diff, then inspect additions grouped by file.
    stats = subprocess.run(["git", "apply", "--numstat", patch.resolve()], cwd="/",
                           check=True, capture_output=True, text=True)
    app_files = {"awai-apps/Android.mk", "awai-apps/product.mk", "awai-apps/verify-apks.sh"}
    files = app_files | {"device-common.mk"}
    require({line.split("\t")[-1] for line in stats.stdout.splitlines()} == files,
            f"{PATCH} must patch device-common.mk and add the three awai-apps files")
    additions = {}
    for section in re.split(r"^diff --git ", patch.read_text(), flags=re.M)[1:]:
        header, _, body = section.partition("\n")
        match = re.fullmatch(r"a/(\S+) b/\1", header)
        require(match and match[1] in files and match[1] not in additions,
                f"{PATCH} must use project-relative paths")
        name = match[1]
        hunk = body[body.index("\n@@ "):]
        if name in app_files:
            require("\n--- /dev/null\n" in body, f"{PATCH} must add {name}")
        additions[name] = "\n".join(line[1:] for line in hunk.splitlines() if line.startswith("+"))

    require(additions.keys() == files, f"{PATCH} must contain all Home/Store integration files")
    require("include $(COMMON_PATH)/awai-apps/product.mk" in additions["device-common.mk"].splitlines(),
            "device-common.mk must include awai-apps/product.mk")
    blocks = re.findall(r"^include \$\(CLEAR_VARS\)\n(.*?)^include \$\(BUILD_PREBUILT\)$",
                        additions["awai-apps/Android.mk"], re.M | re.S)
    for app in ("AwaiHome", "AwaiStore"):
        require(any({
            f"LOCAL_MODULE := {app}", f"LOCAL_SRC_FILES := {app}.apk",
            "LOCAL_MODULE_CLASS := APPS", "LOCAL_CERTIFICATE := PRESIGNED",
        } <= set(block.splitlines()) for block in blocks), f"Android.mk must define the presigned {app} prebuilt")

    product = additions["awai-apps/product.mk"]
    product_lines = {line.strip() for line in product.splitlines()}
    require(re.search(r"^\s*PRODUCT_PACKAGES \+=\s+\\\s*\n\s*AwaiHome\s+\\\s*\n\s*AwaiStore[ \t]*$", product, re.M),
            "product.mk must include both Home and Store in PRODUCT_PACKAGES")
    require(all(line in product_lines for line in (
        'AWAI_APPS_PATH := $(COMMON_PATH)/awai-apps',
        'AWAI_APPS_ARGS := $(AWAI_APPS_PATH) "$(AWAI_APKSIGNER)" "$(AWAI_HOME_EXPECTED_SIGNER_SHA256)" "$(AWAI_STORE_EXPECTED_SIGNER_SHA256)"',
        'AWAI_APPS_VERIFY := $(shell sh $(AWAI_APPS_PATH)/verify-apks.sh $(AWAI_APPS_ARGS) 2>&1)',
        'ifeq ($(filter AWAI_APPS_OK:%,$(AWAI_APPS_VERIFY)),)',
        '$(error AWAI-4094: prebuilt Awai APK check failed: $(AWAI_APPS_VERIFY))',
    )), "product.mk must invoke the fail-closed verifier with both signer pins")
    verifier = additions["awai-apps/verify-apks.sh"]
    subprocess.run(["sh", "-n"], input=verifier, text=True, check=True, capture_output=True)
    verifier_lines = {line.strip() for line in verifier.splitlines()}
    require(re.search(r'^\s*got=\$\("\$signer" verify --print-certs "\$1" ', verifier, re.M)
            and all(line in verifier_lines for line in (
                '[ "$got" = "$2" ] || fail "$1 signer $got != expected $2"',
                'check "$dir/AwaiHome.apk" "$home"',
                'check "$dir/AwaiStore.apk" "$store"',
            )), "verify-apks.sh must verify and compare the signer of both APKs")


if __name__ == "__main__":
    try:
        check(Path(sys.argv[1]))
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        reason = "malformed patch or shell script" if isinstance(exc, subprocess.CalledProcessError) else exc
        sys.exit(f"AWAI4094_REFUSES: shipping user requires the Home/Store kit integration (#523): {reason}")
    print("AWAI4094_KIT_INTEGRATION_OK")
