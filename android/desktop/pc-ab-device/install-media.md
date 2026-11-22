# Build an installation image from signed Awai PC target-files

Use the stock disk from the same Android build as the signed target-files.
Take the archive SHA-256 from the Mac signing record and the stock disk
SHA-256 from the build record. On the Linux build host, with the matching
Android host tools, run:

```sh
AWAI_ANDROID_ROOT="$ANDROID_ROOT" \
AWAI_ANDROID_HOST_OUT="$ANDROID_HOST_OUT" \
AWAI_TARGET_FILES_SHA256="$SIGNED_TARGET_FILES_SHA256" \
AWAI_STOCK_DISK_SHA256="$STOCK_DISK_SHA256" \
bash android/desktop/pc-ab-device/make-tf-disk.sh \
  "$SIGNED_TARGET_FILES" "$STOCK_DISK" "$INSTALL_IMAGE" > "$ASSEMBLY_LOG"
```

Set `ANDROID_HOST_OUT` to this build's host output directory
(`$OUT_DIR/host/linux-x86`) or to the verified extraction of its
`otatools.tar`. The directory contains `bin/` and `lib64/`.
When omitted, the assembler uses `$ANDROID_ROOT/out/host/linux-x86`.

The output path must be new. The tool reads back the populated bytes of both
boot slots, both vendor boot slots, and the reconstructed super partition.
Keep its log and the final image SHA-256 with the signing record. The stock
disk supplies the GPT, EFI bootloader, and other unmodified regions, so its
digest is also part of the build record.

Verify the installation image against its release manifest before boot or
installation. Pass that same image into the PC installer in plan mode on the
target hardware. Confirm the selected disk and GPT layout before applying the
plan. Record the image digest, machine configuration, first setup, cold boot,
and update and recovery results in AWAI-3600.
