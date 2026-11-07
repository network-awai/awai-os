# Basilisp 0.5.1 is not in the pinned nixpkgs. Built from the PyPI wheel, by digest.
{ python3 }:
python3.pkgs.buildPythonPackage {
  pname = "basilisp";
  version = "0.5.1";
  format = "wheel";
  src = builtins.fetchurl {
    url = "https://files.pythonhosted.org/packages/b0/23/74c350bed33b7e47657177fd4f4cec560d9b6e272cedb66dc749e3ad6289/basilisp-0.5.1-py3-none-any.whl";
    sha256 = "beaed768776c45b9b63042bcb5f5632db13746d7c5df1ae72d600d0095ed334d";
  };
  dependencies = with python3.pkgs; [ attrs immutables prompt-toolkit pyrsistent typing-extensions ];
}
