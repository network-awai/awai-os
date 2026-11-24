#!/usr/bin/env python3
"""Checks for the math-core simulator (stdlib unittest)."""

from __future__ import annotations

import copy
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import rank


def data() -> dict:
    return rank.load(rank.DEFAULT_SCORES)


class SimulatorTest(unittest.TestCase):
    def test_weights_total_matches_survey(self) -> None:
        self.assertEqual(rank.weight_total(data()), 59)

    def test_all_ten_is_exactly_one_hundred(self) -> None:
        payload = data()
        maximum = {"id": "max", "label": "max", "scores": {a["id"]: 10 for a in payload["axes"]}}
        self.assertEqual(rank.score(payload, maximum), 100.0)
        minimum = {"id": "min", "label": "min", "scores": {a["id"]: 0 for a in payload["axes"]}}
        self.assertEqual(rank.score(payload, minimum), 0.0)

    def test_score_within_bounds_for_every_system(self) -> None:
        payload = data()
        for system in payload["systems"]:
            value = rank.score(payload, system)
            self.assertGreaterEqual(value, 0.0)
            self.assertLessEqual(value, 100.0)

    def test_zero_weight_total_is_zero_score_not_division_error(self) -> None:
        payload = data()
        for axis in payload["axes"]:
            axis["weight"] = 0
        self.assertEqual(rank.score(payload, payload["systems"][0]), 0.0)

    def test_ranking_is_sorted_descending(self) -> None:
        rows = rank.rank(data(), 7)
        scores = [row["score"] for row in rows]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertEqual([row["rank"] for row in rows], list(range(1, len(rows) + 1)))

    def test_hard_constraint_excludes_below_floor(self) -> None:
        payload = data()
        graph = next(s for s in payload["systems"] if s["id"] == "graph_rewriting")
        rewriting = next(s for s in payload["systems"] if s["id"] == "rewriting_logic")
        self.assertEqual(rank.violations(payload, graph, 7), ["termination"])
        self.assertEqual(rank.violations(payload, rewriting, 7), [])

    def test_floor_zero_admits_everything(self) -> None:
        rows = rank.rank(data(), 0)
        self.assertTrue(all(row["eligible"] for row in rows))

    def test_weight_override_changes_weight_total(self) -> None:
        payload = rank.apply_weight_overrides(data(), ["network=0"])
        self.assertEqual(rank.weight_total(payload), 54)

    def test_weight_override_rejects_unknown_axis(self) -> None:
        with self.assertRaises(SystemExit):
            rank.apply_weight_overrides(data(), ["nope=1"])

    def test_weight_override_rejects_out_of_range(self) -> None:
        with self.assertRaises(SystemExit):
            rank.apply_weight_overrides(data(), ["cpu=9"])

    def test_reference_order_top_and_bottom(self) -> None:
        rows = rank.rank(data(), 0)
        self.assertEqual(rows[0]["id"], "rewriting_logic")
        self.assertEqual(rows[-1]["id"], "constructive_set_theory")

    def test_cli_prints_first_eligible_candidate(self) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            rank.main([])
        self.assertIn("first to build: Rewriting logic", buffer.getvalue())

    def test_cli_json_is_parseable(self) -> None:
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            rank.main(["--json"])
        payload = json.loads(buffer.getvalue())
        self.assertEqual(payload["weightTotal"], 59)
        self.assertEqual(len(payload["rows"]), 16)

    def test_scores_cover_every_axis_for_every_system(self) -> None:
        payload = data()
        axis_ids = {axis["id"] for axis in payload["axes"]}
        for system in payload["systems"]:
            self.assertEqual(set(system["scores"]), axis_ids, system["id"])
            for value in system["scores"].values():
                self.assertTrue(0 <= value <= 10, system["id"])

    def test_deep_copy_not_shared(self) -> None:
        payload = data()
        snapshot = copy.deepcopy(payload)
        rank.apply_weight_overrides(payload, ["cpu=0"])
        self.assertNotEqual(payload, snapshot)

    def test_html_embeds_same_data_as_json_file(self) -> None:
        html = (rank.DEFAULT_SCORES.parent / "index.html").read_text(encoding="utf-8")
        start = html.index('<script id="sim-data" type="application/json">') + len(
            '<script id="sim-data" type="application/json">'
        )
        end = html.index("</script>", start)
        embedded = json.loads(html[start:end])
        self.assertEqual(embedded, data())


if __name__ == "__main__":
    unittest.main(verbosity=2)
