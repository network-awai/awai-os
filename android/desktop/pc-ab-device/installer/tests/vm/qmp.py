"""Drive the installer VM over QMP from the host: keys, screenshots and a USB tablet (absolute pointer).
Run in ~/awai-x-20261124/e2e (the QMP socket is ./qmp.sock).
  qmp.py key:Return key:Right wait:2 shot:a.png move:640,360 click:640,360 type:text quit
Coordinates are screen pixels; WxH of the guest screen is read from $VM_W / $VM_H (default 1280x720)."""
import json
import os
import socket
import sys
import time

W, H = int(os.environ.get("VM_W", 1280)), int(os.environ.get("VM_H", 720))
s = socket.socket(socket.AF_UNIX)
s.connect("qmp.sock")
f = s.makefile("rw")


def rd():
    while True:
        d = json.loads(f.readline())
        if "return" in d or "error" in d:
            return d


json.loads(f.readline())


def c(x, **a):
    f.write(json.dumps({"execute": x, "arguments": a} if a else {"execute": x}) + "\n")
    f.flush()
    return rd()


c("qmp_capabilities")
M = {"(": ("shift", "9"), ")": ("shift", "0"), "{": ("shift", "bracket_left"), "}": ("shift", "bracket_right"), "[": "bracket_left", "]": "bracket_right",
     "#": ("shift", "3"), "!": ("shift", "1"), "*": ("shift", "8"), ":": ("shift", "semicolon"), ";": "semicolon", ">": ("shift", "dot"), "|": ("shift", "backslash"),
     "$": ("shift", "4"), "&": ("shift", "7"), '"': ("shift", "apostrophe"), "'": "apostrophe", ",": "comma", "~": ("shift", "grave_accent"), " ": "spc",
     "-": "minus", ".": "dot", "/": "slash", "\n": "ret", "=": "equal", "_": ("shift", "minus")}


def key(*k):
    c("send-key", keys=[{"type": "qcode", "data": x} for x in k])
    time.sleep(0.25)


def move(x, y):
    c("input-send-event", events=[{"type": "abs", "data": {"axis": "x", "value": round(x * 32767 / (W - 1))}},
                                  {"type": "abs", "data": {"axis": "y", "value": round(y * 32767 / (H - 1))}}])
    time.sleep(0.3)


def click(x, y):
    move(x, y)
    c("input-send-event", events=[{"type": "btn", "data": {"down": True, "button": "left"}}])
    time.sleep(0.1)
    c("input-send-event", events=[{"type": "btn", "data": {"down": False, "button": "left"}}])
    time.sleep(0.4)


for a in sys.argv[1:]:
    if a.startswith("shot:"):
        print(c("screendump", filename=os.path.abspath(a[5:]), format="png"))
    elif a.startswith("type:"):
        for ch in a[5:].replace("\\n", "\n"):
            m = M.get(ch, ch)
            key(*(m if isinstance(m, tuple) else (("shift", ch.lower()) if ch.isupper() else (m,))))
    elif a.startswith("key:"):
        key(*a[4:].split("+"))
    elif a.startswith("move:"):
        move(*map(float, a[5:].split(",")))
    elif a.startswith("click:"):
        click(*map(float, a[6:].split(",")))
    elif a.startswith("wait:"):
        time.sleep(float(a[5:]))
    elif a == "status":
        print(c("query-status"))
    elif a == "quit":
        print(c("quit"))
