#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

if [[ $# != 1 ]]; then
    echo "Usage: $0 <Android checkout>/packages/apps/SetupWizard" >&2
    exit 2
fi

here=$(cd "$(dirname "$0")" && pwd)
wizard=$(cd "$1" && pwd)
revision=d995f1a1949f5988850c9977658e2590efe502b4
if [[ $(git -C "$wizard" rev-parse HEAD) != "$revision" ]]; then
    echo "Expected SetupWizard revision $revision" >&2
    exit 1
fi

source_res="$here/res"
target_res="$wizard/app/src/main/res"
logo="$here/../../client/assets/setup-logo.png"
logo_target="$target_res/drawable-nodpi/awai_welcome_logo.png"

# Check the complete change before writing. Re-run on a clean pinned checkout.
git -C "$wizard" apply --check "$here/setupwizard-awai.patch"
while IFS= read -r -d '' file; do
    target="$target_res/${file#"$source_res/"}"
    if [[ -e "$target" || -L "$target" ]]; then
        echo "Resource already exists: $target" >&2
        exit 1
    fi
done < <(find "$source_res" -type f -print0)
if [[ -e "$logo_target" || -L "$logo_target" ]]; then
    echo "Resource already exists: $logo_target" >&2
    exit 1
fi

git -C "$wizard" apply "$here/setupwizard-awai.patch"
while IFS= read -r -d '' file; do
    target="$target_res/${file#"$source_res/"}"
    mkdir -p "$(dirname "$target")"
    cp "$file" "$target"
done < <(find "$source_res" -type f -print0)
mkdir -p "$(dirname "$logo_target")"
cp "$logo" "$logo_target"
