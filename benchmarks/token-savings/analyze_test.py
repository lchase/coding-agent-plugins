#!/usr/bin/env python3
"""Unit tests for the JSONL summary. The fixture numbers are synthetic."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchlib import build_record, load_jsonl, render_markdown, summarize_and_attach
from synthetic_fixture import build_rows

ROOT = Path(__file__).resolve().parent
FIXTURE = ROOT / "testdata" / "synthetic-runs.jsonl"


class RecordTests(unittest.TestCase):
    def meta(self, **overrides):
        base = {
            "task": "t1-intrange",
            "arm": "baseline",
            "rep": 1,
            "grade": "PASS",
            "t0": "10.0",
            "t1": "12.5",
            "model": "sonnet",
            "effort": "medium",
            "target_commit": "abc",
        }
        base.update(overrides)
        return base

    def test_usage_and_redaction(self):
        raw = json.dumps(
            {
                "total_cost_usd": 0.125,
                "num_turns": 4,
                "is_error": False,
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 20,
                    "cache_creation_input_tokens": 30,
                    "cache_read_input_tokens": 40,
                    "cache_creation": {"ephemeral_5m_input_tokens": 30, "ephemeral_1h_input_tokens": 0},
                },
                "modelUsage": {"claude-sonnet-5": {"inputTokens": 10}},
                "result": "sk-ant-api03-secretvalue",
            }
        )
        record = build_record(
            self.meta(),
            raw,
            secret="sk-ant-api03-secretvalue",
            stderr_text="failed with sk-ant-api03-secretvalue",
        )
        self.assertEqual(record["cost_usd"], 0.125)
        self.assertEqual(record["input"], 10)
        self.assertEqual(record["cache_write"], 30)
        self.assertEqual(record["cache_read"], 40)
        self.assertEqual(record["output"], 20)
        self.assertEqual(record["wall_s"], 2.5)
        self.assertTrue(record["pass"])
        self.assertEqual(record["backend"], "anthropic")
        self.assertFalse(record["quick"])
        self.assertIsNone(record["ollama_base_url"])
        self.assertEqual(record["model_resolved"], "claude-sonnet-5")
        blob = json.dumps(record)
        self.assertNotIn("secretvalue", blob)
        self.assertIn("[REDACTED]", record["stderr_tail"])

    def test_stream_keeps_last_object(self):
        text = "\n".join(
            [
                json.dumps({"type": "assistant", "message": "partial"}),
                json.dumps(
                    {
                        "type": "result",
                        "total_cost_usd": 1.5,
                        "is_error": False,
                        "num_turns": 3,
                        "usage": {
                            "input_tokens": 5,
                            "output_tokens": 6,
                            "cache_creation_input_tokens": 7,
                            "cache_read_input_tokens": 8,
                        },
                    }
                ),
            ]
        )
        record = build_record(self.meta(grade="FAIL:suite"), text)
        self.assertEqual(record["cost_usd"], 1.5)
        self.assertEqual(record["num_turns"], 3)
        self.assertFalse(record["pass"])
        self.assertEqual(record["grade"], "FAIL:suite")

    def test_unparseable_is_an_error_without_a_fake_cost(self):
        record = build_record(self.meta(), "this is not json")
        self.assertTrue(record["is_error"])
        self.assertIsNone(record["cost_usd"])


class SummaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = build_rows()
        cls.summary = summarize_and_attach(cls.rows)
        cls.arms = cls.summary["groups"][0]["arms"]

    def test_fixture_file_matches_the_builder(self):
        self.assertEqual(load_jsonl(FIXTURE), self.rows)

    def test_banner_and_labels(self):
        self.assertTrue(self.summary["synthetic"])
        self.assertEqual(len(self.summary["groups"]), 1)
        self.assertEqual(self.arms["cheaper"]["label"], "real saving")
        self.assertFalse(self.arms["cheaper"]["tokens_down_cost_flat"])
        self.assertEqual(self.arms["read-cut"]["label"], "no evidence")
        self.assertTrue(self.arms["read-cut"]["tokens_down_cost_flat"])
        self.assertEqual(self.arms["cache-bust"]["label"], "more expensive")
        self.assertTrue(self.arms["cache-bust"]["cache_writes_up"])
        self.assertTrue(self.arms["cache-bust"]["tokens_down"])
        self.assertEqual(self.arms["regress"]["label"], "pass rate dropped")
        self.assertGreater(self.arms["regress"]["pass_regressions"], 0)
        self.assertEqual(self.arms["concise"]["label"], "no evidence")
        self.assertTrue(self.arms["concise"]["output_down_cost_flat"])
        self.assertEqual(self.arms["baseline"]["label"], "baseline")
        noisy = self.arms["noisy"]["cost"]
        self.assertLess(noisy["lo"], 1)
        self.assertGreater(noisy["hi"], 1)
        self.assertEqual(self.arms["noisy"]["label"], "no evidence")

    def test_markdown_marks_synthetic_and_states_the_rule(self):
        report = render_markdown(self.summary, source="testdata/synthetic-runs.jsonl")
        self.assertIn("SYNTHETIC", report)
        self.assertIn("not a measurement", report)
        self.assertIn("real saving", report)
        self.assertIn("entirely below 1", report)
        self.assertIn("cache reads", report)
        self.assertIn("cache writes", report.lower())

    def test_mixed_synthetic_is_refused(self):
        mixed = [dict(self.rows[0], synthetic=False)] + self.rows[1:]
        with self.assertRaises(SystemExit):
            summarize_and_attach(mixed)

    def test_dry_run_is_refused_without_the_flag(self):
        dry = [dict(row, synthetic=False, dry_run=True) for row in self.rows[:4]]
        with self.assertRaises(SystemExit):
            summarize_and_attach(dry)
        allowed = summarize_and_attach(dry, allow_dry_run=True)
        self.assertTrue(allowed["dry_run"])

    def test_pilot_rows_are_excluded_from_the_pairs(self):
        extra = dict(self.rows[0], pilot=True, rep=99, cost_usd=50)
        summary = summarize_and_attach(self.rows + [extra])
        self.assertEqual(summary["pilot_excluded"], 1)
        self.assertEqual(summary["groups"][0]["arms"]["baseline"]["n"], self.arms["baseline"]["n"])

    def test_drop_first_rep(self):
        summary = summarize_and_attach(self.rows, drop_first_rep=True)
        # 2 tasks x 7 remaining repeats.
        self.assertEqual(summary["groups"][0]["arms"]["baseline"]["n"], 14)

    def test_concise_comparison_is_present(self):
        versus = self.arms["cheaper"].get("versus_concise")
        self.assertIsNotNone(versus)
        self.assertLess(versus["hi"], 1)

    def test_local_cheap_cost_is_not_a_saving(self):
        rows = []
        for row in self.rows:
            local = dict(row, backend="local", model="qwen3-coder", quick=False)
            if local["arm"] != "baseline":
                local["cost_usd"] = 0.01
            rows.append(local)
        summary = summarize_and_attach(rows)
        self.assertEqual(len(summary["groups"]), 1)
        group = summary["groups"][0]
        self.assertEqual(group["backend"], "local")
        self.assertFalse(group["quick"])
        cheap = group["arms"]["cheaper"]
        self.assertEqual(cheap["label"], "fewer tokens")
        self.assertNotEqual(cheap["label"], "real saving")
        self.assertIsNone(cheap["cost"])
        flat = []
        for row in self.rows:
            if row["arm"] != "baseline":
                continue
            flat.append(dict(row, backend="local", model="qwen3-coder", cost_usd=1.0))
            flat.append(
                dict(
                    row,
                    arm="priced",
                    backend="local",
                    model="qwen3-coder",
                    cost_usd=0.01,
                )
            )
        flat_summary = summarize_and_attach(flat)
        self.assertEqual(flat_summary["groups"][0]["arms"]["priced"]["label"], "no token evidence")
        report = render_markdown(flat_summary, source="results/local.jsonl")
        self.assertIn("not a cost result", report)
        self.assertIn("not a prompt-cache result", report)
        self.assertIn("does not apply to a local section", report)

    def test_local_and_anthropic_stay_in_separate_sections(self):
        local = [dict(row, backend="local", model="qwen3-coder") for row in self.rows]
        summary = summarize_and_attach(self.rows + local)
        backends = [group["backend"] for group in summary["groups"]]
        self.assertEqual(backends, ["anthropic", "local"])
        self.assertEqual(summary["groups"][0]["arms"]["cheaper"]["label"], "real saving")
        self.assertEqual(summary["groups"][1]["arms"]["cheaper"]["label"], "fewer tokens")
        report = render_markdown(summary, source="mixed.jsonl")
        self.assertIn("mixes local and Anthropic", report)

    def test_quick_preset_warns_that_the_interval_is_not_proof(self):
        rows = [dict(row, quick=True) for row in self.rows]
        summary = summarize_and_attach(rows)
        self.assertTrue(summary["groups"][0]["quick"])
        report = render_markdown(summary, source="results/quick.jsonl")
        self.assertIn("not proof", report)
        self.assertIn("interval is wide", report)


if __name__ == "__main__":
    unittest.main()
