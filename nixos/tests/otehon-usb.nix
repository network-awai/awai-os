let
  pkgs = import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; };
  system = (import (pkgs.path + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../otehon/usb-install-6600h.nix ];
  }).config;
in pkgs.runCommand "otehon-offline-usb-vm-check" {
  nativeBuildInputs = [ pkgs.python3 pkgs.qemu_test ];
  requiredSystemFeatures = [ "kvm" ];
} ''
  iso=$(echo ${system.system.build.isoImage}/iso/*.iso)
  python3 ${../../scripts/check-otehon-usb-vm.py} --iso "$iso" --output "$out" \
    --ovmf-code ${pkgs.OVMF.fd}/FV/OVMF_CODE.fd --ovmf-vars ${pkgs.OVMF.fd}/FV/OVMF_VARS.fd \
    --digests ${system.system.build.otehonUsbDigests}
''
