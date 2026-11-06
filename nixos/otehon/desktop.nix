{ config, lib, pkgs, ... }:
let
  user = "otehon";
  # Same desktop id as the upstream entry, so the Awai name replaces it.
  renamed = id: name: exec: icon: lib.hiPrio (pkgs.makeDesktopItem {
    name = id;
    desktopName = name;
    inherit exec icon;
    categories = [ "Utility" ];
  });
  added = id: name: exec: icon: pkgs.makeDesktopItem {
    name = id;
    desktopName = name;
    inherit exec icon;
    categories = [ "Utility" ];
  };
in
{
  # Awai Otehon local desktop (ADR 0026). The user has no password and logs in
  # automatically, so this image is for a local VM only. It has no SSH or keys.
  imports = [ ./common.nix ];

  system.image.id = "awai-otehon-desktop";
  system.image.version = "0.2.0";

  services.displayManager.gdm.enable = true;
  services.desktopManager.gnome.enable = true;
  services.gnome.core-apps.enable = false;
  services.gnome.core-developer-tools.enable = false;
  services.gnome.games.enable = false;
  services.gnome.gnome-initial-setup.enable = lib.mkForce false;
  services.gnome.gnome-software.enable = true;
  services.flatpak.enable = true;
  environment.gnome.excludePackages = [ pkgs.gnome-tour pkgs.gnome-user-docs ];
  documentation.nixos.enable = false;

  users.users.${user} = {
    isNormalUser = true;
    hashedPassword = "!";
  };
  services.displayManager.autoLogin = {
    enable = true;
    inherit user;
  };

  # Only apps with an Otehon installed in this image appear here.
  environment.systemPackages = [
    pkgs.gnome-clocks
    pkgs.gnome-calendar
    (renamed "org.gnome.Settings" "Settei" "gnome-control-center" "org.gnome.Settings")
    (renamed "org.gnome.clocks" "Tokei" "gnome-clocks" "org.gnome.clocks")
    (renamed "org.gnome.Calendar" "Yotei" "gnome-calendar" "org.gnome.Calendar")
    (renamed "org.gnome.Software" "Itonami Apps" "gnome-software" "org.gnome.Software")
    (added "awai-wifi" "Wi-Fi" "gnome-control-center wifi" "network-wireless")
    (added "awai-bluetooth" "Bluetooth" "gnome-control-center bluetooth" "bluetooth")
  ];

  programs.dconf.profiles.user.databases = [{
    settings = {
      "org/gnome/shell" = {
        favorite-apps = [
          "org.gnome.Software.desktop"
          "org.gnome.Calendar.desktop"
          "org.gnome.clocks.desktop"
          "awai-wifi.desktop"
          "awai-bluetooth.desktop"
          "org.gnome.Settings.desktop"
        ];
        welcome-dialog-last-shown-version = "999";
      };
      "org/gnome/desktop/session".idle-delay = lib.gvariant.mkUint32 0;
      "org/gnome/desktop/screensaver".lock-enabled = false;
    };
  }];

  systemd.services.otehon-boot-report = {
    wantedBy = lib.mkForce [ "graphical.target" ];
    after = lib.mkForce [ "graphical.target" ];
    path = [ pkgs.procps ];
    script = ''
      shell=0
      for _ in $(seq 1 90); do
        if pgrep -u ${user} -f gnome-shell >/dev/null; then shell=1; break; fi
        sleep 2
      done
      sleep 10
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)
      echo "OTEHON_BOOT_REPORT id=${config.system.image.id} version=${config.system.image.version} nixos=${config.system.nixos.version} gnome_shell=$shell failed=$failed"
    '';
  };

  image.repart.partitions = {
    esp.repartConfig.SizeMinBytes = "256M";
    root.repartConfig = {
      SizeMinBytes = "12G";
      SizeMaxBytes = "12G";
    };
  };
}
