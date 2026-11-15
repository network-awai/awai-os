{ config, lib, modulesPath, ... }:
let
  disk = config.system.build.otehonInstallerPayload;
  version = config.system.image.version;
in {
  # USB transport for the shared installer runtime.
  imports = [ ./installer-runtime.nix "${modulesPath}/installer/cd-dvd/iso-image.nix" ];
  fileSystems."/" = lib.mkForce config.lib.isoFileSystems."/";
  networking.hostName = lib.mkForce "otehon-usb-installer";
  system.image.id = "awai-otehon-usb-installer";
  image.baseName = lib.mkForce "awai-otehon-${version}-usb-x86_64";
  isoImage = {
    volumeID = "AWAI_OTEHON";
    prependToMenuLabel = "Awai Otehon Installer ${version} - ";
    makeEfiBootable = true;
    makeUsbBootable = true;
    makeBiosBootable = true;
    squashfsCompression = "zstd -Xcompression-level 6";
    contents = [{ source = "${disk}/awai-otehon-6600h.raw.zst"; target = "/otehon/image.raw.zst"; }];
  };
  system.build.image = lib.mkForce config.system.build.isoImage;

}
