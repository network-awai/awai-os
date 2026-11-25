"""AWAI-4088 (G1): complete Desktop manifest checks, fully offline.

Every project in pinned-manifest.xml must carry an explicit 40-hex revision;
nothing may be inherited from <default revision> (branch) or <remote
revision> (tag). Source attributes and <linkfile>/<copyfile> children come
from the committed base files under base/ and must match exactly (only
`revision` is replaced). Coverage is checked against base + overlay + the
recursively-traversed lineage.dependencies closure (base/deps/). The network
resolution lives in resolve.log / deps.log, not here. Negative controls
construct mutated copies in memory: a deleted revision (inherited branch),
a branch-name revision, a dropped kernel dependency, a dropped linkfile, a
dropped second-level dependency, and an injected <remote revision> must each
fail. Mirrors the repo's offline unittest style.
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
SOURCE_FILES = ("default.xml", "snippets/lineage.xml", "overlay.xml")


def _load(path):
    return ET.parse(path).getroot()


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


def _source_projects():
    """{path: (source element, default-remote)} from the three sources."""
    out = {}
    for rel in SOURCE_FILES:
        root = _load(BASE / rel)
        default_el = root.find("default")
        default_remote = (default_el.get("remote")
                          if default_el is not None else "github")
        for p in root.findall("project"):
            out[p.get("path")] = (p, default_remote)
    return out


def attribute_problems(complete_root):
    """Every source attribute (except revision) must match the pinned element.

    Compared per project: name, path, remote (after applying the source
    <default remote>), groups, sync-c, clone-depth, upstream, dest-branch —
    i.e. every attribute present in the source element besides revision.
    """
    problems = []
    pinned = {p.get("path"): p for p in complete_root.findall("project")}
    pinned_default_el = complete_root.find("default")
    pinned_default_remote = (pinned_default_el.get("remote")
                             if pinned_default_el is not None else "github")
    for path, (src, default_remote) in _source_projects().items():
        dst = pinned.get(path)
        if dst is None:
            continue  # coverage reported separately
        for key, value in src.attrib.items():
            if key == "revision":
                continue
            if key == "remote":
                effective_src = value or default_remote
                effective_dst = dst.attrib.get("remote") or pinned_default_remote
                if effective_dst != effective_src:
                    problems.append(f"project {path!r} remote {effective_dst!r} "
                                    f"!= {effective_src!r}")
            elif dst.attrib.get(key) != value:
                problems.append(f"project {path!r} attr {key} {dst.attrib.get(key)!r} "
                                f"!= {value!r}")
    return problems


def child_pairs(element):
    """Sorted [(tag, src, dest)] for linkfile/copyfile children."""
    return sorted((c.tag, c.get("src"), c.get("dest")) for c in element
                  if c.tag in ("linkfile", "copyfile"))


def children_problems(complete_root):
    """Pinned linkfile/copyfile set must equal the source's, per project."""
    problems = []
    total = 0
    pinned = {p.get("path"): p for p in complete_root.findall("project")}
    for path, (src, _dr) in _source_projects().items():
        want = child_pairs(src)
        total += len(want)
        dst = pinned.get(path)
        if dst is None:
            continue
        have = child_pairs(dst)
        if have != want:
            problems.append(f"project {path!r} linkfile/copyfile differ: "
                            f"pinned={have!r} source={want!r}")
    if total != 24:
        problems.append(f"source linkfile/copyfile total is {total}, expected 24")
    return problems


def expected_paths():
    """Paths the complete manifest must cover: base, overlay, deps closure."""
    paths = set()
    for rel in SOURCE_FILES:
        for path, _n, _r, _v in _projects(_load(BASE / rel)):
            paths.add(path)
    for f in sorted((BASE / "deps").glob("*.json")):
        for entry in json.loads(f.read_text(encoding="utf-8")):
            paths.add(entry["target_path"])
    # kernel/virt/virtio has a 404 lineage.dependencies (no committed file);
    # its presence is covered by the virt-common entry above.
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


def deps_problems(complete_root):
    """Every entry in every visited lineage.dependencies must be present
    with a matching name and path (transitive, incl. overlay projects)."""
    problems = []
    by_path = {path: name for path, name, _r, _v in _projects(complete_root)}
    for f in sorted((BASE / "deps").glob("*.json")):
        for entry in json.loads(f.read_text(encoding="utf-8")):
            target, repo = entry["target_path"], entry["repository"]
            if target not in by_path:
                problems.append(f"deps entry {target!r} from {f.name} is absent")
            else:
                member = by_path[target] or ""
                if not (member.endswith("/" + repo) or member == repo):
                    problems.append(f"deps entry {target!r} should be {repo!r}, "
                                    f"got {member!r}")
    return problems


class CompleteManifest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = ET.parse(MANIFEST).getroot()

    def test_every_revision_is_40_hex_and_nothing_is_inherited(self):
        self.assertEqual(validate_manifest(self.root), [])

    def test_project_count_is_sources_plus_closure(self):
        self.assertEqual(len(self.root.findall("project")), len(expected_paths()))
        self.assertEqual(len(self.root.findall("project")), 1264)

    def test_coverage_matches_base_overlay_and_closure(self):
        self.assertEqual(coverage_problems(self.root), [])

    def test_source_attributes_carried_through(self):
        self.assertEqual(attribute_problems(self.root), [])

    def test_linkfile_copyfile_children_carried_through(self):
        self.assertEqual(children_problems(self.root), [])
        total = sum(len(child_pairs(p)) for p in self.root.findall("project"))
        self.assertEqual(total, 24)

    def test_every_deps_entry_present_transitively(self):
        self.assertEqual(deps_problems(self.root), [])

    def test_closure_additions_present(self):
        paths = {p for p, _n, _r, _v in _projects(self.root)}
        for path in ("kernel/virt/virtio", "prebuilts/mesa-build-dep",
                     "external/alsa-lib", "external/alsa-ucm-conf",
                     "external/libdisplay-info-upstream"):
            self.assertIn(path, paths)

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

    def test_control_e_deleted_linkfile_fails_children(self):
        root = copy.deepcopy(self.root)
        target = next(p for p in root.findall("project") if child_pairs(p))
        target.remove(next(iter(target)))
        problems = children_problems(root)
        self.assertTrue(any((target.get("path") or "") in p for p in problems),
                        f"expected a linkfile problem, got {problems!r}")

    def test_control_f_dropped_second_level_dep_fails_deps(self):
        root = copy.deepcopy(self.root)
        for project in root.findall("project"):
            if project.get("path") == "external/alsa-lib":
                root.remove(project)
        problems = deps_problems(root)
        self.assertTrue(any("external/alsa-lib" in p for p in problems),
                        f"expected a missing-alsa-lib problem, got {problems!r}")


if __name__ == "__main__":
    unittest.main()
