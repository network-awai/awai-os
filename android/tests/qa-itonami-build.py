#!/usr/bin/env python3
"""Exercise the real builder flow with mock SDK and signing commands."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('build', ROOT / 'android/build.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
APK_SHA = 'a' * 64
CATALOG_PUBLIC = b'fixture catalog public key'
CATALOG_SPKI = hashlib.sha256(CATALOG_PUBLIC).hexdigest()
ITONAMI = 'network.itonami.app'


class QaStoreBuild(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / '.agent-output'
        scratch.mkdir(exist_ok=True)
        temp = tempfile.TemporaryDirectory(dir=scratch)
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.out = self.root / 'out'
        self.calls = []
        self.package, self.version, self.abi, self.app_signer = ITONAMI, 1000, 'x86_64', APK_SHA
        self.catalog_spki = CATALOG_SPKI
        self.trust_root = 'd' * 64
        self.input = self.root / 'input.apk'
        for name in ['input.apk', 'apk.keystore', 'catalog.keystore', 'keys/store-root.der', 'keys/keys.txt',
                     'keys/keys.sig', 'sdk/platforms/android-37.0/android.jar', 'jdk/javac',
                     *(f'sdk/build-tools/36.1.0/{name}' for name in ['aapt2', 'apksigner', 'd8', 'zipalign'])]:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('fixture')
        (self.root / 'otehon/shell/node_modules/esbuild').mkdir(parents=True)
        for name in ['android', 'store', 'otehon/branding', 'otehon/shell/vendor', 'packages']:
            (self.root / name).symlink_to(ROOT / name, target_is_directory=True)
        self.common = ['--skip-cljs', '--sdk', str(self.root / 'sdk'), '--java', str(self.root / 'jdk'),
                       '--out', str(self.out), '--key-list', str(self.root / 'keys'),
                       '--keystore', str(self.root / 'apk.keystore'), '--key-alias', 'qa',
                       '--keystore-pass-env', 'MOCK_APK_PASS',
                       '--catalog-keystore', str(self.root / 'catalog.keystore'),
                       '--catalog-key-alias', 'catalog', '--catalog-pass-env', 'MOCK_CATALOG_PASS']

    def mock_run(self, command, **kwargs):
        command = list(map(str, command))
        tool = Path(command[0]).name
        output = ''
        if tool == 'python3' and command[1].endswith('/key-list.py'):
            output = json.dumps({'root': self.trust_root, 'sequence': 1, 'expiresAt': 1,
                                 'catalogKeys': [CATALOG_SPKI], 'pointerKeys': []})
        elif tool == 'node' and command[1].endswith('/build-identity.mjs'):
            for name in ['identity.js', 'handover.js', 'account-broker.js']:
                (Path(command[-1]) / name).touch()
        elif tool == 'bb':
            palette = {'primary': '#102030', 'background': '#ffffff'}
            Path(command[-1]).write_text(json.dumps({'palette': {'light': palette, 'dark': palette}}))
        elif tool == 'java' and command[3] == 'SignCatalog':
            if command[4] == '--inspect':
                output = f'{APK_SHA}\n' + (self.catalog_spki if command[6] == 'catalog' else 'c' * 64) + '\n'
            else:
                data, public_key, signature = map(Path, command[5:8])
                target = ('catalog', [row['id'] for row in json.loads(data.read_text())['apps']]) if data.name == 'catalog.json' else ('probe',)
                self.calls.append(target)
                public_key.write_bytes(CATALOG_PUBLIC)
                signature.write_bytes(b'mock signature')
                output = APK_SHA
        elif tool == 'aapt2' and command[1] == 'dump':
            output = f"package: name='{self.package}' versionCode='{self.version}' versionName='0.1.0'\nnative-code: '{self.abi}'\n"
        elif tool == 'aapt2' and command[1] == 'link':
            manifest = Path(command[command.index('--manifest') + 1])
            assets = Path(command[command.index('-A') + 1])
            with zipfile.ZipFile(command[command.index('-o') + 1], 'w') as apk:
                apk.write(manifest, 'AndroidManifest.xml')
                for path in assets.rglob('*'):
                    if path.is_file():
                        apk.write(path, 'assets/' + path.relative_to(assets).as_posix())
        elif tool == 'zipalign':
            shutil.copyfile(*command[-2:])
        elif tool == 'apksigner' and command[1] == 'sign':
            with zipfile.ZipFile(command[-1]) as apk:
                pkg = ET.fromstring(apk.read('AndroidManifest.xml')).attrib['package']
            self.calls.append(('apk', pkg))
            shutil.copyfile(command[-1], command[command.index('--out') + 1])
        elif tool == 'apksigner' and command[1] == 'verify':
            signer = self.app_signer if Path(command[-1]).name == 'itonami.apk' else APK_SHA
            output = f'Signer #1 certificate SHA-256 digest: {signer}'
        elif tool not in ('aapt2', 'javac', 'd8'):
            self.fail(f'unexpected command: {tool}')
        return subprocess.CompletedProcess(command, 0, stdout=output)

    def invoke(self, *extra, qa=True, input_sha=None):
        argv = ['build.py', *self.common]
        if qa:
            argv.extend(['--store-only', '--qa-itonami-only', '--itonami-apk', str(self.input),
                         '--qa-itonami-sha256', input_sha or build.digest(self.input)])
        with (patch.object(sys, 'argv', [*argv, *extra]), patch.object(build, 'ROOT', self.root),
              patch.object(build, 'run', self.mock_run),
              patch.dict('os.environ', {'MOCK_APK_PASS': 'fixture', 'MOCK_CATALOG_PASS': 'fixture'}),
              contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO())):
            build.main()

    def assert_qa_build(self):
        self.invoke()
        self.assertEqual(self.calls, [('catalog', [ITONAMI]), ('apk', 'network.awai.store')])
        with zipfile.ZipFile(self.out / 'store-v1.apk') as apk:
            self.assertEqual(sorted(p for p in apk.namelist() if p.startswith('assets/packages/')),
                             ['assets/packages/itonami.apk'])
            self.assertEqual(apk.read('assets/packages/itonami.apk'), self.input.read_bytes())
            self.assertEqual(json.loads(apk.read('assets/catalog.json'))['apps'][0]['versionCode'], self.version)
            self.assertEqual(apk.read('assets/online-pins.json'), b'null')

    def test_v1000(self):
        self.assert_qa_build()

    def test_v1002(self):
        self.version = 1002
        self.assert_qa_build()

    def test_full_build_keeps_home_yotei_and_torihiki(self):
        self.invoke(qa=False)
        self.assertEqual(self.calls, [('probe',), ('apk', 'network.itonami.yotei'), ('apk', 'network.itonami.torihiki'),
                                     ('catalog', ['network.itonami.yotei', 'network.itonami.torihiki']),
                                     ('apk', 'network.awai.store'), ('apk', 'network.awai.home')])

    def test_ordinary_store_only_keeps_yotei_and_torihiki(self):
        self.invoke('--store-only', qa=False)
        self.assertEqual(self.calls, [('probe',), ('apk', 'network.itonami.yotei'), ('apk', 'network.itonami.torihiki'),
                                     ('catalog', ['network.itonami.yotei', 'network.itonami.torihiki']),
                                     ('apk', 'network.awai.store')])

    def test_rejects_unapproved_options_before_signing(self):
        for flags in [('--release',), ('--home-only',), ('--unsigned-home',), ('--online-pins', 'pins.json'),
                      ('--torihiki-bot-apk', 'torihiki.apk'), ('--bundle-registry-assoc',),
                      ('--local-apps-dir', 'more'), ('--dapp-distribution', 'preview'),
                      ('--store-package', 'network.awai.store.p2p.preview')]:
            with self.subTest(flags=flags), self.assertRaises(SystemExit):
                self.invoke(*flags)
            self.assertEqual(self.calls, [])
            self.assertFalse(self.out.exists())

    def test_rejects_existing_outputs_before_signing(self):
        self.out.mkdir()
        (self.out / 'yotei-v1.apk').touch()
        with self.assertRaises(SystemExit):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_rejects_wrong_digest_before_signing(self):
        with self.assertRaisesRegex(SystemExit, 'SHA-256 mismatch'):
            self.invoke(input_sha='e' * 64)
        self.assertEqual(self.calls, [])

    def test_rejects_wrong_package_before_signing(self):
        self.package = 'network.itonami.torihiki'
        with self.assertRaisesRegex(SystemExit, 'package/version mismatch'):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_rejects_wrong_version_before_signing(self):
        self.version = 1001
        with self.assertRaisesRegex(SystemExit, 'v1000 or v1002'):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_rejects_missing_x86_64_before_signing(self):
        self.abi = 'arm64-v8a'
        with self.assertRaisesRegex(SystemExit, 'with x86_64'):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_rejects_wrong_apk_signer_before_signing(self):
        self.app_signer = 'e' * 64
        with self.assertRaisesRegex(SystemExit, 'signer does not match'):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_rejects_unlisted_catalog_key_before_signing(self):
        self.catalog_spki = 'e' * 64
        with self.assertRaisesRegex(SystemExit, 'listed for the catalog role'):
            self.invoke()
        self.assertEqual(self.calls, [])

    def test_rejects_published_root_before_signing(self):
        self.trust_root = build.digest(ROOT / 'store/keys/store-root.der')
        with self.assertRaisesRegex(SystemExit, 'dedicated QA trust root'):
            self.invoke()
        self.assertEqual(self.calls, [])


if __name__ == '__main__':
    unittest.main()
