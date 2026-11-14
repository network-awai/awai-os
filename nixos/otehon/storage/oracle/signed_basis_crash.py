"""Local hosted process-kill oracle. No OS-cache or power-loss claim."""
import os
import pathlib
import select
import shutil
import subprocess
import sys

if len(sys.argv) != 3:
    raise SystemExit('usage: signed_basis_crash.py INITIAL_OLD_OUTPUT NEW_OUTPUT')
old, out = map(pathlib.Path, sys.argv[1:])
out.mkdir()  # never overwrite preserved evidence
paths = '{:paths ["nixos/otehon/storage/src" "nixos/otehon/storage/vendor/apex/src" "nixos/otehon/storage/vendor/apex-car/src" ".agent-output/policy-forest/classpath"]}'
classpath = subprocess.check_output(['clojure', '-Sdeps', paths, '-Spath'], text=True).strip()
java = ['java', '-cp', classpath, 'clojure.main']
script = 'nixos/otehon/storage/oracle/signed_basis_multipack.clj'
child = 'nixos/otehon/storage/oracle/signed_basis_kill_child.clj'
cases = [('half-written', 'forest', 2, 'unverified-fixture-tx'),
         ('half-written', 'root', 1, 'unverified-fixture-tx'),
         ('renamed', 'root', 1, 'unverified-fixture-tx-next')]
for index, (event, role, occurrence, expected) in enumerate(cases):
    case = out / str(index)
    shutil.copytree(old, case)
    env = dict(os.environ, SIGNED_BASIS_OUTPUT=str(case),
               SIGNED_BASIS_STAGE=str(out / f'{index}-child-stage'),
               SIGNED_BASIS_FIXTURE_TX='unverified-fixture-tx-next',
               SIGNED_BASIS_FIXTURE_SEED='532175')
    with subprocess.Popen(java + [child, event, role, str(occurrence)], env=env,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, bufsize=1) as proc:
        ready, _, _ = select.select([proc.stdout], [], [], 180)
        line = proc.stdout.readline() if ready else ''
        if line.strip() != 'BOUNDARY':
            proc.kill()
            raise RuntimeError(f'boundary missing: {event} {role}: {line!r}')
        proc.kill()
        proc.wait(timeout=10)
        if proc.returncode == 0:
            raise RuntimeError('child was not killed')
    read_env = dict(env, SIGNED_BASIS_EXPECT_TX=expected)
    read_env.pop('GROUP_FOREST_STORE', None)
    read_env.pop('FOREST_TOOL', None)
    read = subprocess.run(java + [script, 'read'], env=read_env, text=True,
                          capture_output=True, timeout=180, check=True)
    env['SIGNED_BASIS_STAGE'] = str(out / f'{index}-retry-stage')
    subprocess.run(java + [script, 'publish'], env=env, capture_output=True,
                   text=True, timeout=180, check=True)
    read_env['SIGNED_BASIS_EXPECT_TX'] = 'unverified-fixture-tx-next'
    retry = subprocess.run(java + [script, 'read'], env=read_env, text=True,
                           capture_output=True, timeout=180, check=True)
    print(f'{event}/{role}: recovered={expected} retry=new', flush=True)
    (out / f'{index}-read.txt').write_text(read.stdout)
    (out / f'{index}-retry.txt').write_text(retry.stdout)
print('PASS signed multi-Pack process-kill recovery: 3 cases')
