#!/bin/sh
set -eu
# Run on the Ubuntu host after unpacking only the BLE adapter files here.
install -d -m 0755 /usr/local/lib/murakumo-ble
install -m 0644 archive/nixos/ble-protocol.mjs archive/nixos/ble-controller.mjs archive/nixos/ble-gatt.js /usr/local/lib/murakumo-ble/
cat > /etc/systemd/system/murakumo-ble-controller.service <<'UNIT'
[Unit]
Description=Murakumo authenticated Bluetooth Wi-Fi setup controller
After=systemd-networkd.service
[Service]
ExecStart=/usr/bin/node /usr/local/lib/murakumo-ble/ble-controller.mjs serve
Environment=MURAKUMO_BLE_WIFI=wlp2s0
RuntimeDirectory=murakumo-ble
RuntimeDirectoryMode=0700
UMask=0077
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/etc/netplan /run
[Install]
WantedBy=multi-user.target
UNIT
cat > /etc/systemd/system/murakumo-ble-gatt.service <<'UNIT'
[Unit]
Description=Murakumo Bluetooth setup GATT peripheral
Requires=murakumo-ble-controller.service bluetooth.service
After=murakumo-ble-controller.service bluetooth.service
[Service]
ExecStart=/usr/bin/gjs /usr/local/lib/murakumo-ble/ble-gatt.js
Environment=MURAKUMO_BLE_LEGACY_ADV=1
ExecStopPost=-/bin/sh -c 'printf "" | /usr/bin/timeout 5 /usr/bin/btmgmt -i 0 rm-adv 10'
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
UMask=0077
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now murakumo-ble-controller murakumo-ble-gatt
