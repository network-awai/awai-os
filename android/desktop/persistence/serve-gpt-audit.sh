#!/awai/busybox sh
set -eu
B=/awai/busybox
cd /tmp
"$B" mkdir -m 700 report
"$B" cp after.head after.tail sectors report/
"$B" sha256sum before.head before.tail after.head after.tail sectors > report/witness.sha256
echo /awai/firmware > /sys/module/firmware_class/parameters/path
for module in mii phy_package realtek e1000 r8169; do
    "$B" insmod "/awai/$module.ko"
done
test "$("$B" cat /sys/class/net/eth0/address)" = 0c:47:a9:60:9d:34
"$B" ip link set lo up
"$B" ip link set eth0 up
"$B" ip addr add 10.77.0.2/24 dev eth0
"$B" httpd -p 10.77.0.2:18092 -h /tmp/report
for attempt in $("$B" seq 1 10); do
    if [ "$("$B" cat /sys/class/net/eth0/carrier 2>/dev/null || true)" = 1 ] &&
       "$B" timeout 2 "$B" wget -q -O /tmp/probe.sha256 http://10.77.0.2:18092/witness.sha256 &&
       "$B" cmp -s /tmp/probe.sha256 /tmp/report/witness.sha256; then
        echo AWAI_AUDIT_REPORT_READY
        while :; do "$B" sleep 3600; done
    fi
    "$B" sleep 1
done
exit 1
