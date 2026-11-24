#!/usr/bin/env bash
# Awai OS PC installer entry (tty1 autorun on the USB). Tries the screen installer (X + one GTK window); if X or GTK cannot
# start, says why in one line and continues with the text installer, same guards (core.py).
#   start.sh           screen installer, text fallback
#   start.sh --text    text installer only; also chosen by the kernel option awai.installer=text
set -u
umask 077
export LC_ALL=C

here=$(cd "$(dirname "$0")" && pwd)
media=${AWAI_MEDIA_DIR:-$(dirname "$here")}
work=${AWAI_WORK_DIR:-/run/awai-pc-installer}
python=${AWAI_PYTHON:-python3}
export AWAI_PYTHON=$python

text() {
    printf 'AWAI INSTALLER: %s\n' "$1" >&2
    exec "$python" "$here/text_installer.py" --work-dir "$work" --media-dir "$media"
}

install -d -m 0700 "$work" || text "cannot create $work; using the text installer."

if [[ ${1:-} == --text ]]; then text "text mode requested."; fi
if grep -qw 'awai.installer=text' /proc/cmdline 2>/dev/null; then text "text mode requested (awai.installer=text)."; fi
command -v xinit >/dev/null 2>&1 || text "screen installer unavailable (xinit not found); using the text installer."
"$python" -c 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("Gdk", "3.0"); from gi.repository import Gtk, Gdk, Pango' 2>/dev/null \
    || text "screen installer unavailable (Python GTK 3 bindings not available); using the text installer."
[[ -f $here/gui.py && -f $here/fonts/NotoSansJP-Regular.ttf ]] || text "screen installer unavailable (GUI files missing); using the text installer."

# One GTK window on a bare X server (no window manager: nothing to switch to, no Alt shortcuts). When the window process
# ends - closed, killed, crashed - X ends with it and this loop starts it again; it shows the true install state, and a
# running write (a detached worker) is never affected. Three sessions that die within 20 s each mean the screen installer
# does not work here: fall back to text.
quick=0
while true; do
    started=$SECONDS
    xinit "$here/xsession.sh" "$work" "$media" -- :0 vt1 -nolisten tcp -nocursor > "$work/x.out" 2>&1
    code=$?
    if (( SECONDS - started < 20 )); then quick=$((quick + 1)); else quick=0; fi
    if (( quick >= 3 )); then
        text "screen installer unavailable (X or the GTK window stopped $quick times within 20 s, last exit $code); using the text installer."
    fi
done
