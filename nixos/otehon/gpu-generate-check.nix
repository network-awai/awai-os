{ config, lib, pkgs, ... }:
let
  sdVulkan = pkgs.stable-diffusion-cpp.override { vulkanSupport = true; };
  sdCpu = pkgs.stable-diffusion-cpp;
  models = "/var/lib/otehon-models";
  results = "/var/lib/otehon-results";
  # usage: run <name> <sd-cli> <extra flags...>. Same prompt, seed, size and steps each time.
  generate = pkgs.writeShellApplication {
    name = "otehon-generate";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      name=$1; sd=$2; shift 2
      start=$(date +%s)
      rc=0
      "$sd/bin/sd-cli" --diffusion-model ${models}/qwen-image-Q2_K.gguf --vae ${models}/qwen-vae.safetensors \
        --llm ${models}/qwen25-vl-Q2_K.gguf \
        -p "A red torii gate on a green hill, simple illustration" \
        --cfg-scale 2.5 --sampling-method euler --flow-shift 3 --seed 42 \
        -W 256 -H 256 --steps 8 "$@" -o "${results}/$name.png" || rc=$?
      echo "OTEHON_VARIANT name=$name rc=$rc seconds=$(( $(date +%s) - start ))"
    '';
  };
in
{
  # Check image: Qwen-Image on the GPU through Venus, without a desktop. The models and results
  # are on a virtiofs share. gpu-generate-krunkit.sh reads the report.
  imports = [ ./gpu-check.nix ];

  system.image.id = lib.mkForce "awai-otehon-gpu-generate";
  environment.systemPackages = [ generate ];

  fileSystems.${models} = {
    device = "otehon-models";
    fsType = "virtiofs";
    options = [ "nofail" "x-systemd.device-timeout=5s" ];
  };
  fileSystems."/var/lib/otehon-results" = {
    device = "otehon-results";
    fsType = "virtiofs";
    options = [ "nofail" "x-systemd.device-timeout=5s" ];
  };

  systemd.services.otehon-boot-report.path = [ generate ];
  systemd.services.otehon-boot-report.serviceConfig.TimeoutStartSec = "infinity";
  systemd.services.otehon-boot-report.script = lib.mkForce ''
    ls -la ${models} | head -6
    otehon-generate gpu-all ${sdVulkan}
    otehon-generate gpu-clip-cpu ${sdVulkan} --clip-on-cpu
    otehon-generate gpu-clip-vae-cpu ${sdVulkan} --clip-on-cpu --vae-on-cpu
    otehon-generate cpu ${sdCpu}
    echo "OTEHON_GENERATE_DONE rc=0"
    sync
    sleep 3
    systemctl poweroff --no-block
  '';
}
