#!/usr/bin/env bash
# Runs inside xinit: the installer's one GTK window. No window manager is started.
set -u
work=$1
media=$2
here=$(cd "$(dirname "$0")" && pwd)
python=${AWAI_PYTHON:-python3}
# no screen blanking, no power saving: a long write must not lose the display
command -v xset >/dev/null 2>&1 && { xset s off; xset s noblank; xset -dpms; }
command -v xsetroot >/dev/null 2>&1 && { xsetroot -solid '#f2f4f8'; xsetroot -cursor_name left_ptr; }  # a visible pointer: the mouse works
# Each connected monitor at its preferred mode (a stale or lower mode is what cuts a screen off), all outputs at the same origin
# (mirrored), and one primary: the one X already marks, else the first connected. gui.py then uses exactly that monitor.
# The queries go to the work directory for diagnosis (output names and modes only).
if command -v xrandr >/dev/null 2>&1; then
    {
        echo "== xrandr --query (before)"; xrandr --query 2>&1
        echo "== xrandr --auto"; xrandr --auto 2>&1 || echo "(xrandr --auto failed: $?)"
        primary=$(xrandr --query 2>/dev/null | awk '/ connected primary /{print $1; exit}')
        [ -n "$primary" ] || primary=$(xrandr --query 2>/dev/null | awk '/ connected/{print $1; exit}')
        if [ -n "$primary" ]; then echo "== primary: $primary"; xrandr --output "$primary" --primary --auto 2>&1 || true; fi
        echo "== xrandr --query (after)"; xrandr --query 2>&1
    } > "$work/xrandr.txt" 2>&1
fi
export GSETTINGS_BACKEND=memory NO_AT_BRIDGE=1 GDK_BACKEND=x11 GTK_A11Y=none
exec "$python" "$here/gui.py" --work-dir "$work" --media-dir "$media"
