"""Bounded, owner-local VFS counters. Never return paths, credentials or receipts."""
import http.client
import json
from pathlib import Path
import socket
import sys


def summarize(stats, mounted):
    result = {'schema': 'awai.otehon.drive-status.v1', 'localState': 'unavailable',
              'uploadsQueued': None, 'uploadsInProgress': None, 'erroredFiles': None,
              'backendReadbackVerified': False, 'distributedPolicyMet': False}
    if not mounted or not isinstance(stats, dict):
        return result
    cache = stats.get('diskCache')
    if not isinstance(cache, dict):
        return result
    for key in ['uploadsQueued', 'uploadsInProgress', 'erroredFiles']:
        if type(cache.get(key)) is not int or cache[key] < 0:
            return result
    if type(cache.get('outOfSpace')) is not bool:
        return result
    result.update({key: cache[key] for key in ['uploadsQueued', 'uploadsInProgress', 'erroredFiles']})
    result['localState'] = ('error' if cache['erroredFiles'] or cache['outOfSpace'] else
                            'pending' if cache['uploadsQueued'] or cache['uploadsInProgress'] else
                            'transfer-idle')
    return result


class LocalConnection(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('localhost', timeout=3)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


def read_status(control, mount):
    stats = None
    mounted = False
    try:
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            fields = line.split()
            if len(fields) > 6 and fields[4] == mount and fields[fields.index('-') + 1].startswith('fuse'):
                mounted = True
        connection = LocalConnection(control)
        try:
            connection.request('POST', '/vfs/stats', body=b'{}', headers={'Content-Type': 'application/json'})
            response = connection.getresponse()
            data = response.read(65537)
            if response.status == 200 and len(data) <= 65536:
                stats = json.loads(data)
        finally:
            connection.close()
    except (OSError, ValueError, http.client.HTTPException):
        pass
    return summarize(stats, mounted)


if __name__ == '__main__':
    print(json.dumps(read_status(*sys.argv[1:3])))
