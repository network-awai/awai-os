{ config, lib, modulesPath, pkgs, ... }:
let
  installed = (import (pkgs.path + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ./disk-6600h.nix ];
  }).config;
  disk = installed.system.build.image;
  version = lib.removeSuffix "\n" (builtins.readFile ./installer-version.txt);
  buildId = builtins.hashString "sha256" (builtins.concatStringsSep "\n" (
    (map builtins.readFile [ ./usb-install-6600h.nix ./installer-runtime.nix ./installer-storage-isolation.nix ./installer-console.py ./installer-nbd.nix ./netboot-nbd-install-6600h.nix ./installer-broker.py ./installer-kernel-claims.py ./installer-installed-logs.py ./installer-diagnostics.py ./installer-boot.py ./installer-ui/awai/installer.cljc ../../ci/nixpkgs.nix ]) ++ [ (builtins.unsafeDiscardStringContext (toString disk)) ]));
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
  console = pkgs.writeShellScript "otehon-installer-console" ''
    export LANG=ja_JP.UTF-8 LC_ALL=ja_JP.UTF-8 PYTHONUTF8=1
    case "$1" in
      tty[0-9]*)
        exec ${pkgs.fbterm}/bin/fbterm --font-names="Noto Sans CJK JP" --font-size=22 -- ${pkgs.python3}/bin/python3 ${./installer-console.py}
        ;;
      *) exec ${pkgs.python3}/bin/python3 ${./installer-console.py} ;;
    esac
  '';
  source = config.otehon.installerNbd;
  # A rebuilt disk has fresh filesystem/GPT identifiers. Network delivery must
  # admit the exact qualified ISO payload, never hashes of a different rebuild.
  digests = if source.enable then pkgs.runCommand "otehon-pinned-network-digests" {} ''
    mkdir "$out"
    printf '%s\n' ${lib.escapeShellArg source.payloadSha256} > "$out/image"
    printf '%s\n' ${lib.escapeShellArg source.rawSha256} > "$out/raw"
    printf '%s\n' ${lib.escapeShellArg (toString source.rawBytes)} > "$out/bytes"
  '' else pkgs.runCommand "otehon-usb-payload-digests" { nativeBuildInputs = [ pkgs.zstd ]; } ''
    mkdir "$out"
    file=$(echo ${disk}/*.raw.zst)
    sha256sum "$file" | cut -d' ' -f1 > "$out/image"
    zstd -dc "$file" | sha256sum | cut -d' ' -f1 > "$out/raw"
    zstd -dc "$file" | wc -c > "$out/bytes"
  '';
in {
  # Transport-independent installer services, UI, broker and payload contract.
  imports = [ ./common.nix ./hardware-6600h.nix ./installer-nbd.nix ./installer-storage-isolation.nix ];
  system.image.version = version;
  users.users.root.hashedPassword = "!";
  services.openssh.enable = false;
  systemd.services."getty@tty1".enable = false;
  systemd.services."autovt@tty1".enable = false;
  systemd.services."getty@tty2".enable = false;
  systemd.services."autovt@tty2".enable = false;
  systemd.services."serial-getty@ttyS0".enable = false;
  systemd.services."otehon-install@" = {
    description = "Offline Awai Otehon installer on %I";
    after = [ "local-fs.target" "systemd-udev-settle.service" "systemd-user-sessions.service" "otehon-install-broker.service" ];
    requires = [ "otehon-install-broker.service" ];
    environment = { IMAGE_URL = "file:///iso/otehon/image.raw.zst"; DIGESTS = "${digests}"; OTEHON_INSTALLER_INFO = "${infoJson}"; OTEHON_REGISTER_BOOT = "1"; };
    serviceConfig = {
      ExecStart = "${console} %I";
      User = "otehon-installer";
      SupplementaryGroups = [ "video" "tty" ];
      AmbientCapabilities = [ "CAP_SYS_TTY_CONFIG" ];
      CapabilityBoundingSet = [ "CAP_SYS_TTY_CONFIG" ];
      NoNewPrivileges = true;
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
  fonts.fontconfig.enable = true;
  i18n.supportedLocales = [ "ja_JP.UTF-8/UTF-8" "en_US.UTF-8/UTF-8" ];
  services.xserver.enable = true;
  services.xserver.displayManager.lightdm.enable = true;
  # Keep the physical text installer on VT1 even when GPU/session startup fails.
  services.xserver.displayManager.lightdm.extraConfig = "minimum-vt = 7";
  services.displayManager.autoLogin = { enable = true; user = "otehon-installer"; };
  services.displayManager.defaultSession = "otehon-install";
  boot.loader.timeout = 10;
  # Keep boot progress out of the operator's prompt and version banner. Errors
  # remain in the console/journal; only routine boot status is quieted.
  boot.consoleLogLevel = 3;
  boot.initrd.verbose = false;
  # hardware-6600h appends rd.systemd.show_status=auto at mkAfter (1500).
  # Put the installer override after it: the kernel uses the final value.
  boot.kernelParams = lib.mkOrder 1600 [ "quiet" "systemd.show_status=false" "rd.systemd.show_status=false" ];
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
  system.build.otehonInstallerPayload = disk;
  system.build.otehonInstallerConsole = console;
  system.build.otehonUsbDigests = digests;
  system.build.otehonInstallerInfo = infoJson;

}
