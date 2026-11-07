# Awai Otehon desktop 0.5.0

A chat-centred React shell in Chromium on Wayland, on the pinned NixOS system
(`network-awai/network-awai-apex` ADR 0026 D9, D12 and D13, AWAI-160). A first-run
setup with a required sign-in comes first ([login-0.5.0.md](login-0.5.0.md)). Then each
Itonami dapp is a context in the sidebar and has a panel with its declared properties. Zenoh and
Matter run as system services, and the shell shows whether it can reach them.

| Layer | Component |
| --- | --- |
| Shell | React 19, bundled by esbuild, loaded from a local file |
| Dapp list | `nixos/otehon/shell/src/dapps.json`, a snapshot of `kotoba-lang/kotoba` `lib/kotoba.aiueos/distributions/awai/dapps` at `f1096f0e` |
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
gate=1 failed=0` and a saved screenshot, `1` another state or no report, `3` the check
could not run.

`react`, `zenoh`, `matter` and `gate` come from the page title, which React sets
after it reaches each service. `gate=1` means a fresh boot shows setup and renders no
dapps. When a service is missing, the boot report also prints
recent logs to the serial console.

The negative control is the `desktop-no-zenoh` profile, which must exit 1.

## Evidence (2026-11-07, Apple M1 Max, QEMU 10.0.3 with HVF)

| Item | Result |
| --- | --- |
| nixpkgs | `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7` |
| Raw image SHA-256 | `101d4b411b095e2c9b1aa8157d02f11f71670b1e147fda7375ecde69da977bc1` |
| Boot | `compositor=1 chromium=1 react=1 zenoh=1 matter=1 gate=1 failed=0` at 56 s, exit 0 |
| Screen | The Hello step of setup |

## Known gaps

- No agent answers. Messages only stay in the browser on this device.
- The dapp panel shows what the manifest declares. The dapps themselves do not run,
  and the network operations listed there cannot be started.
- See [login-0.5.0.md](login-0.5.0.md) for what sign-in and trust cover.
- The clock is in UTC. Japanese text and input were not checked in the VM, and the
  image has no input method.
- Zenoh is checked through its REST admin path on one node. No data passed between
  nodes.
- Matter is checked by the server's WebSocket greeting. No device was commissioned.
  With no network, the server fetched 0 PAA root certificates and no vendor data.
- A person using the window, writes across a reboot, a reproducing second build,
  x86_64, physical hardware and CI are not verified.
- ROS 2, Hermes Agent and Holochain are not in this image.
