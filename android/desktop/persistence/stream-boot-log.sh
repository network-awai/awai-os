#!/awai/busybox sh
# Operator recovery only. Existing fixed-MAC target, direct cable, bounded stream.
B=/awai/busybox
target_found=false
for candidate in /sys/class/net/*; do
 if [ "$("$B" cat "$candidate/address")" = 0c:47:a9:60:9d:34 ]; then target_found=true; break; fi
done
[ "$target_found" = true ] || exit 1
"$B" timeout 600 "$B" sh -c '/awai/busybox cat /dev/kmsg | /awai/busybox nc -w 120 10.77.0.1 18095' &
