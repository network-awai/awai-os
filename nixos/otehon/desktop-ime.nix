{ config, lib, pkgs, ... }:
{
  # Japanese input with fcitx5 and Mozc, as a profile of its own (docs/otehon/daily-0.1.0.md).
  # It is kept out of the desktop profile until it has been seen to work: cosmic-comp must offer
  # the Wayland input-method protocol to fcitx5, and Chromium must take text through text-input v3.
  # Neither has been observed in a VM yet.
  imports = [ ./desktop.nix ];

  system.image.id = lib.mkForce "awai-otehon-desktop-ime";

  i18n.inputMethod = {
    enable = true;
    type = "fcitx5";
    fcitx5 = {
      waylandFrontend = true;
      addons = [ pkgs.fcitx5-mozc ];
      settings.inputMethod = {
        GroupOrder."0" = "Default";
        "Groups/0" = {
          Name = "Default";
          "Default Layout" = "us";
          DefaultIM = "mozc";
        };
        "Groups/0/Items/0".Name = "keyboard-us";
        "Groups/0/Items/1".Name = "mozc";
      };
    };
  };

  otehon = {
    # Chromium on Wayland takes composed text only with these.
    inputArgs = [ "--enable-wayland-ime" "--wayland-text-input-version=3" ];
    # The session is started by greetd with no desktop autostart, so start fcitx5 here, on the
    # compositor's display.
    sessionPrelude = ''
      ${config.i18n.inputMethod.package}/bin/fcitx5 -d --replace
    '';
  };
}
