{ config, lib, modulesPath, pkgs, ... }:
let
  build = config.system.build;
  cmdline = "init=${build.toplevel}/init ${toString config.boot.kernelParams}";
  # Firmware TFTP is too slow and too fragile for a system this large, so it only carries iPXE,
  # and iPXE fetches the kernel and the system over HTTP from the machine at the other end of the
  # cable. All of it runs from RAM and nothing touches the disks.
  server = "http://10.77.0.1:8080";
  ipxe = pkgs.ipxe.override {
    embedScript = pkgs.writeText "otehon-netboot.ipxe" ''
      #!ipxe
      dhcp
      kernel ${server}/kernel initrd=initrd ${cmdline}
      initrd ${server}/initrd
      boot
    '';
  };
  image = pkgs.runCommand "awai-otehon-netboot" { } ''
    mkdir $out
    ln -s ${ipxe}/snp.efi $out/ipxe.efi
    ln -s ${build.kernel}/${config.system.boot.loader.kernelFile} $out/kernel
    ln -s ${build.netbootRamdisk}/initrd $out/initrd
    echo ${lib.escapeShellArg cmdline} > $out/cmdline
  '';
in
{
  # The desktop in RAM on the x86_64 6600H machine, over UEFI PXE. A look at real hardware, not a
  # release or an installation: nothing persists across a reboot, and no disk is written.
  imports = [
    ./desktop.nix
    ./hardware-6600h.nix
    "${modulesPath}/installer/netboot/netboot.nix"
  ];

  system.image.id = lib.mkForce "awai-otehon-netboot";
  # esbuild crashes under the x86 emulator on the build machine.
  otehon.shellPkgs = import pkgs.path { system = "aarch64-linux"; };

  # Compress lightly: this file travels over a direct gigabit link.
  netboot.squashfsCompression = "zstd -Xcompression-level 6";

  system.build.image = lib.mkForce image;
}
