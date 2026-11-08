{ config, lib, pkgs, ... }:
{
  # Check image: does a GPU reach NixOS under krunkit (Venus over MoltenVK)? It has no
  # network, login or desktop. gpu-check-krunkit.sh reads the report.
  imports = [ ./common.nix ./gpu.nix ];

  system.image.id = "awai-otehon-gpu";
  system.image.version = "0.1.0";

  documentation.nixos.enable = false;

  systemd.services.otehon-boot-report = {
    path = with pkgs; [ gnugrep kmod vulkan-tools ];
    environment.XDG_RUNTIME_DIR = "/run";
    script = ''
      ls -la /dev/dri || true
      lsmod | grep -E "virtio_gpu|drm" || true
      vulkaninfo --summary 2>&1 | grep -E "deviceName|driverName|driverInfo|deviceType|apiVersion|ERROR" || true
      drm=0; [ -e /dev/dri/renderD128 ] && drm=1
      gpu=$(vulkaninfo --summary 2>/dev/null | grep -m1 -E "deviceName" | sed 's/.*= //' || true)
      venus=0; case "$(vulkaninfo --summary 2>/dev/null | grep -m1 driverName)" in *venus*) venus=1 ;; esac
      failed=$(systemctl list-units --state=failed --no-legend | wc -l)
      echo "OTEHON_BOOT_REPORT id=${config.system.image.id} render_node=$drm venus=$venus gpu=[$gpu] failed=$failed"
    '';
  };
}
