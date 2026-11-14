{ config, lib, pkgs, ... }:
let
  stateDir = "/var/lib/otehon";
  user = "otehon";
  uki = config.system.boot.loader.ukiFile;
  closure = pkgs.closureInfo { rootPaths = [ config.system.build.toplevel ]; };
  bootEfi = "${pkgs.systemd}/lib/systemd/boot/efi/systemd-bootx64.efi";
  native = config.otehon.shellPkgs;

  # systemd-repart cannot unshare under the x86 emulator on the build machine, so this builds the
  # same layout with the build machine's own tools. The partition labels are what the system
  # mounts by. Sizes are in 512-byte sectors.
  espSectors = 2097152;
  # Current desktop closures exceed the old 16 GiB partition (JUN-1180).
  rootSectors = 50331648; # 24 GiB; encrypted state grows separately on first boot.
  stateSectors = 524288;
  rootStart = 2048 + espSectors;
  stateStart = rootStart + rootSectors;
  image = native.runCommand "${config.system.image.id}-disk" {
    nativeBuildInputs = with native; [ dosfstools e2fsprogs gnutar gptfdisk mtools zstd ];
  } ''
    truncate -s ${toString ((stateStart + stateSectors + 2048) * 512)} disk.raw
    sgdisk \
      -n 1:2048:+${toString espSectors} -t 1:ef00 -c 1:otehon-esp \
      -n 2:${toString rootStart}:+${toString rootSectors} -t 2:8304 -c 2:otehon-root \
      -n 3:${toString stateStart}:+${toString stateSectors} -t 3:8300 -c 3:otehon-state \
      disk.raw

    truncate -s ${toString (espSectors * 512)} esp.img
    mkfs.vfat -F 32 -n OTEHON esp.img
    mmd -i esp.img ::/EFI ::/EFI/BOOT ::/EFI/Linux ::/EFI/systemd
    mcopy -i esp.img ${bootEfi} ::/EFI/BOOT/BOOTX64.EFI
    mcopy -i esp.img ${bootEfi} ::/EFI/systemd/systemd-bootx64.efi
    mcopy -i esp.img ${config.system.build.uki}/${uki} ::/EFI/Linux/${uki}
    dd if=esp.img of=disk.raw bs=1M seek=1 conv=notrunc,sparse status=none
    rm esp.img

    # The store is streamed in, so it is never held twice on the build machine.
    mkdir -p skel/nix/store
    chmod 1775 skel/nix/store
    sed 's,^/,,' ${closure}/store-paths > paths
    tar --sort=name --owner=0 --group=0 --numeric-owner --hard-dereference -cf - \
      -C skel nix nix/store \
      -C / -T paths \
      -C ${closure} --transform 's,^registration$,nix-path-registration,' registration |
      mke2fs -q -t ext4 -L otehon-root -d - -E offset=${toString (rootStart * 512)} \
        disk.raw ${toString (rootSectors / 2)}k

    mkdir $out
    zstd -q -T0 -6 --rm disk.raw -o $out/${config.system.image.id}.raw.zst
  '';
in
{
  # The desktop and the base on the x86_64 PC's own disk, written by netboot-install-6600h.nix.
  # This PC has no key disk, so the person chooses a passphrase on first boot and enters it on each
  # boot. Chromium's profile, which holds the device key and the sign-in, moves to the encrypted
  # volume. Without the passphrase that data is gone: there is no recovery.
  imports = [
    ./desktop.nix
    ./base-module.nix
    ./hardware-6600h.nix
    ./first-boot-ui.nix
  ];

  system.image.id = lib.mkForce "awai-otehon-6600h";

  # Native x86_64 builders need no aarch64 builder for static UI files.
  # Cross-build operators may still supply a reviewed shellPkgs explicitly.
  otehon.shellPkgs = lib.mkDefault pkgs;

  systemd.services.otehon-state = {
    after = [ "systemd-ask-password-console.path" ];
    path = lib.mkForce (with pkgs; [
      age
      coreutils
      cryptsetup
      e2fsprogs
      gptfdisk
      config.systemd.package
      util-linux
    ]);
    script = lib.mkForce ''
      part=/dev/disk/by-partlabel/otehon-state
      udevadm settle --timeout=30
      for _ in $(seq 1 15); do
        [ -b "$part" ] && break
        sleep 1
      done
      [ -b "$part" ] || { echo "otehon-state: no state partition"; exit 1; }

      if ! cryptsetup isLuks "$part"; then
        if [ "$(head -c 1048576 "$part" | tr -d '\000' | wc -c)" != 0 ]; then
          echo "otehon-state: refusing to format a partition that holds data"
          exit 1
        fi
        # First boot: the state partition is the last one, so it takes the rest of the disk.
        real=$(readlink -f "$part")
        disk=/dev/$(lsblk -no PKNAME "$real")
        number=$(cat "/sys/class/block/$(basename "$real")/partition")
        start=$(cat "/sys/class/block/$(basename "$real")/start")
        sgdisk -e "$disk"
        sgdisk -d "$number" -n "$number:$start:0" -t "$number:8300" -c "$number:otehon-state" "$disk"
        partx -u --nr "$number" "$disk"
        udevadm settle --timeout=30
        echo "otehon-state: size $(lsblk -bno SIZE "$real") bytes"

        while :; do
          first=$(systemd-ask-password --timeout=0 "Choose a passphrase for this PC's data (12 characters or more). Without it the data is lost:")
          if [ "''${#first}" -lt 12 ]; then
            echo "otehon-state: that passphrase is too short"
            continue
          fi
          again=$(systemd-ask-password --timeout=0 "Enter the passphrase again:")
          [ "$first" = "$again" ] && break
          echo "otehon-state: those passphrases differ"
        done
        printf %s "$first" | cryptsetup luksFormat --batch-mode --key-file=- "$part"
        printf %s "$first" | cryptsetup open --key-file=- "$part" otehon-state
        unset first again
      fi

      until [ -e /dev/mapper/otehon-state ]; do
        passphrase=$(systemd-ask-password --timeout=0 "Passphrase for this PC's data:")
        printf %s "$passphrase" | cryptsetup open --key-file=- "$part" otehon-state ||
          echo "otehon-state: that passphrase did not open the data"
        unset passphrase
      done

      if ! blkid -p /dev/mapper/otehon-state >/dev/null; then
        mkfs.ext4 -q /dev/mapper/otehon-state
      fi
      install -d -m 700 ${stateDir}
      mount /dev/mapper/otehon-state ${stateDir}
      chmod 700 ${stateDir}
      if [ ! -e ${stateDir}/age.key ]; then
        age-keygen -o ${stateDir}/age.key
        chmod 400 ${stateDir}/age.key
      fi
      install -d -m 700 -o ${user} -g users ${stateDir}/home /home/${user}
      mount --bind ${stateDir}/home /home/${user}
      echo "otehon-state: open"
    '';
  };

  system.build.image = lib.mkForce image;
}
