#!/usr/bin/env python3
"""Talks MCP to the Basilisp server over stdio, as a client would, and checks refusals."""
import json
import subprocess
import sys
import time

start = time.monotonic()
server = subprocess.Popen(["basilisp", "run", "mcp/server.lpy"], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def call(identifier, method, params=None):
    server.stdin.write(json.dumps({"jsonrpc": "2.0", "id": identifier, "method": method, "params": params or {}}) + "\n")
    server.stdin.flush()
    line = server.stdout.readline()
    if not line:
        sys.exit("FAIL server closed: " + server.stderr.read()[-600:])
    return json.loads(line)


def tool(identifier, name, arguments):
    result = call(identifier, "tools/call", {"name": name, "arguments": arguments})["result"]
    return result["isError"], json.loads(result["content"][0]["text"])


assert call(1, "initialize")["result"]["serverInfo"]["name"] == "saifu"
ready = time.monotonic() - start
names = sorted(item["name"] for item in call(2, "tools/list")["result"]["tools"])
assert names == ["saifu_format_wei", "saifu_hex_to_decimal", "saifu_valid_address"], names
assert tool(3, "saifu_format_wei", {"wei": "1500000000000000000"}) == (False, {"eth": "1.5"})
assert tool(4, "saifu_hex_to_decimal", {"hex": "0xff"}) == (False, {"decimal": "255"})
assert tool(5, "saifu_valid_address", {"address": "0x01"}) == (False, {"valid": False})
# Refusals.
assert tool(6, "saifu_format_wei", {"wei": "12.5"}) == (False, {"eth": None})
assert tool(7, "saifu_format_wei", {}) == (True, {"error": "bad-arguments"})
assert tool(8, "nope", {}) == (True, {"error": "unknown-tool"})
assert call(9, "nope")["error"]["code"] == -32601
server.stdin.close()
server.wait(timeout=10)
print(f"mcp ok: {len(names)} tools, ready in {ready:.2f}s")
