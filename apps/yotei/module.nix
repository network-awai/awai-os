{ config, lib, pkgs, ... }:
let cfg = config.programs.awai-yotei;
in {
  options.programs.awai-yotei = {
    enable = lib.mkEnableOption "the independent Yotei Tauri v3 application (Otehon)";
    package = lib.mkOption { type = lib.types.package; default = pkgs.callPackage ./package.nix {}; };
  };
  config = lib.mkIf cfg.enable { environment.systemPackages = [ cfg.package ]; };
}
