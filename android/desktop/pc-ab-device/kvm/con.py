#!/usr/bin/env python3
# AWAI-3586: run one command on the guest's serial console shell (unix socket) and print its output.
import socket, sys, time, re
s = socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); s.settimeout(1); cmd = sys.argv[2]; to = float(sys.argv[3]) if len(sys.argv) > 3 else 30
def rd(t):
    o = b''; e = time.time() + t
    while time.time() < e:
        try:
            d = s.recv(65536)
            if not d: break
            o += d
        except socket.timeout:
            pass
    return o
rd(1); m = '__AWAI_%d__' % int(time.time() * 1000)
s.sendall(('\nstty -echo 2>/dev/null; ' + cmd + '; echo ' + m + '\n').encode())
o = b''; e = time.time() + to
while time.time() < e and not re.search((m + r'\r?\n').encode(), o.split(b'echo ' + m.encode())[-1]):
    o += rd(1)
t = re.sub(r'\x1b\[[0-9;=?]*[A-Za-z]', '', o.decode('utf8', 'replace')).replace('\r', '')
print(t.split('echo ' + m)[-1].split(m)[0].strip())
