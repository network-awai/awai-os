{ lib, ... }: {
  imports = [ ./node-base.nix ];
  networking.hostName = "murakumo-node";
  networking.networkmanager.enable = true;
  services.murakumoAccountLink.enable = true;
  services.aiueosUpdate.enable = true;
  # Prebuilt generic x86_64 storage support; no host-side build is needed.
  boot.initrd.availableKernelModules = [
    "xhci_pci" "ahci" "nvme" "usb_storage" "usbhid" "sd_mod"
    "virtio_pci" "virtio_blk" "virtio_scsi" "sr_mod"
  ];
  hardware.enableRedistributableFirmware = true;
  hardware.cpu.intel.updateMicrocode = true;
  hardware.cpu.amd.updateMicrocode = true;
  fileSystems."/" = { device = "/dev/murakumo-root"; fsType = "ext4"; };
  # Bind this installation to its own filesystem IDs, never shared labels.
  # The offline prebuilt closure is generic; the installer writes IDs to each
  # boot entry and the retained Nix configuration after formatting.
  boot.initrd.systemd.enable = lib.mkForce false;
  boot.initrd.postDeviceCommands = ''
    mkdir -p /run/udev/rules.d
    rules=/run/udev/rules.d/99-murakumo-install.rules
    : > "$rules"
    root_uuid= boot_uuid=
    for arg in $(cat /proc/cmdline); do
      case "$arg" in
        murakumo.root_uuid=*) root_uuid="''${arg#*=}" ;;
        murakumo.boot_uuid=*) boot_uuid="''${arg#*=}" ;;
      esac
    done
    if printf '%s' "$root_uuid" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
      printf 'SUBSYSTEM=="block", ENV{ID_FS_UUID}=="%s", SYMLINK+="murakumo-root", TAG+="systemd"\n' "$root_uuid" >> "$rules"
      ln -s "/dev/disk/by-uuid/$root_uuid" /dev/murakumo-root
    fi
    if printf '%s' "$boot_uuid" | grep -Eq '^[0-9A-F]{4}-[0-9A-F]{4}$'; then
      printf 'SUBSYSTEM=="block", ENV{ID_FS_UUID}=="%s", SYMLINK+="murakumo-boot", TAG+="systemd"\n' "$boot_uuid" >> "$rules"
      ln -s "/dev/disk/by-uuid/$boot_uuid" /dev/murakumo-boot
    fi
    # Register the links with udev so stage-2 systemd device dependencies
    # recognize them. /run is moved into the installed root by stage 1.
    udevadm control --reload-rules
    udevadm trigger --subsystem-match=block
    udevadm settle
  '';
  users.users.root.hashedPassword = "!";
  services.getty.autologinUser = "root";
  # SSH requires a locally approved public key; passwords and root login stay disabled.
  system.stateVersion = "26.05";
}
