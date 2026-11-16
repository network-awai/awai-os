# An operator can provide the same fixed-output archive from local storage.
# An explicitly supplied source must be an absolute path and never falls back
# to the network. Nix verifies the existing unpacked-content hash in both cases.
let
  localArchive = builtins.getEnv "AWAI_NIXPKGS_ARCHIVE";
  source = if localArchive == "" then
    "https://github.com/NixOS/nixpkgs/archive/f5c082a40f7571c266e74e80ae2e68aadd8a9fc7.tar.gz"
  else if builtins.substring 0 1 localArchive == "/" then
    "file://${localArchive}"
  else throw "AWAI_NIXPKGS_ARCHIVE must be an absolute path";
in builtins.fetchTarball {
  url = source;
  sha256 = "11cw91q3r1nrlh3sc86n1jipgijy3njp3z9s3j0rwi6mi2adc6ki";
}
