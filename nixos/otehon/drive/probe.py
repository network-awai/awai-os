"""VM/operator readback: local backend acknowledgement, not distributed durability."""
import hashlib
import json
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request


def backend(name):
    credentials = (Path.home() / '.local/state/awai-drive/credentials').read_text().splitlines()
    token = next(line.split('=', 1)[1] for line in credentials if line.startswith('AWAI_VOL_TOKEN='))
    request = urllib.request.Request('http://127.0.0.1:8588/' + urllib.parse.quote(name, safe=''),
                                     headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=5) as response:
        return response.read(8 * 1024 * 1024 + 1)


def main():
    action, path = sys.argv[1:3]
    target = Path(path)
    if action == 'write':
        data = bytes((i * 17 + 3) % 256 for i in range(131109))
        with target.open('xb') as out:
            out.write(data)
            out.flush()
            import os
            os.fsync(out.fileno())
    elif action == 'verify':
        data = target.read_bytes()
    else:
        raise RuntimeError('action')
    for _ in range(90):
        try:
            stored = backend(target.name)
            if data == stored:
                print(json.dumps({'status': 'local-backend-readback-verified', 'bytes': len(data),
                                  'sha256': hashlib.sha256(data).hexdigest()}))
                return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('local backend has not acknowledged the saved bytes; retain dirty cache')


if __name__ == '__main__':
    main()
