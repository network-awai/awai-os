# Awai Otehon desktop 0.3.0

A React shell in Chromium on Wayland, on the pinned NixOS system
(`network-awai/network-awai-apex` ADR 0026 D9, AWAI-160). Zenoh and Matter run as
system services, and the shell shows whether it can reach them.

| Layer | Component |
| --- | --- |
| Shell | React 19, bundled by esbuild, loaded from a local file |
| Browser | Chromium in kiosk mode |
| Compositor | cosmic-comp 1.2.0, built on Smithay |
| Display protocol | Wayland |
| Data | Zenoh router, loopback only, multicast scouting off |
| Home devices | `python-matter-server`, loopback only |

The compositor is cosmic-comp because niri 26.04 logged
`software EGL renderers are skipped` and showed nothing. This VM has only software
EGL, because the Homebrew QEMU has no `virtio-gpu-gl` device.

The user has no password and logs in automatically, so this image is for a local
VM only. It has no SSH, keys or network adapter in the commands below. Chromium's
DevTools port, Zenoh REST and the Matter server are open to every process in the
VM. It is not an Itonami OS release or a complete Awai Node.

## Build

Follow [vm-0.1.0.md](vm-0.1.0.md) and add `--argstr profile desktop` to
`nix-build`. Node.js and npm are used only to build the shell, from
`nixos/otehon/shell/package-lock.json`.

## Use

```bash
nixos/otehon/run-desktop-qemu.sh otehon-desktop.qcow2
```

The window writes changes to the image. Use a copy to keep the original.

## Check

```bash
nixos/otehon/desktop-check-qemu.sh otehon-desktop.qcow2 serial.log shot.ppm
```

Exit codes: `0` report with `compositor=1 chromium=1 react=1 zenoh=1 matter=1
failed=0` and a saved screenshot, `1` another state or no report, `3` the check
could not run.

`react`, `zenoh` and `matter` come from the page title, which React sets after it
reaches each service. When a service is missing, the boot report also prints
recent logs to the serial console.

The negative control is the `desktop-no-zenoh` profile, which must exit 1.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

| Item | Result |
| --- | --- |
| nixpkgs | `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` |
| Raw image SHA-256 | `c076961d4bf7f0c3317bd8c93ef53de78676dbf92430aa34ec3e92949825dcdf` |
| Boot | `compositor=1 chromium=1 react=1 zenoh=1 matter=1 failed=0` at 56 s, exit 0 |
| Screen | The shell shows Zenoh and Matter as Running |
| Negative control | `desktop-no-zenoh` reported `zenoh=0`, exit 1 |

## Known gaps

- The shell only shows status. It cannot open apps yet.
- Zenoh is checked through its REST admin path on one node. No data passed between
  nodes.
- Matter is checked by the server's WebSocket greeting. No device was commissioned.
  With no network, the server fetched 0 PAA root certificates and no vendor data.
- A person using the window, writes across a reboot, a reproducing second build,
  x86_64, physical hardware and CI are not verified.
- ROS 2, Hermes Agent and Holochain are not in this image.
