{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-agent-conversation-database-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.nodejs ];
} ''
  cp -R ${./.} bot-chat
  cp -R ${../storage} storage
  export CHAT_TEST_ROOT="$TMPDIR/conversation-tests"
  node --test bot-chat/test/database.test.mjs > "$out"
''
