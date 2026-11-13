let
  pkgs = import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; };
  system = (import (pkgs.path + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../otehon/usb-install-6600h.nix ];
  }).config;
in pkgs.runCommand "otehon-offline-usb-vm-check" {
  nativeBuildInputs = [ pkgs.python3 pkgs.qemu_test pkgs.netpbm ];
  requiredSystemFeatures = [ "kvm" ];
} ''
  iso=$(echo ${system.system.build.isoImage}/iso/*.iso)
  status=0
  python3 ${../../scripts/check-otehon-usb-vm.py} --iso "$iso" --output "$PWD/proof" \
    --ovmf-code ${pkgs.OVMF.fd}/FV/OVMF_CODE.fd --ovmf-vars ${pkgs.OVMF.fd}/FV/OVMF_VARS.fd \
    --digests ${system.system.build.otehonUsbDigests} || status=$?
  if [ -f proof/screen.ppm ]; then pnmtopng proof/screen.ppm > proof/screen.png; rm proof/screen.ppm; fi
  cp -a proof "$out"
  exit "$status"
''
