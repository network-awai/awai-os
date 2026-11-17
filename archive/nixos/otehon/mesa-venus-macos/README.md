# Mesa patch for Venus on a macOS host

From the `slp/mesa-libkrun-vulkan` Copr project, build 10236391, source package
`mesa-25.3.6-102.fc43.src.rpm`, SHA-256
`5e53f56d57dd71c01650bc9c0cefe4d4a4d38ea16aa4359c0bb475869247180d`. Mesa's license applies.

Hypervisor.framework maps guest memory on 16 KiB boundaries, and a Linux guest uses 4 KiB
pages, so Venus blobs must be aligned to 16 KiB. The Copr file name marks it as a hack.

The project also carries a revert that Mesa 26.1.8 does not need, and a change that only
silences a log message. Neither is used here.
