"""Tests for the Settei helper and the web launcher, with a stand-in timedatectl and a written
/proc/net/tcp table. They prove the request rules and the refusals. They do not prove that polkit,
timedated or the session behave in the OS image: that is the VM check (docs/otehon/daily-0.1.0.md).

usage: python3 test_settei.py   (from this directory, or with it on sys.path)
"""
import http.client
import io
import json
import os
import socket
import stat
import struct
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import loopback_peer  # noqa: E402
import settei_helper  # noqa: E402
import web_launcher  # noqa: E402

DESKTOP = 1000
OTHER = 1001
HEADER = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"

FAKE_TIMEDATECTL = """#!/bin/sh
state="$FAKE_TZ_STATE"
case "$1" in
  list-timezones) printf 'Africa/Abidjan\\nAmerica/New_York\\nAsia/Tokyo\\nEurope/Berlin\\nUTC\\n' ;;
  show) cat "$state" ;;
  set-timezone)
    [ "$#" = 2 ] || { echo "bad arguments" >&2; exit 2; }
    echo "$2" >> "$state.calls"
    [ -n "$FAKE_TZ_IGNORE" ] || echo "$2" > "$state" ;;
  *) exit 2 ;;
esac
"""


def hexaddr(port):
    return "%08X:%04X" % (struct.unpack("=I", socket.inet_aton("127.0.0.1"))[0], port)


def row(local_port, remote_port, uid, state="01"):
    return (
        f"   0: {hexaddr(local_port)} {hexaddr(remote_port)} {state} 00000000:00000000 00:00000000 00000000 "
        f" {uid}        0 12345 1 0000000000000000 20 4 30 10 -1\n"
    )


class Server:
    def __init__(self, handler, table):
        handler.peer_table = table
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        handler.port = self.httpd.server_address[1]
        self.port = handler.port
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class Base(unittest.TestCase):
    handler = None

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.table = os.path.join(self.dir, "tcp")
        with open(self.table, "w") as file:
            file.write(HEADER)
        self.handler.allowed_uid = DESKTOP
        self.server = Server(self.handler, self.table)
        self.stdout = sys.stdout
        sys.stdout = self.log = io.StringIO()

    def tearDown(self):
        sys.stdout = self.stdout
        self.server.close()

    def request(self, method, path, body=None, uid=DESKTOP, origin="null", host=None, state="01", raw=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.port, timeout=10)
        connection.connect()
        client_port = connection.sock.getsockname()[1]
        with open(self.table, "w") as file:
            file.write(HEADER)
            if uid is not None:
                file.write(row(client_port, self.server.port, uid, state))
        headers = {"Host": host or f"127.0.0.1:{self.server.port}", "Content-Type": "application/json"}
        if origin is not None:
            headers["Origin"] = origin
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        connection.request(method, path, body=data, headers=headers)
        response = connection.getresponse()
        payload = json.loads(response.read() or b"null")
        connection.close()
        return response.status, payload

    def audits(self):
        return [line for line in self.log.getvalue().splitlines() if line.startswith("OTEHON_SETTEI_AUDIT")]


class PeerTable(unittest.TestCase):
    def test_reads_the_uid_of_the_client_end(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as file:
            file.write(HEADER + row(40000, 8774, 1000) + row(8774, 40000, 0) + row(40001, 8774, 1001))
        self.assertEqual(loopback_peer.peer_uid(("127.0.0.1", 40000), ("127.0.0.1", 8774), file.name), 1000)
        self.assertEqual(loopback_peer.peer_uid(("127.0.0.1", 40001), ("127.0.0.1", 8774), file.name), 1001)
        self.assertIsNone(loopback_peer.peer_uid(("127.0.0.1", 40002), ("127.0.0.1", 8774), file.name))

    def test_a_socket_that_is_not_established_does_not_count(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as file:
            file.write(HEADER + row(40000, 8774, 1000, state="06"))
        self.assertIsNone(loopback_peer.peer_uid(("127.0.0.1", 40000), ("127.0.0.1", 8774), file.name))

    def test_two_owners_for_one_pair_is_a_refusal(self):
        with tempfile.NamedTemporaryFile("w", delete=False) as file:
            file.write(HEADER + row(40000, 8774, 1000) + row(40000, 8774, 1001))
        self.assertIsNone(loopback_peer.peer_uid(("127.0.0.1", 40000), ("127.0.0.1", 8774), file.name))

    def test_no_table_is_a_refusal(self):
        self.assertIsNone(loopback_peer.peer_uid(("127.0.0.1", 1), ("127.0.0.1", 2), "/nonexistent/tcp"))

    def test_matches_the_kernel_format(self):
        # A row as Linux prints it, for 127.0.0.1:52918 -> 127.0.0.1:8774, uid 1000.
        line = "   3: 0100007F:CEB6 0100007F:2246 01 00000000:00000000 00:00000000 00000000  1000        0 61443 1 0000000000000000 20 4 30 10 -1\n"
        with tempfile.NamedTemporaryFile("w", delete=False) as file:
            file.write(HEADER + line)
        self.assertEqual(loopback_peer.peer_uid(("127.0.0.1", 52918), ("127.0.0.1", 8774), file.name), 1000)


@unittest.skipUnless(os.path.exists("/proc/net/tcp"), "needs Linux /proc/net/tcp")
class KernelTable(unittest.TestCase):
    """On Linux, a real loopback connection must be found in the real table, with this process's uid."""

    def test_finds_a_real_connection(self):
        listener = socket.socket()
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        client = socket.create_connection(listener.getsockname())
        server_end, _ = listener.accept()
        try:
            uid = loopback_peer.peer_uid(client.getsockname(), listener.getsockname())
            self.assertEqual(uid, os.getuid())
            # The server's own end is not the client's end.
            self.assertIsNone(loopback_peer.peer_uid(("127.0.0.1", 1), listener.getsockname()))
        finally:
            client.close()
            server_end.close()
            listener.close()


class Settei(Base):
    handler = settei_helper.SetteiHandler

    def setUp(self):
        super().setUp()
        self.state = os.path.join(self.dir, "tz")
        with open(self.state, "w") as file:
            file.write("UTC\n")
        fake = os.path.join(self.dir, "timedatectl")
        with open(fake, "w") as file:
            file.write(FAKE_TIMEDATECTL)
        os.chmod(fake, stat.S_IRWXU)
        settei_helper.TIMEDATECTL = fake
        os.environ["FAKE_TZ_STATE"] = self.state
        os.environ.pop("FAKE_TZ_IGNORE", None)

    def zone(self):
        with open(self.state) as file:
            return file.read().strip()

    def calls(self):
        try:
            with open(self.state + ".calls") as file:
                return file.read().split()
        except FileNotFoundError:
            return []

    def test_reads_the_zone_and_the_list(self):
        status, body = self.request("GET", "/v1/timezone")
        self.assertEqual(status, 200)
        self.assertEqual(body["zone"], "UTC")
        self.assertIn("Asia/Tokyo", body["zones"])

    def test_changes_the_zone_and_audits_it(self):
        status, body = self.request("POST", "/v1/timezone", {"zone": "Asia/Tokyo"})
        self.assertEqual((status, body), (200, {"zone": "Asia/Tokyo"}))
        self.assertEqual(self.zone(), "Asia/Tokyo")
        self.assertEqual(self.calls(), ["Asia/Tokyo"])
        self.assertTrue(any('before="UTC" after="Asia/Tokyo" result="ok"' in line for line in self.audits()), self.audits())

    def test_refuses_a_zone_that_is_not_in_the_list(self):
        for zone in ["Mars/Olympus", "../../etc/passwd", "Asia/Tokyo; rm -rf /", "", "Asia/Tokyo\n", 7, None, "-h"]:
            status, body = self.request("POST", "/v1/timezone", {"zone": zone})
            self.assertEqual((status, body), (400, {"error": "unknown-zone"}), repr(zone))
        self.assertEqual(self.zone(), "UTC")
        self.assertEqual(self.calls(), [])

    def test_refuses_another_user(self):
        status, body = self.request("POST", "/v1/timezone", {"zone": "Asia/Tokyo"}, uid=OTHER)
        self.assertEqual((status, body), (403, {"error": "not-desktop-user"}))
        status, _ = self.request("GET", "/v1/timezone", uid=0)
        self.assertEqual(status, 403)
        self.assertEqual(self.calls(), [])
        self.assertTrue(any("reason=\"not-desktop-user\"" in line for line in self.audits()))

    def test_refuses_an_unknown_connection(self):
        status, body = self.request("POST", "/v1/timezone", {"zone": "Asia/Tokyo"}, uid=None)
        self.assertEqual((status, body), (403, {"error": "not-desktop-user"}))
        self.assertEqual(self.calls(), [])

    def test_refuses_a_web_origin_and_a_rebound_host(self):
        status, body = self.request("POST", "/v1/timezone", {"zone": "Asia/Tokyo"}, origin="https://example.test")
        self.assertEqual((status, body), (403, {"error": "bad-origin"}))
        status, body = self.request("POST", "/v1/timezone", {"zone": "Asia/Tokyo"}, host="attacker.test:8774")
        self.assertEqual((status, body), (403, {"error": "bad-host"}))
        self.assertEqual(self.calls(), [])

    def test_refuses_a_large_or_broken_body(self):
        status, body = self.request("POST", "/v1/timezone", raw=b"{" + b" " * 2000 + b"}")
        self.assertEqual((status, body), (413, {"error": "body-too-large"}))
        status, body = self.request("POST", "/v1/timezone", raw=b"[1]")
        self.assertEqual((status, body), (400, {"error": "bad-json"}))
        self.assertEqual(self.calls(), [])

    def test_reports_a_change_that_did_not_happen(self):
        os.environ["FAKE_TZ_IGNORE"] = "1"
        status, body = self.request("POST", "/v1/timezone", {"zone": "Asia/Tokyo"})
        self.assertEqual((status, body), (500, {"error": "not-applied"}))
        self.assertTrue(any("result=\"not-applied\"" in line for line in self.audits()))

    def test_only_its_own_paths(self):
        status, _ = self.request("POST", "/v1/hostname", {"name": "x"})
        self.assertEqual(status, 404)


class Web(Base):
    handler = web_launcher.WebHandler

    def setUp(self):
        super().setUp()
        self.marker = os.path.join(self.dir, "opened")
        command = os.path.join(self.dir, "browser")
        with open(command, "w") as file:
            file.write(f"#!/bin/sh\necho \"$@\" >> {self.marker}\nsleep 3\n")
        os.chmod(command, stat.S_IRWXU)
        web_launcher.COMMAND = command
        web_launcher.running = None

    def opened(self):
        for _ in range(50):
            if os.path.exists(self.marker):
                with open(self.marker) as file:
                    return len(file.read().splitlines())
            time.sleep(0.05)
        return 0

    def test_opens_once_and_takes_no_address(self):
        status, body = self.request("POST", "/v1/open", {"url": "https://example.test"})
        self.assertEqual((status, body), (200, {"opened": True}))
        status, body = self.request("POST", "/v1/open", {})
        self.assertEqual((status, body), (200, {"opened": "already"}))
        self.assertEqual(self.opened(), 1)
        with open(self.marker) as file:
            self.assertNotIn("example.test", file.read())

    def test_refuses_another_user(self):
        status, body = self.request("POST", "/v1/open", {}, uid=OTHER)
        self.assertEqual((status, body), (403, {"error": "not-desktop-user"}))
        time.sleep(0.3)
        self.assertFalse(os.path.exists(self.marker))


if __name__ == "__main__":
    unittest.main(verbosity=2)
