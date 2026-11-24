"""Which key presses the screen installer swallows. Pure Python so it is tested without GTK.
Nothing with Ctrl, Alt or Meta/Super gets through (no shortcuts, no accelerators, no mnemonics), nor function keys,
the menu key, Print or SysRq. Tab, Shift+Tab, Enter, Space, arrows, Backspace and text keys reach the widgets."""
import re

CTRL, ALT, META = 0x4, 0x8, 0x4000000 | 0x8000000 | 0x10000000  # GDK_CONTROL_MASK, GDK_MOD1_MASK, SUPER/HYPER/META masks
BLOCKED_NAMES = {"Menu", "Print", "Sys_Req", "Break", "Pause", "Scroll_Lock", "Multi_key", "Help", "Meta_L", "Meta_R", "Super_L", "Super_R",
                 "Hyper_L", "Hyper_R", "Alt_L", "Alt_R", "ISO_Level3_Shift"}


def swallow(keyname, state):
    if state & (CTRL | ALT | META):
        return True
    if keyname is None:
        return False
    if re.fullmatch(r"F\d+", keyname) or re.fullmatch(r"XF86\w+", keyname) or keyname in BLOCKED_NAMES:
        return True
    return False
