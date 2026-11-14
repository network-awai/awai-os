{ lib, pkgs, ... }:
let
  theme = pkgs.runCommand "otehon-first-boot-theme" {} ''
    dest=$out/share/plymouth/themes/otehon
    mkdir -p "$dest"
    cp ${./first-boot.script} "$dest/otehon.script"
    cat > "$dest/otehon.plymouth" <<THEME
    [Plymouth Theme]
    Name=Awai Otehon data protection
    Description=Local data passphrase; not an Awai account sign-in
    ModuleName=script
    [script]
    ImageDir=$dest
    ScriptFile=$dest/otehon.script
    THEME
  '';
in {
  boot.plymouth = {
    enable = true;
    theme = "otehon";
    themePackages = [ theme ];
    font = "${pkgs.noto-fonts-cjk-sans.override { static = true; }}/share/fonts/opentype/noto-cjk/NotoSansCJK-Regular.ttc";
  };
  # State provisioning precedes sysinit. Keep the graphical password agent
  # available there; no early browser, network service, or passphrase IPC added.
  systemd.services.otehon-state.after = [ "plymouth-start.service" "systemd-ask-password-plymouth.path" ];
  systemd.services.otehon-state.serviceConfig.StandardOutput = lib.mkForce "journal";
  systemd.services.otehon-state.serviceConfig.StandardError = lib.mkForce "journal";
}
