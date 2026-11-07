# ADR 0027 V1: one real order inside a NixOS VM with no network. The VM runs the same harness as
# the host check, then runs it again against a gateway that lies, which has to fail. This is not a
# complete Awai Node. The order has no value, and nothing here uses keys beyond the run.
{ pkgs ? import (import ../../ci/nixpkgs.nix) { system = "x86_64-linux"; }
, gatewaySource ? builtins.fetchGit {
    url = "https://github.com/network-awai/cloud-kotoba-desktop";
    rev = "1f8fe2ba606b6087be2e8845788026acc93df4de";
  }
}:
let
  model = pkgs.fetchurl {
    url = "https://huggingface.co/ggml-org/models-moved/resolve/499bc8821c6b12b4e53c5bffcb21ec206f212d81/tinyllamas/stories15M-q4_0.gguf";
    sha256 = "66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739";
  };
  basilisp = pkgs.callPackage ../../dapps/saifu/nix/basilisp.nix { };
  # The gateway pins Hy 1.3.1. The pinned nixpkgs has 1.2.0.
  python = pkgs.python3.withPackages (ps: [
    basilisp
    ps.cryptography
    ps.funcparserlib
    (ps.hy.overridePythonAttrs (old: {
      version = "1.3.1";
      src = pkgs.fetchurl {
        url = "https://files.pythonhosted.org/packages/91/1e/de3ff93dcb16de04b12b570742e03e4d741106e9721c1a5a0bb53d450e08/hy-1.3.1.tar.gz";
        sha256 = "cf7b85fc59079b5da794c7ecaafc6a6e9140f73305af03836c3d52cf978b6645";
      };
      env = (old.env or { }) // { HY_VERSION = "1.3.1"; };
      doCheck = false;
      doInstallCheck = false;
      pythonImportsCheck = [ "hy" ];
    }))
  ]);
  dapp = ../../dapps/sanka;
  run = { gateway, evidence, work, environment }: pkgs.lib.concatStringsSep " " [
    "${python}/bin/python3 -I /tmp/dapp/test/live_v1.py"
    "--gateway ${gateway}"
    "--python ${python}/bin/python3"
    "--basilisp ${python}/bin/basilisp"
    "--llama-server ${pkgs.llama-cpp}/bin/llama-server"
    "--model ${model}"
    "--revision 499bc8821c6b12b4e53c5bffcb21ec206f212d81"
    "--model-sha256 66967fbece6dbe97886593fdbb73589584927e29119ec31f08090732d1861739"
    "--source huggingface.co/ggml-org/models-moved/tinyllamas/stories15M-q4_0.gguf"
    "--environment '${environment}'"
    "--work ${work}"
    "--evidence ${evidence}"
  ];
in
pkgs.testers.runNixOSTest {
  name = "sanka-v1";
  nodes.machine = {
    virtualisation.memorySize = 3072;
    virtualisation.cores = 2;
    virtualisation.diskSize = 2048;
    environment.systemPackages = [ pkgs.curl ];
  };
  testScript = ''
    import json

    start_all()
    machine.wait_for_unit("multi-user.target")

    def load(path):
        return json.loads(machine.succeed(f"cat {path}"))

    # Everything is copied out of the read-only store, because both tools write caches beside
    # their sources.
    machine.succeed(
        "cp -r ${dapp} /tmp/dapp && chmod -R u+w /tmp/dapp",
        "cp -r ${gatewaySource}/gateway-hy /tmp/gateway && chmod -R u+w /tmp/gateway",
        "cp -r /tmp/gateway /tmp/gateway-lying",
    )
    # No route leaves this VM, so nothing can reach another service by accident.
    machine.fail("curl --silent --max-time 5 https://huggingface.co")

    machine.succeed("${run {
      gateway = "/tmp/gateway";
      evidence = "/tmp/evidence.json";
      work = "/tmp/live";
      environment = "NixOS VM (nixos/tests/sanka-v1.nix), no network, on a GitHub Actions runner";
    }}", timeout=1500)
    evidence = load("/tmp/evidence.json")
    assert evidence["failed"] == [], evidence["failed"]
    assert len(evidence["checks"]) == 29, len(evidence["checks"])
    assert evidence["measured"]["completion-tokens"] > 0
    machine.copy_from_vm("/tmp/evidence.json", "")

    # The same checks have to catch a gateway that lies about the output and keeps the prompt.
    machine.succeed(
        "sed -i 's|output-cid (cid-of (canonical message))|output-cid (cid-of (canonical {\"content\" \"a different answer\"}))|' /tmp/gateway-lying/kotoba_gateway/orders.hy",
        "sed -i 's|{\"order\" cid \"input\" input-hash$|{\"order\" cid \"input\" input-hash \"leak\" (.decode raw-body \"utf-8\")|' /tmp/gateway-lying/kotoba_gateway/orders.hy",
        "! cmp /tmp/gateway/kotoba_gateway/orders.hy /tmp/gateway-lying/kotoba_gateway/orders.hy",
    )
    machine.fail("${run {
      gateway = "/tmp/gateway-lying";
      evidence = "/tmp/lying.json";
      work = "/tmp/live-lying";
      environment = "negative control";
    }}", timeout=1500)
    lying = load("/tmp/lying.json")
    for check in [
        "the independent verifier accepts it",
        "the provider kept no prompt, output or key",
        "the ledger block has only hashes",
    ]:
        assert check in lying["failed"], lying["failed"]
    machine.copy_from_vm("/tmp/lying.json", "")
  '';
}
