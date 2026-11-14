{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-agent-conversation-database-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.nodejs ];
} ''
  cp -R ${./.} bot-chat
  cp -R ${../storage} storage
  cp -R ${../circle-work} circle-work
  mkdir -p bot-fleet/vm/vendor/itonami
  cp -R ${../bot-fleet/vm/vendor/itonami/otehon} bot-fleet/vm/vendor/itonami/otehon
  export CHAT_TEST_ROOT="$TMPDIR/conversation-tests"
  node --test bot-chat/test/*.test.mjs circle-work/test.mjs circle-work/*.test.mjs > "$out"
''
