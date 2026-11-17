{ pkgs }:
pkgs.ipxe.override {
  embedScript = pkgs.writeText "awai-2992-android-live.ipxe" ''
    #!ipxe
    dhcp || goto failed
    kernel http://10.77.0.1:18090/kernel initrd=initrd binder.impl=rust log_buf_len=4M loop.max_part=7 printk.devkmsg=on rw androidboot.addon_fstab_suffix=basic androidboot.console=tty0 androidboot.hardware=generic androidboot.init_fatal_pause=true androidboot.selinux=permissive androidboot.verifiedbootstate=orange audit=0 console=ttyS0 console=tty0 firmware_class.path=/mnt/vendor/firmware/ rdinit=/awai-netboot sysctl.kernel.firmware_config.force_sysfs_fallback=1 sysctl.kernel.modprobe=/vendor/bin/modprobe_kernel androidboot.android_dir=android-Generic_x86_64 androidboot.live=1 androidboot.mount_system=imgs_ram androidboot.mount_userdata=tmpfs androidboot.mount_firmware=img_ram module_blacklist=nvme,nvme_core,ahci,sd_mod,usb_storage,uas || goto failed
    initrd --name initrd http://10.77.0.1:18090/initrd || goto failed
    boot || goto failed
    :failed
    echo Awai Android diagnostic LAN boot failed. Existing Nix disk was not selected.
    shell
  '';
}
