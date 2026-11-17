{ lib, pkgs, ... }:
{
  # The x86_64 PC with the Ryzen 5 6600H, for the images that run on it.
  nixpkgs.hostPlatform = lib.mkForce "x86_64-linux";
  nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "linux-firmware" ];

  # The Radeon 660M and the Realtek network chip need firmware from outside the kernel.
  hardware.enableRedistributableFirmware = true;
  boot.initrd.kernelModules = [ "amdgpu" ];
  boot.initrd.availableKernelModules = [ "nvme" "xhci_pci" "usbhid" "r8169" ];
  # The last console is /dev/console. The serial one is how the emulator check reads and types.
  boot.kernelParams = lib.mkAfter [ "console=ttyS0,115200" "console=tty1" "rd.systemd.show_status=auto" ];
}
