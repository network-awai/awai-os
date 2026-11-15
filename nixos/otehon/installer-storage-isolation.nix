{ config, lib, ... }:
let denyActivation = ''
  devices { use_devicesfile = 0 filter = [ "r|.*|" ] global_filter = [ "r|.*|" ] }
  activation { volume_list = [] auto_activation_volume_list = [] }
'';
in
{
  # A live installer must not activate the previous OS's volume groups while
  # merely discovering overwrite targets. Installed systems use their own
  # configuration and keep the device-mapper rules needed for encrypted state.
  services.lvm.enable = lib.mkForce false;
  boot.initrd.services.lvm.enable = lib.mkForce false;
  environment.etc."lvm/lvm.conf".text = lib.mkAfter denyActivation;
  boot.initrd.systemd.contents."/etc/lvm/lvm.conf".text =
    lib.mkIf config.boot.initrd.systemd.enable denyActivation;
  # The pinned legacy stage-1 script unconditionally runs `lvm vgchange -ay`
  # and installs LVM udev rules, independently of services.lvm.enable. Install
  # the deny policy before udev discovers any disk, including on legacy boots.
  boot.initrd.preDeviceCommands = lib.mkIf (!config.boot.initrd.systemd.enable) (lib.mkAfter ''
    mkdir -p /etc/lvm
    cat > /etc/lvm/installer.conf <<'LVM_INSTALLER_POLICY'
    ${denyActivation}
    LVM_INSTALLER_POLICY
    mv /etc/lvm/installer.conf /etc/lvm/lvm.conf
  '');
}
