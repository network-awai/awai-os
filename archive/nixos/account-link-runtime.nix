{ pkgs }:
pkgs.runCommand "murakumo-account-link-runtime" {} ''
  mkdir -p $out
  cp ${./account-link.mjs} $out/account-link.mjs
  cp ${./node-root-receipt.mjs} $out/node-root-receipt.mjs
  cp ${./node-root-receipt-provenance.json} $out/node-root-receipt-provenance.json
''
