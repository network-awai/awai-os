#!/bin/sh
set -eu
bridge_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cert_dir=$(mkcert -CAROOT)
cert_file="$cert_dir/awai-muse-chat.pem"
key_file="$cert_dir/awai-muse-chat-key.pem"
if [ ! -f "$cert_file" ] || [ ! -f "$key_file" ]; then
  (umask 077; mkcert -cert-file "$cert_file" -key-file "$key_file" localhost 127.0.0.1 ::1)
fi
MUSE_CHAT_CERT="$cert_file" MUSE_CHAT_KEY="$key_file" exec node "$bridge_dir/bridge.mjs"
