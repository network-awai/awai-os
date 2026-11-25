#!/usr/bin/env python3
"""Tests for the measurement rig. Run: python3 docs/research/simulator/test_measure.py"""

from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import measure  # noqa: E402


class CanonicalForm(unittest.TestCase):
    def test_key_order_and_whitespace_do_not_change_the_digest(self):
        a = {"b": 1, "a": [1, {"z": 2, "y": 3}]}
        b = {"a": [1, {"y": 3, "z": 2}], "b": 1}
        self.assertEqual(measure.digest(measure.canonical(a)), measure.digest(measure.canonical(b)))

    def test_nan_is_refused(self):
        with self.assertRaises(ValueError):
            measure.canonical({"x": float("nan")})

    def test_non_ascii_is_not_escaped(self):
        self.assertIn("あ".encode("utf-8"), measure.canonical({"k": "あ"}))


class ContentDefinedChunking(unittest.TestCase):
    def test_insert_at_front_changes_few_blocks(self):
        # Random bytes: with periodic data the rolling hash never hits a
        # boundary and CDC silently degenerates to fixed max-size blocks.
        base = random.Random(7).randbytes(60_000)
        inserted = b"PREFIX-INSERT" + base

        base_cdc = {measure.digest(b) for b in measure.cdc_blocks(base)}
        new_cdc = {measure.digest(b) for b in measure.cdc_blocks(inserted)}
        cdc_kept = len(base_cdc & new_cdc) / len(base_cdc)

        base_fixed = {measure.digest(b) for b in measure.fixed_blocks(base, 4096)}
        new_fixed = {measure.digest(b) for b in measure.fixed_blocks(inserted, 4096)}
        fixed_kept = len(base_fixed & new_fixed) / len(base_fixed)

        self.assertGreater(cdc_kept, 0.8, "CDC should keep most blocks after a front insert")
        self.assertLess(fixed_kept, 0.2, "fixed blocks should lose almost all blocks after a shift")

    def test_blocks_reassemble_the_input(self):
        data = b"hello world" * 300
        self.assertEqual(b"".join(measure.cdc_blocks(data)), data)
        self.assertEqual(b"".join(measure.fixed_blocks(data, 64)), data)


class Dedup(unittest.TestCase):
    def test_duplicate_files_dedup_almost_fully(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = json.dumps({"rows": list(range(200))})
            for i in range(5):
                (root / f"copy{i}.json").write_text(payload, encoding="utf-8")
            paths = sorted(root.glob("*.json"))
            result = measure.measure_storage(paths, 4096)
            # 5 identical files: at most 4/5 of the bytes can be saved.
            self.assertGreater(result["dedup_ratio_fixed"], 0.75)
            self.assertGreater(result["dedup_ratio_cdc"], 0.75)


class Network(unittest.TestCase):
    def test_cdc_beats_fixed_blocks_on_real_history(self):
        repo = HERE.parents[2]
        if not (repo / ".git").exists():
            self.skipTest("not a git checkout")
        result = measure.measure_network(repo, "android/build.py", 512)
        if "error" in result:
            self.skipTest(result["error"])
        self.assertLess(result["mean_ratio_cdc"], result["mean_ratio_fixed"])


class Reproducibility(unittest.TestCase):
    def test_two_runs_agree_except_timing(self):
        repo = HERE.parents[2]
        cmd = [
            sys.executable,
            str(HERE / "measure.py"),
            "--corpus",
            str(repo),
            "--files",
            "20",
            "--block",
            "512",
            "--history-file",
            "android/build.py",
        ]
        runs = []
        for _ in range(2):
            out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
            data = json.loads(out)
            data.pop("M4_cost")
            runs.append(data)
        self.assertEqual(runs[0], runs[1])


if __name__ == "__main__":
    unittest.main(verbosity=2)
