{ lib, pkgs, ... }:
let
  port = 8770;
  modelsDir = "/var/lib/otehon-models";
  voicesRev = "e7229f7d33a10e145e109b886d661984201ac3c4";
  voiceFile = path: sha256: pkgs.fetchurl {
    url = "https://huggingface.co/rhasspy/piper-voices/resolve/${voicesRev}/${path}";
    inherit sha256;
  };
  # Piper 1.4.2 ignores -c and reads the config from the model path plus ".json", so each voice
  # is a directory holding both files under those names.
  voice = name: path: modelHash: configHash:
    let
      dir = pkgs.linkFarm "otehon-voice-${name}" [
        { name = "${name}.onnx"; path = voiceFile "${path}/${name}.onnx" modelHash; }
        { name = "${name}.onnx.json"; path = voiceFile "${path}/${name}.onnx.json" configHash; }
      ];
    in
    "${dir}/${name}.onnx";
  voices = builtins.toJSON {
    en = voice "en_US-lessac-medium" "en/en_US/lessac/medium"
      "5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f"
      "efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0";
  };
in
{
  # Japanese is absent: Piper 1.4.2 refuses the hi_fi_captain voice with "'japanese' is not a
  # valid PhonemeType" (docs/otehon/media-0.1.0.md).
  # Local speech (Piper) and images (Qwen-Image through stable-diffusion.cpp on Vulkan). The Qwen
  # weights are not in the image: they arrive on a virtiofs share tagged otehon-models, and
  # without it the service reports that images are unavailable. With no GPU, Vulkan falls back
  # to llvmpipe, which is far slower.
  fileSystems.${modelsDir} = {
    device = "otehon-models";
    fsType = "virtiofs";
    # Automount: weights arrive on demand, and a machine without the share
    # boots with no failed unit (the health gate and update settle count
    # every failed unit, so a boot-time mount failure would roll back every
    # trial update). First access attempts the mount within the device
    # timeout; media-service already reports images unavailable then.
    options = [ "ro" "nofail" "x-systemd.automount" "x-systemd.device-timeout=5s" ];
  };

  systemd.services.otehon-media = {
    description = "Local speech and image generation";
    wantedBy = [ "graphical.target" ];
    after = [ "local-fs.target" ];
    environment = {
      OTEHON_MEDIA_PORT = toString port;
      OTEHON_MEDIA_DIR = "/var/lib/otehon-media";
      OTEHON_MODELS = modelsDir;
      OTEHON_PIPER = lib.getExe' pkgs.piper-tts "piper";
      OTEHON_SD = lib.getExe' (pkgs.stable-diffusion-cpp.override { vulkanSupport = true; }) "sd-cli";
      OTEHON_VOICES = voices;
    };
    serviceConfig = {
      ExecStart = "${lib.getExe pkgs.python3} ${./media-service.py}";
      DynamicUser = true;
      StateDirectory = "otehon-media";
      # Prompts cannot leave this machine, whatever the code above does.
      IPAddressDeny = "any";
      IPAddressAllow = "localhost";
      ProtectSystem = "strict";
      ProtectHome = true;
      PrivateTmp = true;
      # The GPU render node, and nothing else from /dev.
      PrivateDevices = false;
      DevicePolicy = "closed";
      DeviceAllow = [ "char-drm rw" ];
      SupplementaryGroups = [ "render" "video" ];
      NoNewPrivileges = true;
      RestrictAddressFamilies = [ "AF_INET" "AF_UNIX" ];
      Restart = "on-failure";
    };
  };
}
