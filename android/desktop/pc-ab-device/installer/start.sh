#!/usr/bin/env bash
# Awai OS PC installer entry (tty1 autorun on the USB). Tries the screen installer; if X, Firefox or the
# backend cannot start, says why in one line and continues with the text installer, same guards (core.py).
#   start.sh           screen installer, text fallback
#   start.sh --text    text installer only; also chosen by the kernel option awai.installer=text
set -u
umask 077
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
media=${AWAI_MEDIA_DIR:-$(dirname "$here")}
work=${AWAI_WORK_DIR:-/run/awai-pc-installer}
python=${AWAI_PYTHON:-python3}

text() {
    printf 'AWAI INSTALLER: %s\n' "$1" >&2
    exec "$python" "$here/text_installer.py" --work-dir "$work" --media-dir "$media"
}

install -d -m 0700 "$work" || text "cannot create $work; using the text installer."

if [[ ${1:-} == --text ]]; then text "text mode requested."; fi
if grep -qw 'awai.installer=text' /proc/cmdline 2>/dev/null; then text "text mode requested (awai.installer=text)."; fi
# The browser binary is firefox-esr on the base medium (/usr/bin/firefox-esr -> /opt/firefox-esr/firefox-esr); plain
# firefox is accepted too. xsession.sh gets the same choice through AWAI_FIREFOX.
command -v xinit >/dev/null 2>&1 || text "screen installer unavailable (xinit not found); using the text installer."
firefox=$(command -v firefox-esr || command -v firefox) || text "screen installer unavailable (firefox-esr not found); using the text installer."
export AWAI_FIREFOX=$firefox
[[ -f $here/web/index.html ]] || text "screen installer unavailable (web files missing); using the text installer."

rm -f "$work/launch.html" "$work/server.out"
"$python" "$here/server.py" --work-dir "$work" --media-dir "$media" > "$work/server.out" 2> "$work/server.err" &
server=$!
for _ in $(seq 1 50); do
    [[ -s $work/server.out ]] && break
    kill -0 "$server" 2>/dev/null || break
    sleep 0.2
done
launch=$(head -n 1 "$work/server.out" 2>/dev/null || true)
if [[ -z $launch || ! -f $launch ]]; then
    kill "$server" 2>/dev/null
    text "screen installer unavailable (backend did not start); using the text installer."
fi

# Kiosk lock-down (devtools, about:*, new windows/tabs, URL shortcuts, file pickers, every URL but this page and
# the backend). Installed where Firefox reads enterprise policies; the live root is writable. Fail closed: no
# policy file, no browser.
extra_dirs=()
if [[ -n ${AWAI_POLICY_DIRS:-} ]]; then
    read -r -a policy_dirs <<< "$AWAI_POLICY_DIRS"   # tests only: replaces every directory below
else
    # the directory next to the real binary is the one Firefox always reads and is required; /etc copies are extra
    policy_dirs=("$(dirname "$(readlink -f "$firefox")")/distribution")
    extra_dirs=("${AWAI_ETC:-/etc}/firefox-esr/policies" "${AWAI_ETC:-/etc}/firefox/policies")
fi
policy_ok=1
for dir in "${policy_dirs[@]}"; do
    if ! { mkdir -p "$dir" 2>/dev/null && install -m 0644 "$here/firefox-policies.json" "$dir/policies.json" 2>/dev/null; }; then policy_ok=0; fi
done
for dir in "${extra_dirs[@]:-}"; do
    [[ -n $dir ]] && mkdir -p "$dir" 2>/dev/null && install -m 0644 "$here/firefox-policies.json" "$dir/policies.json" 2>/dev/null
done
if (( ! policy_ok )); then
    kill "$server" 2>/dev/null
    text "screen installer unavailable (could not install the browser lock-down policy); using the text installer."
fi

quick=0
while kill -0 "$server" 2>/dev/null; do
    started=$SECONDS
    xinit "$here/xsession.sh" "$launch" "$work" -- :0 vt1 -nolisten tcp -nocursor > "$work/x.out" 2>&1
    code=$?
    if (( SECONDS - started < 20 )); then quick=$((quick + 1)); else quick=0; fi
    if (( quick >= 3 )); then
        kill "$server" 2>/dev/null
        text "screen installer unavailable (X or the browser stopped $quick times within 20 s, last exit $code); using the text installer."
    fi
done
text "screen installer unavailable (backend stopped); using the text installer."
