#!/usr/bin/env python3
"""Merge one Claude JSON result with runner metadata and append a JSONL row."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from benchlib import append_jsonl, build_record


def _flag(name: str) -> bool:
    return os.environ.get(name, "0") == "1"


def _comma(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [part for part in raw.split(",") if part]


def meta_from_env() -> dict:
    required = [
        "BENCH_TASK",
        "BENCH_ARM",
        "BENCH_REP",
        "BENCH_GRADE",
        "BENCH_MODEL",
        "BENCH_EFFORT",
        "BENCH_STARTED_AT",
        "BENCH_ENDED_AT",
        "BENCH_T0",
        "BENCH_T1",
        "BENCH_EXIT_CODE",
    ]
    missing = [name for name in required if name not in os.environ]
    if missing:
        raise SystemExit("record_run: missing " + ", ".join(missing))
    tool_raw = os.environ.get("BENCH_TOOL_VERSIONS", "{}")
    try:
        tool_versions = json.loads(tool_raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"record_run: BENCH_TOOL_VERSIONS is not JSON: {exc}") from exc
    return {
        "task": os.environ["BENCH_TASK"],
        "arm": os.environ["BENCH_ARM"],
        "rep": os.environ["BENCH_REP"],
        "grade": os.environ["BENCH_GRADE"],
        "model": os.environ["BENCH_MODEL"],
        "effort": os.environ["BENCH_EFFORT"],
        "started_at": os.environ["BENCH_STARTED_AT"],
        "ended_at": os.environ["BENCH_ENDED_AT"],
        "t0": os.environ["BENCH_T0"],
        "t1": os.environ["BENCH_T1"],
        "exit_code": os.environ["BENCH_EXIT_CODE"],
        "dry_run": _flag("BENCH_DRY_RUN"),
        "pilot": _flag("BENCH_PILOT"),
        "timed_out": _flag("BENCH_TIMED_OUT"),
        "arm_check_failed": _flag("BENCH_ARM_CHECK_FAILED"),
        "bench_rev": os.environ.get("BENCH_REV", "unknown"),
        "bench_dirty": _flag("BENCH_DIRTY"),
        "claude_version": os.environ.get("BENCH_CLAUDE_VERSION", ""),
        "arm_script_sha256": os.environ.get("BENCH_ARM_SHA", ""),
        "task_sha256": os.environ.get("BENCH_TASK_SHA", ""),
        "arm_order": _comma("BENCH_ARM_ORDER"),
        "order_index": os.environ.get("BENCH_ORDER_INDEX", "0"),
        "shuffle_seed": os.environ.get("BENCH_SHUFFLE_SEED", "0"),
        "max_turns": os.environ.get("BENCH_MAX_TURNS", "0"),
        "max_budget_usd": os.environ.get("BENCH_MAX_BUDGET", "0"),
        "wall_timeout_s": os.environ.get("BENCH_WALL_TIMEOUT", "0"),
        "selected_reps": os.environ.get("BENCH_SELECTED_REPS", "0"),
        "selected_tasks": _comma("BENCH_SELECTED_TASKS"),
        "selected_arms": _comma("BENCH_SELECTED_ARMS"),
        "tool_versions": tool_versions,
        "target_url": os.environ.get("BENCH_TARGET_URL", ""),
        "target_tag": os.environ.get("BENCH_TARGET_TAG", ""),
        "target_commit": os.environ.get("BENCH_TARGET_COMMIT", ""),
        "target_tree": os.environ.get("BENCH_TARGET_TREE", ""),
        "runner": os.environ.get("BENCH_RUNNER") or None,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Append one benchmark row.")
    parser.add_argument("--from-env", action="store_true")
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--stderr", type=Path)
    parser.add_argument("--append", type=Path, required=True)
    args = parser.parse_args(argv)
    if not args.from_env:
        raise SystemExit("record_run: pass --from-env")
    raw_text = args.raw.read_text(encoding="utf-8", errors="replace") if args.raw.is_file() else ""
    stderr_text = ""
    if args.stderr is not None and args.stderr.is_file():
        stderr_text = args.stderr.read_text(encoding="utf-8", errors="replace")
    record = build_record(
        meta_from_env(),
        raw_text,
        secret=os.environ.get("ANTHROPIC_API_KEY") or None,
        stderr_text=stderr_text,
    )
    append_jsonl(args.append, record)
    cost = record["cost_usd"]
    cost_txt = "null" if cost is None else f"{cost:.4f}"
    print(
        f"{record['task']} {record['arm']} rep {record['rep']} -> {record['grade']} cost={cost_txt}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
