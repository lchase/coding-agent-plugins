#!/usr/bin/env python3
"""Record rows and summarize a token-savings JSONL file. Stdlib only.

The paired question is: on the same task and the same repeat, did this arm
cost a different amount than baseline, and did the grade still pass?
Token totals are reported beside cost because a cut that lands on cache
reads barely moves the bill.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = 1
BOOTSTRAP_N = 5000
BOOTSTRAP_SEED = 0

_SECRET_RE = re.compile(r"sk-ant-[A-Za-z0-9_\-]+")

_USAGE_KEYS = {
    "input": ("input_tokens", "inputTokens"),
    "cache_write": ("cache_creation_input_tokens", "cacheCreationInputTokens"),
    "cache_read": ("cache_read_input_tokens", "cacheReadInputTokens"),
    "output": ("output_tokens", "outputTokens"),
}

HOW_TO_READ = """\
How to read this

A real saving is a paired cost ratio whose 95 percent interval lies entirely below 1, with no drop in pass rate against baseline on the same tasks and repeats.
An interval that contains 1 is no evidence of a cost change. Say that, and do not treat the point estimate as a result.
Token totals can fall while cost stays flat when the removed tokens were cache reads. Cache reads are the cheap bucket on an agent bill.
Cache writes moving up means something rewrote the cached prefix. Cost can rise while the raw token total falls. That is the signature to look for in a compression proxy.
Compare a terse-output arm with the built-in concise arm as well as with baseline. A plugin that does not beat the free output style is not earning its install.
""".rstrip()


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def redact_text(text: str, secret: str | None = None) -> str:
    if secret:
        text = text.replace(secret, "[REDACTED]")
    return _SECRET_RE.sub("[REDACTED]", text)


def redact_obj(obj, secret: str | None):
    if isinstance(obj, str):
        return redact_text(obj, secret)
    if isinstance(obj, list):
        return [redact_obj(item, secret) for item in obj]
    if isinstance(obj, dict):
        return {key: redact_obj(value, secret) for key, value in obj.items()}
    return obj


def parse_claude_output(text: str) -> dict:
    """Accept a single JSON object or a stream of JSON lines. Keep the last object."""
    stripped = text.strip()
    if not stripped:
        return {"is_error": True, "error": "empty claude output"}
    candidates = [stripped]
    candidates.extend(line.strip() for line in stripped.splitlines() if line.strip())
    data = None
    for candidate in reversed(candidates):
        try:
            data = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        else:
            break
    if data is None:
        return {"is_error": True, "error": "unparseable claude output"}
    if isinstance(data, list):
        dicts = [item for item in data if isinstance(item, dict)]
        data = dicts[-1] if dicts else None
    if not isinstance(data, dict):
        return {"is_error": True, "error": "claude output was not an object"}
    return data


def _as_int(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value)


def _pick_int(mapping, keys):
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        found = _as_int(mapping.get(key))
        if found is not None:
            return found
    return None


def _sum_model_usage(model_usage) -> dict | None:
    if not isinstance(model_usage, dict) or not model_usage:
        return None
    totals = {name: 0 for name in _USAGE_KEYS}
    saw = False
    for info in model_usage.values():
        if not isinstance(info, dict):
            continue
        nested = info.get("usage") if isinstance(info.get("usage"), dict) else info
        for name, keys in _USAGE_KEYS.items():
            found = _pick_int(nested, keys)
            if found is not None:
                totals[name] += found
                saw = True
    return totals if saw else None


def extract_usage(raw: dict) -> dict:
    usage = raw.get("usage") if isinstance(raw.get("usage"), dict) else None
    buckets = {name: _pick_int(usage, keys) for name, keys in _USAGE_KEYS.items()}
    if all(value is None for value in buckets.values()):
        summed = _sum_model_usage(raw.get("modelUsage") or raw.get("model_usage"))
        if summed is not None:
            buckets = summed
    for name in list(buckets):
        if buckets[name] is None:
            buckets[name] = 0
    detail = None
    if isinstance(usage, dict):
        candidate = usage.get("cache_creation") or usage.get("cacheCreation")
        if isinstance(candidate, dict):
            detail = candidate
    buckets["cache_creation_detail"] = detail
    return buckets


def _first_number(mapping, keys):
    if not isinstance(mapping, dict):
        return None
    for key in keys:
        value = mapping.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        return float(value)
    return None


def build_record(meta: dict, raw_text: str, *, secret: str | None = None, stderr_text: str = "") -> dict:
    raw = redact_obj(parse_claude_output(raw_text), secret)
    usage = extract_usage(raw)
    model_usage = raw.get("modelUsage") if isinstance(raw.get("modelUsage"), dict) else None
    if model_usage is None and isinstance(raw.get("model_usage"), dict):
        model_usage = raw.get("model_usage")
    resolved = None
    if model_usage:
        resolved = ",".join(sorted(str(key) for key in model_usage))
    grade = str(meta.get("grade") or "FAIL:ungraded")
    t0 = float(meta["t0"])
    t1 = float(meta["t1"])
    cost = _first_number(raw, ("total_cost_usd", "totalCostUsd"))
    turns = _pick_int(raw, ("num_turns", "numTurns"))
    errored = bool(
        raw.get("is_error")
        or raw.get("isError")
        or meta.get("arm_check_failed")
        or meta.get("timed_out")
        or raw.get("error")
    )
    tail = redact_text(stderr_text or "", secret).strip()
    if len(tail) > 400:
        tail = tail[-400:]
    tool_versions = meta.get("tool_versions") or {}
    if not isinstance(tool_versions, dict):
        tool_versions = {}
    return {
        "schema": SCHEMA,
        "synthetic": False,
        "dry_run": bool(meta.get("dry_run")),
        "pilot": bool(meta.get("pilot")),
        "timed_out": bool(meta.get("timed_out")),
        "arm_check_failed": bool(meta.get("arm_check_failed")),
        "exit_code": int(meta.get("exit_code") or 0),
        "bench_rev": meta.get("bench_rev") or "unknown",
        "bench_dirty": bool(meta.get("bench_dirty")),
        "target_url": meta.get("target_url"),
        "target_tag": meta.get("target_tag"),
        "target_commit": meta.get("target_commit"),
        "target_tree": meta.get("target_tree"),
        "claude_version": meta.get("claude_version") or "",
        "model": meta.get("model"),
        "model_resolved": resolved,
        "effort": meta.get("effort"),
        "arm": meta.get("arm"),
        "arm_script_sha256": meta.get("arm_script_sha256"),
        "tool_versions": tool_versions,
        "task": meta.get("task"),
        "task_sha256": meta.get("task_sha256"),
        "rep": int(meta["rep"]),
        "arm_order": list(meta.get("arm_order") or []),
        "order_index": int(meta.get("order_index") or 0),
        "shuffle_seed": int(meta.get("shuffle_seed") or 0),
        "started_at": meta.get("started_at"),
        "ended_at": meta.get("ended_at"),
        "wall_s": round(t1 - t0, 3),
        "grade": grade,
        "pass": grade == "PASS",
        "cost_usd": cost,
        "num_turns": turns,
        "is_error": errored,
        "input": usage["input"],
        "cache_write": usage["cache_write"],
        "cache_read": usage["cache_read"],
        "output": usage["output"],
        "cache_creation_detail": usage["cache_creation_detail"],
        "model_usage": model_usage,
        "max_turns": int(meta.get("max_turns") or 0),
        "max_budget_usd": float(meta.get("max_budget_usd") or 0),
        "wall_timeout_s": int(meta.get("wall_timeout_s") or 0),
        "selected_reps": int(meta.get("selected_reps") or 0),
        "selected_tasks": list(meta.get("selected_tasks") or []),
        "selected_arms": list(meta.get("selected_arms") or []),
        "os": sys.platform,
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        "runner": meta.get("runner") or None,
        "stderr_tail": tail,
    }


def append_jsonl(path: Path, record: dict) -> None:
    import fcntl

    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, sort_keys=True, separators=(",", ":"))
    with path.open("a", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        handle.write(line + "\n")
        handle.flush()


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    text = path.read_text(encoding="utf-8")
    for line_no, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            row = json.loads(stripped)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}:{line_no}: invalid JSON: {exc}") from exc
        if not isinstance(row, dict):
            raise SystemExit(f"{path}:{line_no}: expected an object")
        rows.append(row)
    return rows


def _billed(row: dict) -> bool:
    return isinstance(row.get("cost_usd"), (int, float)) and not isinstance(row.get("cost_usd"), bool)


def _tokens(row: dict) -> float:
    return float(row.get("input") or 0) + float(row.get("cache_write") or 0) + float(
        row.get("cache_read") or 0
    ) + float(row.get("output") or 0)


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    return float(statistics.median(values))


def bootstrap_median_ci(values: list[float], n: int = BOOTSTRAP_N, seed: int = BOOTSTRAP_SEED):
    """95 percent interval for the median. Seeded so the same file reprints the same interval."""
    if len(values) < 2:
        return None
    rng = random.Random(seed)
    medians = sorted(statistics.median(rng.choices(values, k=len(values))) for _ in range(n))
    lo_i = int(0.025 * n)
    hi_i = min(n - 1, int(0.975 * n))
    return float(medians[lo_i]), float(medians[hi_i])


def _paired_ratios(arm_rows: list[dict], base_by_key: dict, value_fn) -> list[float]:
    ratios = []
    for row in arm_rows:
        if not _billed(row):
            continue
        base = base_by_key.get((row.get("task"), row.get("rep")))
        if base is None or not _billed(base):
            continue
        base_value = value_fn(base)
        arm_value = value_fn(row)
        if base_value is None or arm_value is None or base_value == 0:
            continue
        ratios.append(float(arm_value) / float(base_value))
    return ratios


def _ratio_summary(values: list[float]) -> dict | None:
    if not values:
        return None
    ci = bootstrap_median_ci(values)
    summary = {"n": len(values), "median": float(statistics.median(values)), "lo": None, "hi": None}
    if ci is not None:
        summary["lo"], summary["hi"] = ci
    return summary


def _label(cost_summary: dict | None, regressions: int) -> str:
    if cost_summary is None or cost_summary["n"] < 2 or cost_summary["lo"] is None:
        if regressions:
            return "pass rate dropped, too few pairs"
        return "too few pairs"
    lo = cost_summary["lo"]
    hi = cost_summary["hi"]
    if regressions:
        if hi < 1:
            return "pass rate dropped"
        if lo > 1:
            return "more expensive, pass rate dropped"
        return "no evidence, pass rate dropped"
    if hi < 1:
        return "real saving"
    if lo > 1:
        return "more expensive"
    return "no evidence"


def _arm_stats(arm: str, rows: list[dict], base_rows: list[dict] | None, *, is_baseline: bool = False) -> dict:
    passed = sum(1 for row in rows if row.get("pass") is True)
    costs = [float(row["cost_usd"]) for row in rows if _billed(row)]
    stats = {
        "arm": arm,
        "n": len(rows),
        "passed": passed,
        "pass_rate": (passed / len(rows)) if rows else 0.0,
        "median_cost": _median(costs),
        "median_input": _median([float(row.get("input") or 0) for row in rows]),
        "median_cache_write": _median([float(row.get("cache_write") or 0) for row in rows]),
        "median_cache_read": _median([float(row.get("cache_read") or 0) for row in rows]),
        "median_output": _median([float(row.get("output") or 0) for row in rows]),
        "median_wall_s": _median(
            [float(row["wall_s"]) for row in rows if isinstance(row.get("wall_s"), (int, float))]
        ),
        "label": "baseline" if is_baseline else "no baseline",
        "pass_regressions": 0,
        "tokens_down": False,
        "tokens_down_cost_flat": False,
        "output_down_cost_flat": False,
        "cache_writes_up": False,
        "cost": None,
        "input": None,
        "cache_write": None,
        "cache_read": None,
        "output": None,
        "tokens": None,
    }
    if is_baseline or not base_rows:
        return stats
    base_by_key = {(row.get("task"), row.get("rep")): row for row in base_rows}
    regressions = 0
    for row in rows:
        base = base_by_key.get((row.get("task"), row.get("rep")))
        if base is not None and base.get("pass") is True and row.get("pass") is not True:
            regressions += 1
    cost = _ratio_summary(_paired_ratios(rows, base_by_key, lambda row: float(row["cost_usd"])))
    fields = {
        "input": lambda row: float(row.get("input") or 0),
        "cache_write": lambda row: float(row.get("cache_write") or 0),
        "cache_read": lambda row: float(row.get("cache_read") or 0),
        "output": lambda row: float(row.get("output") or 0),
        "tokens": _tokens,
    }
    paired = {name: _ratio_summary(_paired_ratios(rows, base_by_key, fn)) for name, fn in fields.items()}
    label = _label(cost, regressions)
    tokens = paired["tokens"]
    output = paired["output"]
    writes = paired["cache_write"]
    tokens_down = bool(tokens and tokens["median"] < 0.9)
    output_down = bool(output and output["median"] < 0.75)
    writes_up = bool(writes and writes["median"] > 1.5)
    stats.update(
        {
            "label": label,
            "pass_regressions": regressions,
            "tokens_down": tokens_down,
            "tokens_down_cost_flat": tokens_down and label == "no evidence",
            "output_down_cost_flat": output_down and label == "no evidence",
            "cache_writes_up": writes_up,
            "cost": cost,
            "input": paired["input"],
            "cache_write": writes,
            "cache_read": paired["cache_read"],
            "output": output,
            "tokens": tokens,
        }
    )
    return stats


def _notes(stats: dict) -> str:
    if stats["label"] == "baseline":
        return ""
    parts = [stats["label"]]
    if stats["tokens_down_cost_flat"]:
        parts.append("tokens down, cost flat")
    elif stats["tokens_down"] and stats["label"] != "real saving":
        parts.append("tokens down, cost not lower")
    if stats["output_down_cost_flat"]:
        parts.append("output down, cost flat")
    if stats["cache_writes_up"]:
        parts.append("cache writes up")
    return "; ".join(parts)


def _arm_order(names: list[str], baseline: str) -> list[str]:
    ordered = []
    if baseline in names:
        ordered.append(baseline)
    if "concise" in names and "concise" not in ordered:
        ordered.append("concise")
    ordered.extend(sorted(name for name in names if name not in ordered))
    return ordered


def summarize(
    rows: list[dict],
    *,
    baseline: str = "baseline",
    drop_first_rep: bool = False,
    allow_dry_run: bool = False,
) -> dict:
    warnings: list[str] = []
    if any(bool(row.get("synthetic")) for row in rows) and any(not bool(row.get("synthetic")) for row in rows):
        raise SystemExit("refusing to mix synthetic rows with measurement rows")
    if any(bool(row.get("dry_run")) for row in rows) and any(not bool(row.get("dry_run")) for row in rows):
        raise SystemExit("refusing to mix dry-run rows with live rows")
    synthetic = bool(rows) and all(bool(row.get("synthetic")) for row in rows)
    dry = bool(rows) and all(bool(row.get("dry_run")) for row in rows)
    if dry and not allow_dry_run:
        raise SystemExit(
            "this file is a dry run (claude was not called). Pass --allow-dry-run to print it. It is not a measurement."
        )
    pilot_n = 0
    kept = []
    for row in rows:
        if row.get("pilot") is True:
            pilot_n += 1
            continue
        if drop_first_rep and row.get("rep") == 1:
            continue
        if not row.get("arm") or row.get("task") is None or row.get("rep") is None:
            warnings.append("skipped a row missing arm, task, or rep")
            continue
        kept.append(row)

    groups_map: dict[tuple, list] = defaultdict(list)
    for row in kept:
        key = (row.get("model"), row.get("effort"), row.get("target_commit"))
        groups_map[key].append(row)

    groups = []
    for key in sorted(groups_map, key=lambda item: tuple("" if part is None else str(part) for part in item)):
        group_rows = groups_map[key]
        by_arm: dict[str, list] = defaultdict(list)
        for row in group_rows:
            by_arm[row["arm"]].append(row)
        # Duplicate (task, rep, arm) keeps the last row and warns once per arm.
        for arm, arm_rows in by_arm.items():
            seen = {}
            dup = False
            for row in arm_rows:
                ident = (row.get("task"), row.get("rep"))
                if ident in seen:
                    dup = True
                seen[ident] = row
            if dup:
                warnings.append(f"duplicate rows for arm {arm}; kept the last row per task and repeat")
            by_arm[arm] = list(seen.values())
        base_rows = by_arm.get(baseline)
        if base_rows is None:
            warnings.append(f"no {baseline!r} rows for model={key[0]!r} effort={key[1]!r}")
        names = _arm_order(list(by_arm), baseline)
        arms = {}
        for name in names:
            arms[name] = _arm_stats(
                name,
                by_arm[name],
                None if name == baseline else base_rows,
                is_baseline=name == baseline,
            )
        tasks = sorted({row.get("task") for row in group_rows})
        per_task = []
        for task in tasks:
            cells = {}
            for name in names:
                task_rows = [row for row in by_arm[name] if row.get("task") == task]
                billed = [float(row["cost_usd"]) for row in task_rows if _billed(row)]
                cells[name] = {
                    "n": len(task_rows),
                    "passed": sum(1 for row in task_rows if row.get("pass") is True),
                    "median_cost": _median(billed),
                }
            per_task.append({"task": task, "arms": cells})
        groups.append(
            {
                "model": key[0],
                "effort": key[1],
                "target_commit": key[2],
                "arm_order": names,
                "arms": arms,
                "per_task": per_task,
            }
        )

    versions = sorted({str(row.get("claude_version")) for row in kept if row.get("claude_version")})
    return {
        "synthetic": synthetic,
        "dry_run": dry,
        "pilot_excluded": pilot_n,
        "row_count": len(rows),
        "kept": len(kept),
        "claude_versions": versions,
        "warnings": warnings,
        "groups": groups,
        "baseline": baseline,
        "drop_first_rep": drop_first_rep,
    }


def _fmt_money(value) -> str:
    if value is None:
        return "-"
    return f"{value:.4f}"


def _fmt_ratio(summary: dict | None) -> str:
    if not summary:
        return "-"
    median = f"{summary['median']:.3f}"
    if summary.get("lo") is None:
        return f"{median} (n={summary['n']}, no interval)"
    return f"{median} [{summary['lo']:.3f}, {summary['hi']:.3f}]"


def _fmt_num(value) -> str:
    if value is None:
        return "-"
    return f"{value:.0f}"


def _markdown_table(headers: list[str], rows: list[list[str]]) -> str:
    head = "| " + " | ".join(headers) + " |"
    sep = "| " + " | ".join("---" for _ in headers) + " |"
    body = ["| " + " | ".join(row) + " |" for row in rows]
    return "\n".join([head, sep, *body])


def render_markdown(summary: dict, *, source: str) -> str:
    lines = []
    if summary["synthetic"]:
        lines.append("# SYNTHETIC summary")
        lines.append("")
        lines.append(
            "These rows are invented numbers for testing the report. They are not a measurement of Claude Code or of any plugin."
        )
    elif summary["dry_run"]:
        lines.append("# Dry-run summary")
        lines.append("")
        lines.append("Claude was not called. This checks the harness and the grader. It is not a measurement.")
    else:
        lines.append("# Token-savings summary")
    lines.append("")
    lines.append(f"Source: `{source}`")
    lines.append(
        f"Rows in file: {summary['row_count']}. Rows in the paired tables: {summary['kept']}. Pilot rows excluded: {summary['pilot_excluded']}."
    )
    if summary["drop_first_rep"]:
        lines.append("Repeat 1 is excluded (`--drop-first-rep`).")
    if summary["claude_versions"]:
        lines.append("Claude Code version strings in these rows: " + ", ".join(f"`{item}`" for item in summary["claude_versions"]) + ".")
    if summary["warnings"]:
        lines.append("")
        lines.append("Warnings:")
        for warning in summary["warnings"]:
            lines.append(f"- {warning}")
    if not summary["groups"]:
        lines.append("")
        lines.append("No paired rows to report. A pilot file only prices sessions; it is excluded from the ratio tables.")
        lines.append("")
        lines.append(HOW_TO_READ)
        return "\n".join(lines) + "\n"

    for group in summary["groups"]:
        commit = group["target_commit"] or "unknown"
        short = commit[:12] if isinstance(commit, str) else commit
        lines.append("")
        lines.append(
            f"## model `{group['model']}` / effort `{group['effort']}` / target `{short}`"
        )
        lines.append("")
        headers = ["arm", "n", "passed", "median USD", "paired cost ratio vs baseline", "notes"]
        table = []
        bucket_headers = ["arm", "fresh", "cache write", "cache read", "output", "fresh ratio", "write ratio", "read ratio", "output ratio"]
        buckets = []
        for name in group["arm_order"]:
            stats = group["arms"][name]
            table.append(
                [
                    name,
                    str(stats["n"]),
                    f"{stats['passed']}/{stats['n']}",
                    _fmt_money(stats["median_cost"]),
                    "-" if name == summary["baseline"] else _fmt_ratio(stats["cost"]),
                    _notes(stats) or "-",
                ]
            )
            buckets.append(
                [
                    name,
                    _fmt_num(stats["median_input"]),
                    _fmt_num(stats["median_cache_write"]),
                    _fmt_num(stats["median_cache_read"]),
                    _fmt_num(stats["median_output"]),
                    "-" if name == summary["baseline"] else _fmt_ratio(stats["input"]),
                    "-" if name == summary["baseline"] else _fmt_ratio(stats["cache_write"]),
                    "-" if name == summary["baseline"] else _fmt_ratio(stats["cache_read"]),
                    "-" if name == summary["baseline"] else _fmt_ratio(stats["output"]),
                ]
            )
        lines.append(_markdown_table(headers, table))
        lines.append("")
        lines.append("Median token buckets, and the paired ratio of each bucket against baseline:")
        lines.append("")
        lines.append(_markdown_table(bucket_headers, buckets))
        if "concise" in group["arms"] and summary["baseline"] != "concise":
            lines.append("")
            lines.append("Paired cost ratio against the `concise` arm (the built-in output style):")
            lines.append("")
            concise_rows_note = []
            # Recompute from stored cost ratios is not possible; the renderer only has arm stats
            # versus baseline. The versus-concise ratios are attached when present.
            headers2 = ["arm", "paired cost ratio vs concise"]
            rows2 = []
            for name in group["arm_order"]:
                if name in (summary["baseline"], "concise"):
                    continue
                versus = group["arms"][name].get("versus_concise")
                if versus is None:
                    continue
                rows2.append([name, _fmt_ratio(versus)])
            if rows2:
                lines.append(_markdown_table(headers2, rows2))
            else:
                concise_rows_note.append("No second arm had a billed pair against concise.")
                lines.extend(concise_rows_note)
        lines.append("")
        lines.append("Per task: median USD and how many runs passed.")
        lines.append("")
        task_headers = ["task", *group["arm_order"]]
        task_rows = []
        for task in group["per_task"]:
            cells = [str(task["task"])]
            for name in group["arm_order"]:
                cell = task["arms"].get(name) or {"n": 0, "passed": 0, "median_cost": None}
                if cell["n"] == 0:
                    cells.append("-")
                else:
                    cells.append(f"{_fmt_money(cell['median_cost'])} {cell['passed']}/{cell['n']}")
            task_rows.append(cells)
        lines.append(_markdown_table(task_headers, task_rows))

    lines.append("")
    lines.append(HOW_TO_READ)
    return "\n".join(lines) + "\n"


def _attach_versus_concise(summary: dict, rows: list[dict]) -> None:
    """Fill versus_concise from billed rows. summarize_and_attach invokes this."""
    billed_rows = [row for row in rows if row.get("pilot") is not True and _billed(row)]
    if summary.get("drop_first_rep"):
        billed_rows = [row for row in billed_rows if row.get("rep") != 1]
    for group in summary["groups"]:
        if "concise" not in group["arms"]:
            continue
        matching = [
            row
            for row in billed_rows
            if row.get("model") == group["model"]
            and row.get("effort") == group["effort"]
            and row.get("target_commit") == group["target_commit"]
        ]
        by_arm = defaultdict(list)
        for row in matching:
            by_arm[row["arm"]].append(row)
        concise = by_arm.get("concise") or []
        concise_by_key = {(row.get("task"), row.get("rep")): row for row in concise}
        for name, stats in group["arms"].items():
            if name in (summary["baseline"], "concise"):
                continue
            ratios = _paired_ratios(by_arm.get(name) or [], concise_by_key, lambda row: float(row["cost_usd"]))
            stats["versus_concise"] = _ratio_summary(ratios)


def summarize_and_attach(rows, **kwargs):
    # Filter to the same population summarize keeps, for the concise pass.
    drop_first = kwargs.get("drop_first_rep", False)
    allow_dry = kwargs.get("allow_dry_run", False)
    summary = summarize(rows, **kwargs)
    usable = []
    for row in rows:
        if row.get("pilot") is True:
            continue
        if row.get("dry_run") and not allow_dry:
            continue
        if drop_first and row.get("rep") == 1:
            continue
        usable.append(row)
    _attach_versus_concise(summary, usable)
    return summary


def analyze_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Summarize token-savings JSONL results.")
    parser.add_argument("jsonl", type=Path)
    parser.add_argument("-o", "--output", type=Path, help="Also write the markdown report to this path")
    parser.add_argument("--baseline", default="baseline")
    parser.add_argument(
        "--drop-first-rep",
        action="store_true",
        help="Drop repeat 1. The first session in a batch often pays cache writes the later ones do not.",
    )
    parser.add_argument("--allow-dry-run", action="store_true")
    args = parser.parse_args(argv)
    if not args.jsonl.is_file():
        print(f"no such file: {args.jsonl}", file=sys.stderr)
        return 2
    rows = load_jsonl(args.jsonl)
    summary = summarize_and_attach(
        rows,
        baseline=args.baseline,
        drop_first_rep=args.drop_first_rep,
        allow_dry_run=args.allow_dry_run,
    )
    report = render_markdown(summary, source=str(args.jsonl))
    sys.stdout.write(report)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(report, encoding="utf-8")
    return 0


def update_manifest(path: Path, arm: str, summary: str, homepage: str, script_sha: str, versions: dict) -> None:
    data = {}
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8") or "{}")
    data["schema"] = 1
    data.setdefault("arms", {})
    data["arms"][arm] = {
        "homepage": homepage,
        "ready_at": iso_now(),
        "script_sha256": script_sha,
        "summary": summary,
        "tool_versions": versions,
    }
    data["updated_at"] = iso_now()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_versions_tsv(text: str) -> dict:
    versions = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        cmd, status, detail = line.split("\t", 2)
        detail = detail.strip()
        versions[cmd] = detail if status == "ok" else f"{status}: {detail}"
    return versions


def manifest_cli(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Record one arm in .arms/manifest.json")
    parser.add_argument("--path", type=Path, required=True)
    parser.add_argument("--arm", required=True)
    parser.add_argument("--summary", default="")
    parser.add_argument("--homepage", default="")
    parser.add_argument("--script-sha", required=True)
    parser.add_argument("--versions-tsv", type=Path, required=True)
    args = parser.parse_args(argv)
    versions = parse_versions_tsv(args.versions_tsv.read_text(encoding="utf-8"))
    update_manifest(args.path, args.arm, args.summary, args.homepage, args.script_sha, versions)
    return 0


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv and argv[0] == "manifest":
        return manifest_cli(argv[1:])
    return analyze_cli(argv)


if __name__ == "__main__":
    raise SystemExit(main())
