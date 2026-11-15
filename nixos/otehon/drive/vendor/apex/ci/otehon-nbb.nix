{ pkgs }:
let
  nbb = pkgs.fetchurl {
    url = "https://registry.npmjs.org/nbb/-/nbb-1.4.208.tgz";
    hash = "sha512-SvkQfK+wKKy10F7c4llVX/+ys0sKEHeFwLPIA3UFrD3LBjLKbkUv7huQcHviZ1rEZ/qffTHp9u2OioyekqVgOA==";
  };
  resolve = pkgs.fetchurl {
    url = "https://registry.npmjs.org/import-meta-resolve/-/import-meta-resolve-4.2.0.tgz";
    hash = "sha512-Iqv2fzaTQN28s/FwZAoFq0ZSs/7hMAHJVX+w8PZl3cY19Pxk6jFFalxQoIfW2826i/fDLXv8IiEZRIT0lDuWcg==";
  };
in pkgs.runCommand "awai-otehon-nbb-1.4.208" {
  nativeBuildInputs = [ pkgs.makeWrapper ];
} ''
  mkdir -p "$out/lib/nbb/node_modules/import-meta-resolve" "$out/bin"
  tar xzf ${nbb} --strip-components=1 -C "$out/lib/nbb"
  tar xzf ${resolve} --strip-components=1 -C "$out/lib/nbb/node_modules/import-meta-resolve"
  makeWrapper ${pkgs.nodejs_22}/bin/node "$out/bin/nbb" --add-flags "$out/lib/nbb/cli.js"
''
