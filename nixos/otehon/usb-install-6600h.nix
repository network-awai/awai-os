{ config, lib, modulesPath, pkgs, ... }:
let
  installed = (import (pkgs.path + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ./disk-6600h.nix ];
  }).config;
  disk = installed.system.build.image;
  version = lib.removeSuffix "\n" (builtins.readFile ./installer-version.txt);
  buildId = builtins.hashString "sha256" (builtins.concatStringsSep "\n" (
    (map builtins.readFile [ ./usb-install-6600h.nix ./install-disk.sh ./installer-broker.py ./installer-boot.py ./installer-ui/awai/installer.cljc ../../ci/nixpkgs.nix ]) ++ [ (toString disk) ]));
  # This is an identity string, not a runtime reference: retaining its context
  # would include a second compressed payload in the ISO's store closure.
  info = { schema = "awai.otehon.installer.v1"; inherit version buildId; nixos = installed.system.nixos.version; nix = installed.nix.package.version; payload = builtins.unsafeDiscardStringContext (toString disk); };
  infoJson = pkgs.writeText "otehon-installer-info.json" (builtins.toJSON info);
  infoEdn = pkgs.writeText "otehon-installer-info.edn" ''
    {:version ${builtins.toJSON version} :build-id ${builtins.toJSON buildId} :nixos ${builtins.toJSON info.nixos} :nix ${builtins.toJSON info.nix}}
  '';
  installBoot = pkgs.writeShellApplication {
    name = "otehon-install-boot";
    runtimeInputs = [ pkgs.efibootmgr pkgs.util-linux ];
    text = ''exec ${pkgs.python3}/bin/python3 ${./installer-boot.py} "$@"'';
  };
  digests = pkgs.runCommand "otehon-usb-payload-digests" { nativeBuildInputs = [ pkgs.zstd ]; } ''
    mkdir "$out"
    file=$(echo ${disk}/*.raw.zst)
    sha256sum "$file" | cut -d' ' -f1 > "$out/image"
    zstd -dc "$file" | sha256sum | cut -d' ' -f1 > "$out/raw"
    zstd -dc "$file" | wc -c > "$out/bytes"
  '';
in {
  # Offline OS administration UI; the installed desktop remains a separate payload.
  imports = [ ./common.nix ./hardware-6600h.nix "${modulesPath}/installer/cd-dvd/iso-image.nix" ];
  fileSystems."/" = lib.mkForce config.lib.isoFileSystems."/";
  networking.hostName = lib.mkForce "otehon-usb-installer";
  system.image.id = "awai-otehon-usb-installer";
  system.image.version = version;
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
  users.users.root.hashedPassword = "!";
  services.openssh.enable = false;
  systemd.services."getty@tty1".enable = false;
  systemd.services."autovt@tty1".enable = false;
  systemd.services."getty@tty2".enable = false;
  systemd.services."autovt@tty2".enable = false;
  systemd.services."serial-getty@ttyS0".enable = false;
  systemd.services."otehon-install@" = {
    description = "Offline Awai Otehon installer on %I";
    after = [ "local-fs.target" "systemd-udev-settle.service" ];
    path = with pkgs; [ bash config.systemd.package coreutils curl findutils gawk gnugrep gptfdisk jq util-linux zstd installBoot ];
    environment = { IMAGE_URL = "file:///iso/otehon/image.raw.zst"; DIGESTS = "${digests}"; OTEHON_INSTALLER_INFO = "${infoJson}"; OTEHON_REGISTER_BOOT = "1"; };
    serviceConfig = {
      ExecStart = "${pkgs.bash}/bin/bash ${./install-disk.sh}";
      StandardInput = "tty-force"; StandardOutput = "tty"; StandardError = "tty";
      TTYPath = "/dev/%I"; TTYReset = true; Restart = "always"; RestartSec = 2;
    };
  };
  # The report previously shared /dev/console with the installer prompt.
  systemd.services.otehon-boot-report.enable = lib.mkForce false;
  users.groups.otehon-installer = {};
  users.users.otehon-installer = {
    isNormalUser = true;
    group = "otehon-installer";
    hashedPassword = "!";
  };
  fonts.packages = [ (pkgs.noto-fonts-cjk-sans.override { static = true; }) ];
  services.xserver.enable = true;
  services.xserver.displayManager.lightdm.enable = true;
  # Keep the physical text installer on VT1 even when GPU/session startup fails.
  services.xserver.displayManager.lightdm.extraConfig = "minimum-vt = 7";
  services.displayManager.autoLogin = { enable = true; user = "otehon-installer"; };
  services.displayManager.defaultSession = "otehon-install";
  boot.loader.timeout = 10;
  specialisation.text-installer.configuration = {
    system.nixos.label = lib.mkForce "Text-installer-${version}";
    systemd.services.display-manager.enable = lib.mkForce false;
  };
  services.xserver.displayManager.session = [{
    name = "otehon-install";
    manage = "desktop";
    start = ''
      ${pkgs.jdk}/bin/java -Dawai.installer.info=${infoEdn} -Dawt.useSystemAAFontSettings=on -Dswing.aatext=true -cp "${pkgs.clojure}/libexec/clojure-tools-${pkgs.clojure.version}.jar:${./installer-ui}" clojure.main -m awai.installer &
      waitPID=$!
    '';
  }];
  systemd.services.otehon-install-broker = {
    description = "Bounded offline installer control (local Unix socket only)";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" "systemd-udev-settle.service" ];
    before = [ "display-manager.service" ];
    environment.DIGESTS = "${digests}";
    path = with pkgs; [ coreutils util-linux gptfdisk zstd config.systemd.package installBoot ];
    serviceConfig = {
      ExecStart = "${pkgs.python3}/bin/python3 ${./installer-broker.py}";
      Restart = "on-failure";
      UMask = "0077";
      RestrictAddressFamilies = [ "AF_UNIX" ];
      NoNewPrivileges = true;
    };
  };
  # The initial physical console is interactive without a display manager.
  # tty2 remains available with Ctrl+Alt+F2; neither
  # the local text screen nor serial operator receives a root login shell.
  systemd.targets.multi-user.wants = [ "otehon-install@tty1.service" "otehon-install@tty2.service" "otehon-install@ttyS0.service" ];
  system.build.image = lib.mkForce config.system.build.isoImage;
  system.build.otehonUsbDigests = digests;
  system.build.otehonInstallerInfo = infoJson;
}
