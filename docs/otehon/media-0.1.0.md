# Awai Otehon media 0.1.0

Speech and images generated inside the OS, with nothing leaving the machine (AWAI-160). The chat
composer in the shell has **Speak** and **Image** buttons. They call a local service, which starts
a command-line tool for each request.

| Part | What it is |
| --- | --- |
| Service | `nixos/otehon/media-service.py`, on `127.0.0.1:8770`. It runs as a dynamic user, and systemd denies it every address except localhost |
| Speech | Piper 1.4.2 with the `en_US-lessac-medium` voice, which is in the image |
| Images | `stable-diffusion.cpp` on Vulkan with the Qwen-Image `Q2_K` weights, which are not in the image |
| Weights | Arrive on a read-only virtiofs share tagged `otehon-models`. Without it, images are refused with `image-model-missing` and the Image button is off |
| GPU in a VM | krunkit with Venus over MoltenVK, using `nixos/otehon/gpu.nix` and the Mesa patch in `nixos/otehon/mesa-venus-macos` |

The service accepts the origin `null`, which is what the shell's `file://` page sends, and requests
with no origin. It checks the `Host` header, so a web page cannot reach it through DNS rebinding.

## Limits

- **Images are 256x256 only.** 384x384 gave noise and still exited 0, so the service refuses it.
- **Speech is English only.** Piper 1.4.2 refuses the only Japanese voice tried, `ja_JP-hi_fi_captain-medium`, with `ValueError: 'japanese' is not a valid PhonemeType`. Text with kana or kanji gets "no voice for this language" in the shell.
- **krunkit has no display.** krunkit 1.3.2 gives a GPU for compute with no scanout. The kernel logs `[drm] KMS disabled`, and cosmic-comp stops with `Backend initialized without output`. No renderer setting or Chromium flag can change that. So the two halves are checked separately:

| | krunkit | QEMU |
| --- | --- | --- |
| Profile | `desktop-media` | `desktop-media-gui` |
| Shell runs in | Headless Chromium, no compositor | cosmic-comp and Chromium, with a display |
| GPU compute | Yes | No |
| Qwen weights | Yes | No |
| Images | Generated | Refused with `image-model-missing` |

So on a Mac today, no single VM has both a window and fast images. A person cannot see generated
images in a window on this Mac until something provides both.

## Check

Build the profile as in [vm-0.1.0.md](vm-0.1.0.md), then:

```bash
# GPU images and speech. The image changes, so use a copy. The results directory must exist.
nixos/otehon/desktop-media-krunkit.sh desktop-media.raw <models-dir> <results-dir> serial.log

# Speech with a display, and the refusal when there are no weights.
nixos/otehon/desktop-login-check-qemu.sh desktop-media-gui.qcow2 serial.log shot.ppm 600

# Negative control: the same check, with a voice that writes silence. It must exit 1.
nixos/otehon/desktop-login-check-qemu.sh desktop-media-silent.qcow2 serial.log shot.ppm 600
```

Exit codes: `0` every step passed, `1` a step failed or no result before the timeout, `3` the check
could not run.

**Exit 0 does not mean a good image.** Look at each PNG. A noise image passes every step.

## Evidence (2026-11-07, Apple M1 Max, 32 GB, krunkit 1.3.2, macOS 26.4)

Under krunkit, raw `2c92ca214975383d81ef8f97890cd3c071be1bfc1a87131ffd34492e3e073af1`, exit 0,
`result=pass`, with all 14 sign-in steps passing first. nixpkgs `f5c082a40f7571c266e74e80ae2e68aadd8a9fc7`.

| Case | Result |
| --- | --- |
| Image through the shell, default settings, 8 steps, seed 42 | `render_node=1`, 47.0 s, `f5c9eced4640b65133acbdfb2e100ced764887f2ebf983f28c39c0372e9c0ee7` |
| What the image shows, read by eye | A red torii gate on a green hill against a pale sky, clean edges |
| Same image as the earlier direct GPU run | Byte-identical to `gpu-all.png` from `sd-cli` |
| Earlier direct CPU run, same settings | Different file, `1ff51715...`, 533 s |
| Speech through the service, `en` | 28928 samples, peak 32767, 1.04 s |
| Speech through the shell | 38400 samples, peak 32767, and the audio element reports a duration |
| WAV read again on the Mac | 22050 Hz, 1.31 s, RMS 6571.5, 11 of 13 windows above 200 RMS, `05b0c228...` |
| Japanese text in the shell | "Could not generate this: no voice for this language" |
| Service socket | `0100007F:2242`, loopback only, with `IPAddressDeny=0.0.0.0/0 ::/0` |

`render_node=1` means the running `sd-cli` held `/dev/dri/renderD128`, sampled from `/proc` during
the job. If it never did, the step fails with `image-not-on-gpu`. That failure has not been
exercised, because this check has no run without a GPU. The hash match with the direct GPU run, and
the mismatch with the CPU run, are separate evidence that the job ran on the GPU.

### Refusals

All in one run, against the real service in the VM:

| Request | Result |
| --- | --- |
| Empty text for speech and image, blank text for speech | 400 `empty-text` |
| 2001 characters | 413 `text-too-long` |
| Voice `../../etc`, `de`, `ja` | 400 `unknown-voice` |
| Origin `https://evil.example`, speech and image | 403 `bad-origin` |
| Host `evil.example` | 403 `bad-host` |
| Size 9999, 384 | 400 `bad-size` |
| Steps 9999, 0 | 400 `bad-steps` |
| Seed -1 | 400 `bad-seed` |
| `/files/../../etc/passwd` and `/files/..%2f..%2fetc%2fpasswd`, sent on a raw socket | 404 `not-found`, with no file content |
| A well-formed file name that does not exist | 404 `not-found` |
| Unknown job | 404 `unknown-job` |

The cases that succeed are the positive control: the same service, with origin `null` and valid
values, produced the speech and the image above.

### QEMU and the negative control

Not recorded yet. These runs are in progress.

### What earlier runs got wrong

These all reported something that looked fine, or failed for a reason that was not obvious:

- A 384x384 image through the service, raw `45241d9716627ea6bd8f5a133451e6f7771227ce01c1d91df6b48ae48f481495`, took 77.2 s, exited 0 and is noise. An earlier 384x384 run with `--vae-tiling` was also noise, and tiling was wrongly blamed for it. The cause is not known. The 256x256 size has given clean results on both CPU and GPU.
- A refused request left its body on a keep-alive connection, so the next request read it as a request line and got an HTML 400. Refusals now close the connection.
- Piper ignores `-c` and reads the config from the model path plus `.json`, so a voice with separate store paths failed with `FileNotFoundError`. Each voice is now a directory holding both files.
- With greetd off, `graphical.target` was no longer the default, so none of the services started. The VM looked idle until the timeout.

## Not verified or not implemented

- A person listening. The WAV is checked for level and shape only, so nothing here shows that the words are correct. Audio output from a VM is not checked either: `duration > 0` only shows that the file decodes.
- Generated images in a window. See "krunkit has no display".
- 384x384 and larger. It is refused, and the cause of the noise is unknown.
- Japanese speech.
- Image quality beyond one prompt and one seed. The `Q2_K` weights are heavily quantized.
- Whether `IPAddressDeny` stops an actual outgoing connection. These VMs have no network adapter, so the setting and the listening socket were read, but no connection was attempted.
- Physical hardware, x86_64, and an x86 or other GPU. krunkit is experimental in Lima, and the Mesa patch is marked as a hack by its source.
- Disk use and speed outside this Mac. The speed comes from a few runs, with other work on the host.
- Installing or updating the weights. They are a local share on this Mac, not part of any release or download flow, and they are not checked by digest when the service starts.
- Generated files are never removed from `/var/lib/otehon-media`.
- A job in progress does not survive a reload of the shell: it reads as interrupted, while the service finishes it.
- The prompt is on the `sd-cli` command line while a job runs, so other processes in the VM can read it.
