{ pkgs ? import (import ../../../ci/nixpkgs.nix) { } }:
pkgs.runCommand "otehon-agent-conversation-database-check" {
  nativeBuildInputs = [ pkgs.babashka pkgs.nodejs ];
} ''
  cp -R ${./.} bot-chat
  cp -R ${../storage} storage
  mkdir -p bot-fleet/vm/vendor/itonami
  cp -R ${../bot-fleet/vm/vendor/itonami/otehon} bot-fleet/vm/vendor/itonami/otehon
  export CHAT_TEST_ROOT="$TMPDIR/conversation-tests"
  node --test bot-chat/test/database.test.mjs bot-chat/test/service.test.mjs bot-chat/test/result.test.mjs bot-chat/test/presence.test.mjs bot-chat/test/peer.test.mjs bot-chat/test/peer-report.test.mjs > "$out"
''
