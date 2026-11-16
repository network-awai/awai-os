"""Which local user opened a loopback TCP connection.

A loopback port is open to every process on the machine. The Settei helper and the web launcher
answer only the desktop user (the one Chromium runs as), so they look up the client's socket in
/proc/net/tcp: the row whose local address is the client's end and whose remote address is the
server's end carries the client's uid. Anything unclear is a refusal.
"""
import socket
import struct

ESTABLISHED = "01"


def _ipv4(address):
    # /proc/net/tcp prints the address as a 32-bit number in host byte order, in hex.
    return "%08X" % struct.unpack("=I", socket.inet_aton(address))[0]


def _endpoint(address, port):
    return f"{_ipv4(address)}:{port:04X}"


def peer_uid(client, server, table="/proc/net/tcp"):
    """client and server are (address, port) of one IPv4 connection. Returns a uid, or None."""
    want_local = _endpoint(*client)
    want_remote = _endpoint(*server)
    uids = set()
    try:
        with open(table, encoding="ascii") as rows:
            next(rows, None)
            for row in rows:
                fields = row.split()
                if len(fields) < 8:
                    continue
                if fields[1] == want_local and fields[2] == want_remote and fields[3] == ESTABLISHED:
                    uids.add(int(fields[7]))
    except (OSError, ValueError):
        return None
    return uids.pop() if len(uids) == 1 else None
