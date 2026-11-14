let
  pkgs = import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; };
  system = (import (pkgs.path + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../otehon/usb-install-6600h.nix ];
  }).config;
in pkgs.runCommand "otehon-offline-usb-vm-check" {
  nativeBuildInputs = [ pkgs.python3 pkgs.jdk pkgs.qemu_test pkgs.netpbm (pkgs.tesseract.override { enableLanguages = [ "eng" "jpn" ]; }) ];
  OTEHON_OCR_LANG = "eng+jpn";
  requiredSystemFeatures = [ "kvm" ];
} ''
  # Run the actual-image OCR regression with the same pinned tools as the VM.
  for tool in pngtopnm pamcut ppmtopgm pgmtopbm pnminvert pamenlarge tesseract; do command -v "$tool" >/dev/null; done
  OTEHON_VISUAL_HELPER=${../../scripts/otehon-installed-boot.py} \
    OTEHON_HELLO_FIXTURE=${../../tests/otehon/fixtures/desktop-hello-logo.png} \
    OTEHON_CONSOLE_FIXTURE=${../../tests/otehon/fixtures/console-erase-refused.png} \
    python3 ${../../tests/otehon/test_installer_ocr.py}
  ${pkgs.jdk}/bin/java -Djava.awt.headless=true -cp "${pkgs.clojure}/libexec/clojure-tools-${pkgs.clojure.version}.jar" \
    clojure.main ${../../tests/otehon/installer-client.clj} ${../otehon/installer-ui/awai/installer.cljc}
  iso=$(echo ${system.system.build.isoImage}/iso/*.iso)
  status=0
  python3 ${../../scripts/check-otehon-usb-vm.py} --iso "$iso" --output "$PWD/proof" \
    --ovmf-code ${pkgs.OVMF.fd}/FV/OVMF_CODE.fd --ovmf-vars ${pkgs.OVMF.fd}/FV/OVMF_VARS.fd \
    --digests ${system.system.build.otehonUsbDigests} --graphical --installed-boot --target-bus nvme \
    --media-bytes 61949214720 --visual-helper ${../../scripts/otehon-installed-boot.py} || status=$?
  mkdir text-run
  # Independent scratch scope: collect console evidence even if the GUI path
  # fails. A prior failure is retained; qualification still requires both.
  (cd text-run; python3 ${../../scripts/check-otehon-usb-vm.py} --iso "$iso" --output "$PWD/proof" \
      --ovmf-code ${pkgs.OVMF.fd}/FV/OVMF_CODE.fd --ovmf-vars ${pkgs.OVMF.fd}/FV/OVMF_VARS.fd \
      --digests ${system.system.build.otehonUsbDigests} --text-console --installed-boot --target-bus nvme \
      --media-bytes 61949214720 --visual-helper ${../../scripts/otehon-installed-boot.py}) || status=$?
  if [ -d text-run/proof ]; then cp -a text-run/proof proof/text-console; fi
  cp ${system.system.build.otehonInstallerInfo} proof/installer-info.json
  if [ -f proof/screen.ppm ]; then pnmtopng proof/screen.ppm > proof/screen.png; rm proof/screen.ppm; fi
  cp -a proof "$out"
  exit "$status"
''
