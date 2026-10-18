#!/usr/bin/env python3
"""Invented rows for analyze.py. Not a measurement. Do not copy into results/runs.jsonl."""

from __future__ import annotations

import json
from pathlib import Path

TARGET = "8b19813f2bfca99f1018a587a8cf54fc959f2e5d"
TASKS = ("t1-intrange", "t2-splitopt")
REPS = range(1, 9)
NOISY_COSTS = (0.35, 1.85, 0.40, 1.90, 0.45, 1.70, 0.50, 1.80)

# input, cache_write, cache_read, output
BASE_TOKENS = (1000, 4000, 200_000, 3000)


def _row(arm: str, task: str, rep: int, cost: float, tokens: tuple[int, int, int, int], passed: bool) -> dict:
    return {
        "arm": arm,
        "cache_read": tokens[2],
        "cache_write": tokens[1],
        "claude_version": "synthetic",
        "cost_usd": cost,
        "dry_run": False,
        "effort": "medium",
        "input": tokens[0],
        "model": "sonnet",
        "output": tokens[3],
        "pass": passed,
        "pilot": False,
        "rep": rep,
        "schema": 1,
        "synthetic": True,
        "target_commit": TARGET,
        "task": task,
        "wall_s": 10.0,
    }


def _scaled(factor: float) -> tuple[int, int, int, int]:
    return tuple(int(value * factor) for value in BASE_TOKENS)  # type: ignore[return-value]


def build_rows() -> list[dict]:
    rows: list[dict] = []
    specs = {
        "baseline": lambda _rep: (1.0, BASE_TOKENS, True),
        "concise": lambda _rep: (1.0, (1000, 4000, 200_000, 400), True),
        "cheaper": lambda _rep: (0.5, _scaled(0.5), True),
        "read-cut": lambda _rep: (1.0, (1000, 4000, 20_000, 3000), True),
        "cache-bust": lambda _rep: (1.5, (1000, 32_000, 20_000, 3000), True),
        "noisy": lambda rep: (NOISY_COSTS[rep - 1], BASE_TOKENS, True),
        "regress": lambda _rep: (0.4, BASE_TOKENS, False),
    }
    for task in TASKS:
        for rep in REPS:
            for arm, spec in specs.items():
                cost, tokens, passed = spec(rep)
                rows.append(_row(arm, task, rep, cost, tokens, passed))
    return rows


def main() -> None:
    path = Path(__file__).resolve().parent / "testdata" / "synthetic-runs.jsonl"
    rows = build_rows()
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
    print(f"wrote {len(rows)} synthetic rows to {path}")


if __name__ == "__main__":
    main()
