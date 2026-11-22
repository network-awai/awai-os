#!/bin/sh
# Publishes mailbox.awai.network from the merged default branch. Running it creates a Worker and a
# custom domain, so it needs the owner's approval first (ADR 0051, open decision 1).
set -e
cd "$(dirname "$0")"
if [ "$AWAI_MAILBOX_DEPLOY_APPROVED" != "yes" ]; then
  echo "set AWAI_MAILBOX_DEPLOY_APPROVED=yes once the owner has approved the deploy" >&2
  exit 1
fi
if [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "publish only from a clean, pushed main" >&2
  exit 1
fi
node --test test/mailbox.test.mjs
wrangler deploy
