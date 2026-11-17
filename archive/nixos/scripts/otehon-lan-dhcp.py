#!/usr/bin/env python3
"""Prepare a direct-link-only dnsmasq configuration for a known PC."""
import argparse
from pathlib import Path
import re


def config(interface, mac, boot_dir, lease_file):
    if not re.fullmatch(r'en[0-9]+', interface):
        raise ValueError('invalid macOS Ethernet interface')
    if not re.fullmatch(r'(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}', mac):
        raise ValueError('one exact Ethernet address is required')
    # dnsmasq config has its own syntax; refuse paths that could inject lines
    # or arguments rather than attempting to quote arbitrary filenames.
    for path in (boot_dir, lease_file):
        if not path.is_absolute() or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(path)):
            raise ValueError('unsafe path')
    return f'''# Direct, operator-selected cable and one client only. No DNS service.
port=0
interface={interface}
bind-interfaces
listen-address=10.77.0.1
dhcp-range=10.77.0.2,10.77.0.2,255.255.255.0,15m
dhcp-host={mac.lower()},10.77.0.2
dhcp-ignore=tag:!known
dhcp-option=3
dhcp-option=6
dhcp-leasefile={lease_file}
dhcp-vendorclass=set:httpclient,HTTPClient
dhcp-option-force=tag:httpclient,60,HTTPClient
dhcp-boot=tag:httpclient,http://10.77.0.1:8080/ipxe.efi
dhcp-boot=tag:!httpclient,ipxe.efi
enable-tftp
tftp-root={boot_dir}
log-dhcp
log-facility=-
'''


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--interface', required=True)
    p.add_argument('--mac', required=True, help='exact Ethernet MAC of the 6600H')
    p.add_argument('--boot-dir', type=Path, required=True)
    p.add_argument('--lease-file', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    text = config(a.interface, a.mac, a.boot_dir.resolve(), a.lease_file.resolve())
    # Do not overwrite existing configurations or evidence.
    with a.output.open('x', encoding='utf-8') as output:
        output.write(text)


if __name__ == '__main__':
    main()
