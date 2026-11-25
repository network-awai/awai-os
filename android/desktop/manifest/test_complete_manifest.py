"""AWAI-4088 (G1): complete Desktop manifest checks, fully offline.

Every project in pinned-manifest.xml must carry an explicit 40-hex revision;
nothing may be inherited from <default revision> (branch) or <remote
revision> (tag). Coverage is checked against the committed base manifests,
the committed overlay, and the committed lineage.dependencies closure files
under base/. The network resolution lives in resolve.log / deps.log, not here.
Negative controls (a)-(c) construct mutated copies in memory: a deleted
revision (inherited branch), a branch-name revision, and a dropped kernel
dependency must each fail. Mirrors the repo's offline unittest style.
"""
import copy
import json
import pathlib
import re
import unittest
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).parent
MANIFEST = HERE / "pinned-manifest.xml"
BASE = HERE / "base"
SHA40 = re.compile(r"^[0-9a-f]{40}$")


def _projects(root):
    return [(p.get("path"), p.get("name"), p.get("remote"), p.get("revision"))
            for p in root.findall("project")]


def validate_manifest(root):
    """Return a list of problems with this manifest tree ([] = OK)."""
    problems = []
    default = root.find("default")
    if default is not None and default.get("revision") is not None \
            and not SHA40.match(default.get("revision")):
        problems.append(
            f"<default revision={default.get('revision')!r}> is not 40-hex: "
            "a project without revision would inherit a branch")
    for remote in root.findall("remote"):
        if remote.get("revision") is not None:
            problems.append(
                f"<remote name={remote.get('name')!r} revision="
                f"{remote.get('revision')!r}> must not be used; resolve "
                "every project per-project")
    paths = _projects(root)
    seen = set()
    for path, _name, _remote, revision in paths:
        if path in seen:
            problems.append(f"duplicate path {path!r}")
        seen.add(path)
        if revision is None:
            problems.append(f"project {path!r} has no revision (would inherit)")
        elif not SHA40.match(revision):
            problems.append(f"project {path!r} revision {revision!r} is not 40-hex")
    return problems


def expected_paths():
    """Paths the complete manifest must cover: base, overlay, deps closure."""
    paths = set()
    for rel in ("default.xml", "snippets/lineage.xml", "overlay.xml"):
        for path, _n, _r, _v in _projects(ET.parse(BASE / rel).getroot()):
            paths.add(path)
    for f in sorted((BASE / "deps").glob("*.json")):
        for entry in json.loads(f.read_text(encoding="utf-8")):
            paths.add(entry["target_path"])
    return paths


def coverage_problems(complete_root):
    """Paths in expected that are missing (or extra/duplicated) in the manifest."""
    actual = [path for path, _n, _r, _v in _projects(complete_root)]
    problems = []
    for path in sorted(expected_paths() - set(actual)):
        problems.append(f"missing project {path!r}")
    for path in sorted(set(actual) - expected_paths()):
        problems.append(f"unexpected project {path!r}")
    return problems


class CompleteManifest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = ET.parse(MANIFEST).getroot()

    def test_every_revision_is_40_hex_and_nothing_is_inherited(self):
        self.assertEqual(validate_manifest(self.root), [])

    def test_coverage_matches_base_overlay_and_closure(self):
        self.assertEqual(coverage_problems(self.root), [])

    def test_project_count(self):
        self.assertEqual(len(self.root.findall("project")), len(expected_paths()))

    def test_every_deps_entry_is_present_with_matching_name(self):
        by_path = {path: name for path, name, _r, _v in _projects(self.root)}
        for f in sorted((BASE / "deps").glob("*.json")):
            for entry in json.loads(f.read_text(encoding="utf-8")):
                with self.subTest(deps=f.name, target=entry["target_path"]):
                    self.assertIn(entry["target_path"], by_path)
                    member = by_path[entry["target_path"]] or ""
                    self.assertTrue(
                        member.endswith("/" + entry["repository"])
                        or member == entry["repository"],
                        f"{entry['target_path']} should be {entry['repository']!r}, "
                        f"got {member!r}")

    # --- negative controls (committed, offline) ---
    def test_control_a_deleted_revision_with_branch_default_fails(self):
        root = copy.deepcopy(self.root)
        first = root.find("project")
        default = root.find("default")
        assert first is not None and default is not None
        first.attrib.pop("revision", None)
        default.set("revision", "refs/heads/lineage-24.0")
        problems = validate_manifest(root)
        self.assertTrue(any("no revision" in p for p in problems),
                        f"expected a missing-revision problem, got {problems!r}")
        self.assertTrue(any("<default revision" in p for p in problems),
                        f"expected a branch-default problem, got {problems!r}")

    def test_control_b_branch_name_revision_fails(self):
        root = copy.deepcopy(self.root)
        first = root.find("project")
        assert first is not None
        first.set("revision", "lineage-24.0")
        problems = validate_manifest(root)
        self.assertTrue(any("not 40-hex" in p for p in problems),
                        f"expected a not-40-hex problem, got {problems!r}")

    def test_control_c_dropped_kernel_dependency_fails_coverage(self):
        root = copy.deepcopy(self.root)
        for project in root.findall("project"):
            if project.get("path") == "kernel/virt/virtio":
                root.remove(project)
        problems = coverage_problems(root)
        self.assertTrue(any("kernel/virt/virtio" in p for p in problems),
                        f"expected a missing-kernel problem, got {problems!r}")

    def test_control_d_remote_revision_fails(self):
        root = copy.deepcopy(self.root)
        remote = root.find("remote")
        assert remote is not None
        remote.set("revision", "refs/heads/lineage-24.0")
        problems = validate_manifest(root)
        self.assertTrue(any("<remote" in p for p in problems),
                        f"expected a remote-revision problem, got {problems!r}")


if __name__ == "__main__":
    unittest.main()
