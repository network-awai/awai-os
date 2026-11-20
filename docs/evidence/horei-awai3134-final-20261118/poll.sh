i=0; while [ $i -lt 75 ]; do t=$(date +%s); for f in tcp tcp6 udp udp6; do awk -v t=$t -v f=$f 'NR>1 && ($8==10148 || $8>=90000) {print t, f, $0}' /proc/net/$f; done; i=$((i+1)); sleep 1; done
