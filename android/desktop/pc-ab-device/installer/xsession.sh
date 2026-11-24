#!/usr/bin/env bash
# Runs inside xinit: kiosk Firefox on the launch page (the path only; the token is inside that 0600 file).
set -u
launch=$1
work=$2
profile=$work/firefox-profile
rm -rf "$profile"
install -d -m 0700 "$profile" "$work/home"
export HOME=$work/home
cat > "$profile/user.js" <<'PREFS'
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("browser.tabs.warnOnClose", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("toolkit.telemetry.enabled", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("network.proxy.type", 0);
user_pref("network.captive-portal-service.enabled", false);
user_pref("network.connectivity-service.enabled", false);
user_pref("extensions.update.enabled", false);
user_pref("browser.safebrowsing.malware.enabled", false);
user_pref("browser.safebrowsing.phishing.enabled", false);
user_pref("security.sandbox.content.level", 4);
PREFS
command -v xsetroot >/dev/null 2>&1 && xsetroot -solid '#f2f4f8'
command -v xfwm4 >/dev/null 2>&1 && xfwm4 --compositor=off >/dev/null 2>&1 &
exec firefox --kiosk --no-remote --profile "$profile" "file://$launch"
