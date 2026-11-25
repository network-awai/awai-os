"""AWAI-4088 (G1): every revision in pinned-manifest.xml must be a 40-hex SHA.

Offline: stdlib only, no network. The network resolution that produced the
SHAs lives in resolve.log, not here. Mirrors the repo's other offline
unittest checks (e.g. android/desktop/test_verify_vm.py).
"""
import pathlib
import re
import unittest
import xml.etree.ElementTree as ET

MANIFEST = pathlib.Path(__file__).with_name('pinned-manifest.xml')
SHA_RE = re.compile(r'^[0-9a-f]{40}$')
# Branch names that must never appear as a revision (checked explicitly so a
# branch-shaped but hex-looking value still reads as a failure, and so the
# failure message names the project).
BRANCH_RE = re.compile(r'^[A-Za-z][A-Za-z0-9._/-]*$')


class PinnedManifestRevisions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = ET.parse(MANIFEST).getroot()

    def test_every_project_revision_is_40_hex(self):
        projects = self.root.findall('project')
        self.assertTrue(projects, 'pinned-manifest.xml has no projects')
        for project in projects:
            revision = project.get('revision') or ''
            with self.subTest(path=project.get('path')):
                self.assertTrue(revision, 'project has no revision')
                self.assertRegex(revision, SHA_RE)
                self.assertFalse(BRANCH_RE.match(revision) and not SHA_RE.match(revision),
                                 f'branch name used as revision: {revision!r}')

    def test_project_count(self):
        # 13 local_manifests (AWAI-3850) + 3 device/virt (lineage_virtio_x86_64).
        self.assertEqual(len(self.root.findall('project')), 16)

    def test_manifest_repo_commit_recorded(self):
        text = MANIFEST.read_text(encoding='utf-8')
        commits = re.findall(r'913c6baa35ffa32be9ae33368cac69dbec6ead4b', text)
        self.assertEqual(len(commits), 1)


if __name__ == '__main__':
    unittest.main()
