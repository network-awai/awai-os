#!/usr/bin/env python3
"""Text front end of the Awai OS PC installer. Same guards as the screen installer: it only calls core.py.

  text_installer.py [--work-dir DIR] [--media-dir DIR]
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import core  # noqa: E402


def say(text=""):
    print(text, flush=True)


def refuse(code, detail=""):
    say(f"\nAWAI INSTALLER: {core.MESSAGES.get(code, core.MESSAGES['internal'])[1]}")
    return 1


def follow(work):
    """Another installer (the screen one, started earlier) is writing: show its state, never start a second."""
    say("An installation is already running. Waiting for it; do not power off.")
    last = None
    while True:
        st = core.status(work)
        line = f"step {st.get('step')} {int(100 * st.get('fraction', 0))}%"
        if line != last and st.get("state") == "running":
            say(line)
            last = line
        if st.get("state") != "running":
            return report(st)
        time.sleep(1)


def report(st):
    if st.get("state") == "done":
        say(f"\nInstalled and verified all {st['partitions']} partitions.")
        say(f"Record: {st['record']}")
        say("Remove the USB at shutdown and select the target NVMe in the UEFI boot menu.")
        return 0
    err = st.get("error", {})
    say(f"\nAWAI INSTALLER: {core.MESSAGES.get(err.get('code'), core.MESSAGES['internal'])[1]} (step {err.get('step')}: {err.get('detail', '')})")
    say("Nothing was written to the SSD." if st.get("written") != "started" else "Writing had started: the SSD may be partly written.")
    return 1


def main(argv=None, host=None, read=input):
    ap = argparse.ArgumentParser()
    ap.add_argument("--work-dir", default=core.DEFAULT_WORK)
    ap.add_argument("--media-dir", default=core.DEFAULT_MEDIA)
    a = ap.parse_args(argv)
    host = host or core.Host()
    core.ensure_work(a.work_dir)
    if core.status(a.work_dir).get("state") == "running":
        return follow(a.work_dir)
    if core.write_started(a.work_dir):
        return refuse("record-exists")

    say("\nAwai OS Meiji | Offline PC installer")
    say("Pilot candidate. Release AVB is disabled.\n")
    disks = core.list_disks(host, a.media_dir)
    for d in disks:
        why = "eligible" if d["eligible"] else "not selectable: " + "; ".join(core.MESSAGES[p][1] for p in d["problems"])
        say(f"  {d['path']:<16} {d['size'] / 2**30:8.1f} GiB  {d['model']:<20} {why}")
    say("\nOnly an explicitly selected blank NVMe is eligible.")
    try:
        target = read("Whole NVMe path, or Enter to cancel: ").strip()
    except EOFError:
        return 0
    if not target:
        return 0
    name = os.path.basename(target)
    if host.dev_path(name) != target:
        return refuse("not-nvme")
    try:
        ident = core.confirm_target(host, a.media_dir, name)
    except core.Refusal as e:
        return refuse(e.code)
    say(f"\nTarget: {target}  {ident['size']} bytes  {ident['model']}")
    try:
        typed = read(f"\nTo write the Awai partitions, type INSTALL {name}: ")
    except EOFError:
        return 0
    if typed != f"INSTALL {name}":
        say("Cancelled.")
        return 0
    last = [None]

    def show(st):
        line = f"step {st['step']}/3 {int(100 * st['fraction'])}%"
        if line != last[0]:
            say(line)
            last[0] = line

    try:
        st = core.run_install(host, a.work_dir, a.media_dir, {"device": name, "typed": name, "identity": ident}, on_update=show)
    except core.Busy:
        return follow(a.work_dir)
    except core.Blocked:
        return refuse("record-exists")
    return report(st)


if __name__ == "__main__":
    sys.exit(main())
