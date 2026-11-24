#!/usr/bin/env bash
# Runs inside xinit: the installer's one GTK window. No window manager is started.
set -u
work=$1
media=$2
here=$(cd "$(dirname "$0")" && pwd)
python=${AWAI_PYTHON:-python3}
# no screen blanking, no power saving: a long write must not lose the display
command -v xset >/dev/null 2>&1 && { xset s off; xset s noblank; xset -dpms; }
command -v xsetroot >/dev/null 2>&1 && xsetroot -solid '#f2f4f8'
export GSETTINGS_BACKEND=memory NO_AT_BRIDGE=1 GDK_BACKEND=x11 GTK_A11Y=none
exec "$python" "$here/gui.py" --work-dir "$work" --media-dir "$media"
