{ pkgs, ... }:
let
  # An explicit source set avoids embedding a checkout's .git, local files or
  # credentials. Preserve relative imports for a later reviewed host config.
  files = [
    "AGENTS.md" "LICENSE" "ci/nixpkgs.nix"
    "desktop/index.html" "desktop/desktop.css" "desktop/desktop.js"
    "archive/nixos/native/entry-input.kotoba" "archive/nixos/native/kaikei-entry.kotoba" "archive/nixos/native/dandori-entry.kotoba"
    "archive/nixos/murakumo-nixos.nix" "archive/nixos/native-workspace.nix"
    "archive/nixos/native-package.nix" "archive/nixos/native-sources.json"
    "archive/nixos/network-update.nix" "archive/nixos/network-update.sh" "archive/nixos/network-update-build.nix"
    "archive/nixos/scripts/murakumo-network-update"
    "archive/nixos/docs/native-network-updates.md" "archive/nixos/docs/murakumo-nixos-native-preview.md"
    "docs/evidence/native-network-update-20261024.json"
    "archive/nixos/tests/network-update.nix" "archive/nixos/tests/native-workspace.nix"
    "archive/nixos/tests/network-update-eval.nix" "archive/nixos/tests/native-profile-eval.nix"
  ];
  source = file: ../. + "/${file}";
  manifest = pkgs.writeText "murakumo-native-media-manifest.json" (builtins.toJSON {
    schema = "murakumo.native-media.v1";
    networkUpdateBaseRevision = "2039e4522a9011bbc9317ea3ad42e72c1e898270";
    nixpkgsRevision = "f5c082a40f7571c266e74e80ae2e68aadd8a9fc7";
    liveNetworkUpdates = false;
    automaticDiskInstallation = false;
    files = pkgs.lib.genAttrs files (file: builtins.hashFile "sha256" (source file));
  });
  profile = pkgs.runCommand "murakumo-native-media-profile" {} ''
    mkdir -p "$out"
    ${pkgs.lib.concatMapStringsSep "\n" (file: "install -D -m 0444 ${source file} \"$out/${file}\"") files}
    cp ${manifest} "$out/media-manifest.json"
  '';
  client = pkgs.writeShellApplication {
    name = "murakumo-network-update";
    inheritPath = false;
    runtimeInputs = [ pkgs.nix pkgs.openssh pkgs.jq pkgs.coreutils ];
    text = builtins.readFile archive/nixos/scripts/murakumo-network-update;
  };
  helper = import ./network-update-build.nix { nixpkgsPath = pkgs.path; };
in {
  environment.etc."murakumo/native-profile".source = profile;
  environment.etc."murakumo/network-update-guide.md".source = archive/nixos/docs/native-network-updates.md;
  environment.systemPackages = [ client helper pkgs.jq ];
  system.build.murakumoNativeMedia = profile;
  system.build.murakumoNetworkUpdateClient = client;
}
