#!/bin/sh
# Publishes relay.awai.network and awai.network/link/ from the merged default branch.
set -e
cd "$(dirname "$0")"
if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "publish only from a clean, pushed main" >&2
  exit 1
fi
(cd ../../nixos/otehon/shell && npm ci --silent --no-audit --no-fund && node build.mjs)
grep -q "https://relay.awai.network" ../../nixos/otehon/shell/dist/link/index.html
rm -rf site/public
mkdir -p site/public
cp -R ../../nixos/otehon/shell/dist/link site/public/link
cp site/_headers site/public/_headers
(cd relay && wrangler deploy)
(cd site && wrangler deploy)
