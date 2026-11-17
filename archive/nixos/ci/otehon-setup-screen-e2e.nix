# Test the shipping release shell, not an unoptimized JS surrogate.
{ nixpkgsPath ? import ../../../ci/nixpkgs.nix }:
let
  pkgs = import nixpkgsPath { system = "x86_64-linux"; };
  os = import (nixpkgsPath + "/nixos/lib/eval-config.nix") {
    system = null;
    modules = [ ../../../otehon/desktop.nix ({ lib, ... }: {
      nixpkgs.hostPlatform = lib.mkForce "x86_64-linux";
    }) ];
  };
in pkgs.runCommand "otehon-setup-screen-e2e" {
  nativeBuildInputs = [ pkgs.nodejs pkgs.chromium pkgs.openssl ];
} ''
  export HOME="$TMPDIR/home"
  mkdir -p "$HOME"
  export OTEHON_BROWSER="${pkgs.lib.getExe pkgs.chromium}"
  # Build-sandbox-only fixture browser: no owner profile or remote account.
  export OTEHON_TEST_NO_SANDBOX=1
  node ${../scripts/otehon-setup-screen-e2e.mjs} \
    --dist ${os.config.otehon.shell} --output "$TMPDIR/screen-proof"
  mkdir -p "$out"
  cp "$TMPDIR/screen-proof/proof.json" "$TMPDIR/screen-proof/"*.png "$out/"
''
