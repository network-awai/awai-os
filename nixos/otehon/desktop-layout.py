"""Initialize the single-shell desktop on every enabled display.

Only the dedicated kiosk profile opts in. User-disabled heads stay disabled.
A layout failure is reported; it never prevents the browser from starting.
"""
import argparse
import json
import re
import subprocess
import time

ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
HEAD = re.compile(r'^([^\s()]{1,64}) \((enabled|disabled|mirroring ([^()\s]{1,64}))\)$')


def heads(text):
    result = {}
    for line in ANSI.sub('', text).splitlines():
        match = HEAD.fullmatch(line)
        if match:
            if match[1] in result:
                raise ValueError('duplicate-output')
            result[match[1]] = {'enabled': match[2] == 'enabled', 'mirrorOf': match[3]}
    if len(result) > 32:
        raise ValueError('output-count-bound')
    return result


def query(binary):
    done = subprocess.run([binary, 'list'], capture_output=True, text=True, timeout=2)
    if done.returncode or len(done.stdout) > 65536:
        raise ValueError('output-query-failed')
    return heads(done.stdout)


def initialize(binary, wait=5):
    deadline = time.monotonic() + wait
    previous = None
    while time.monotonic() < deadline:
        current = query(binary)
        if current and current == previous:
            break
        previous = current
        time.sleep(.1)
    else:
        raise ValueError('outputs-not-ready')
    enabled = sorted(name for name, value in current.items() if value['enabled'])
    if not enabled:
        raise ValueError('no-enabled-output')
    source = enabled[0]
    targets = enabled[1:]
    for target in targets:
        done = subprocess.run([binary, 'mirror', target, source], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, timeout=3)
        if done.returncode:
            raise ValueError('mirror-rejected')
    verified = query(binary)
    if any(verified.get(name, {}).get('mirrorOf') != source for name in targets):
        raise ValueError('mirror-not-observed')
    return {'source': source, 'mirrored': targets, 'disabledPreserved': True,
            'result': 'mirrored' if targets else 'single-logical-output'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--randr', required=True)
    args = parser.parse_args()
    result = {'schema': 'awai.otehon.desktop-layout.v1'}
    try:
        result.update(initialize(args.randr))
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        result.update(result='unavailable', reason=str(error) if isinstance(error, ValueError) else type(error).__name__)
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__': main()
