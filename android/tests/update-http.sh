#!/usr/bin/env bash
# Local transport tests for the online Store. Needs a JDK and OpenSSL.
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
shared="$root/android/shared/src/network/awai/platform"
online="$root/android/store/online-src/network/awai/platform"
libs="$root/android/store/http-libs/*"
javac -encoding UTF-8 -cp "$libs" -d "$out" \
  "$shared/Integrity.java" "$shared/AutoUpdateRun.java" "$shared/UpdateHttpTransport.java" \
  "$online/OkHttpUpdateTransport.java" "$root/android/tests/jvm-http/UpdateHttpTest.java"
openssl req -new -x509 -newkey rsa:2048 -nodes -subj /CN=127.0.0.1 \
  -addext subjectAltName=IP:127.0.0.1 -days 1 -keyout /dev/stdout -out /dev/stdout 2>/dev/null |
  openssl pkcs12 -export -in /dev/stdin -passout pass:store-test-only |
  java -cp "$out:$libs" network.awai.platform.UpdateHttpTest
