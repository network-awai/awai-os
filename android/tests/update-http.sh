#!/usr/bin/env bash
# Local transport tests for the online Store. Needs a JDK, with no production connection.
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
keytool -genkeypair -alias loopback -keyalg RSA -keysize 2048 -dname CN=127.0.0.1 \
  -ext SAN=ip:127.0.0.1 -validity 1 -storetype PKCS12 -keystore "$out/loopback.p12" \
  -storepass store-test-only > "$out/keytool.log" 2>&1
java -cp "$out:$libs" network.awai.platform.UpdateHttpTest "$out/loopback.p12"
