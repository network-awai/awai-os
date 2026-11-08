{ config, lib, pkgs, ... }:
let
  cfg = config.otehon.inferenceLane;

  # Prism llama.cpp at the revision the fleet runs in production
  # (kotoba-lang/murakumo infer.edn :k16-production). Its CPU backend carries
  # the PTQ1_0 kernels Mishima needs; this VM has no GPU.
  prismLlama = pkgs.stdenv.mkDerivation {
    pname = "prism-llama-cpp";
    version = "b10725-3ae4f51";
    src = pkgs.fetchFromGitHub {
      owner = "PrismML-Eng";
      repo = "llama.cpp";
      rev = "3ae4f51087d8d9292eda16ee00cec54e798ea576";
      hash = "sha256-oS04cLZ8Zft5HIOyGO9zVCsGs7g67c+i1a2rDVtRfaY=";
    };
    nativeBuildInputs = [ pkgs.cmake pkgs.ninja ];
    cmakeFlags = [
      "-DGGML_NATIVE=OFF"
      # The VM runs with -cpu host on Apple M4, which has dotprod and i8mm.
      "-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16"
      "-DLLAMA_CURL=OFF"
      "-DLLAMA_BUILD_TESTS=OFF"
      "-DLLAMA_BUILD_EXAMPLES=OFF"
      "-DLLAMA_BUILD_SERVER=ON"
      "-DBUILD_SHARED_LIBS=OFF"
    ];
    ninjaFlags = [ "llama-server" ];
    installPhase = ''
      runHook preInstall
      install -Dm755 bin/llama-server $out/bin/llama-server
      runHook postInstall
    '';
  };

  model = "/var/lib/otehon-lane/model/${cfg.gguf}";
in
{
  # Mishima inference lane (JUN-318 / AWAI-218). The host shares one model file
  # read-only over 9p (mount tag "otehon-model"); the lane starts only when that
  # file is present and matches the pinned digest. It listens on port 8094 of
  # the VM's NAT interface, which the host forwards from its loopback only.
  # Joining the fleet or the production chat is not configured here.
  options.otehon.inferenceLane = {
    gguf = lib.mkOption {
      type = lib.types.str;
      default = "Ternary-Bonsai-2-27B-PTQ1_0.gguf";
    };
    sha256 = lib.mkOption {
      type = lib.types.str;
      default = "53107f530aa52eb00912263ab1ee29bd199261c87cd7b4ad4ca1318c1fe33ee3";
      description = "Digest of the model file (kotoba-lang/murakumo infer.edn, mishima).";
    };
    contextSize = lib.mkOption {
      type = lib.types.int;
      default = 8192;
      description = "The 16 GiB M4 fleet heads serve 8192-token slots.";
    };
    package = lib.mkOption {
      type = lib.types.package;
      readOnly = true;
      default = prismLlama;
    };
  };

  config = {
    boot.kernelModules = [ "9p" "9pnet_virtio" ];

    networking.firewall.interfaces.enp0s1.allowedTCPPorts = [ 8094 ];

    # Mounts the share only when the host offers it, so VMs without a model
    # boot without a failed unit.
    systemd.services.otehon-lane-model = {
      description = "Mount the host's read-only model share, if offered";
      wantedBy = [ "multi-user.target" ];
      path = [ pkgs.util-linux pkgs.coreutils ];
      serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
      script = ''
        for tag in /sys/bus/virtio/drivers/9pnet_virtio/*/mount_tag; do
          [ -e "$tag" ] || continue
          if [ "$(tr -d '\0' < "$tag")" = otehon-model ]; then
            mkdir -p /var/lib/otehon-lane/model
            mountpoint -q /var/lib/otehon-lane/model ||
              mount -t 9p -o trans=virtio,version=9p2000.L,ro,msize=1048576 otehon-model /var/lib/otehon-lane/model
          fi
        done
      '';
    };

    systemd.services.otehon-lane = {
      description = "Mishima inference lane (Prism llama.cpp, CPU)";
      wantedBy = [ "multi-user.target" ];
      requires = [ "otehon-lane-model.service" ];
      after = [ "network.target" "otehon-lane-model.service" ];
      unitConfig.ConditionPathExists = model;
      path = [ pkgs.coreutils ];
      serviceConfig = {
        DynamicUser = true;
        ExecStartPre = pkgs.writeShellScript "otehon-lane-verify" ''
          set -eu
          actual=$(sha256sum ${model} | cut -d' ' -f1)
          if [ "$actual" != "${cfg.sha256}" ]; then
            echo "model digest $actual does not match ${cfg.sha256}" >&2
            exit 1
          fi
        '';
        # --no-mmap reads the weights into RAM once instead of paging over 9p.
        ExecStart = lib.escapeShellArgs [
          "${prismLlama}/bin/llama-server"
          "-m" model
          "--alias" "mishima"
          "--host" "0.0.0.0"
          "--port" "8094"
          "--ctx-size" (toString cfg.contextSize)
          "--parallel" "1"
          "-fa" "on"
          "-ctk" "q8_0"
          "-ctv" "q8_0"
          "--no-mmap"
          "--no-webui"
        ];
        TimeoutStartSec = "15min";
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        Restart = "on-failure";
        RestartSec = 10;
      };
    };
  };
}
