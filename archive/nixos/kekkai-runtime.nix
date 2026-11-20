{ pkgs }:
pkgs.runCommand "murakumo-kekkai-runtime" { nativeBuildInputs = [ pkgs.gnutar pkgs.gzip pkgs.makeWrapper ]; } ''
  mkdir -p $out
  tar -xzf ${./kekkai-runtime.tar.gz} -C $out
  cp ${./kekkai-bootstrap.cljk} $out/bootstrap.cljk
  cp ${./kekkai-setup-client.mjs} $out/setup-client.mjs
  tar -czf $TMPDIR/client.tar.gz -C $out engine src licenses bootstrap.cljk setup-client.mjs
  mv $TMPDIR/client.tar.gz $out/client.tar.gz
  makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/murakumo-kekkai \
    --add-flags "$out/engine/cli.js --classpath $out/src $out/bootstrap.cljk"
''
