# Results

This directory is the place a local run writes. Everything here except this file is
gitignored. Do not commit a JSONL and call it the official number. People compare files
they produced themselves.

| File | Written by | Meaning |
|---|---|---|
| `runs.jsonl` | `./run_bench.sh --yes` | Paid sessions. `backend` is `anthropic`. Schema 1. |
| `quick.jsonl` | `./run_bench.sh --quick --yes` | Cheap paid preset. `quick: true`. Wide intervals. |
| `local.jsonl` | `./run_bench.sh --ollama <model>` | Local Anthropic-compatible server. `backend` is `local`. Not a cost measurement. |
| `pilot.jsonl` | `./run_bench.sh --pilot --yes` | A pricing session. Excluded from paired ratio tables. |
| `dry-run.jsonl` | `./run_bench.sh --dry-run` | Harness practice. `dry_run: true`. Claude was not called. |
| `*.summary.md` | `analyze.py`, also at the end of `run_bench.sh` | The report for the JSONL with the same stem. |
| `raw/` | `run_bench.sh` | Full Claude JSON, including the model transcript. |

`--fresh` truncates the destination JSONL before appending. Raw files are left in place.
Names in `raw/` look like `<task>.<arm>.<rep>.json`, with a `dry-` or `pilot-` prefix
for those modes. Each has a sibling `.err`.

## Sharing

Send `runs.jsonl` (and the summary, if you want) out of band. Each row carries
`schema`, `bench_rev`, `bench_dirty`, `claude_version`, `model`, `effort`, `arm`,
`arm_script_sha256`, `tool_versions`, `task`, `task_sha256`, `rep`, `arm_order`,
`shuffle_seed`, `started_at`, `ended_at`, the Click pin (`target_url`, `target_tag`,
`target_commit`, `target_tree`), `backend` (`anthropic` or `local`), `quick`,
`ollama_base_url` on local rows, token buckets, `cost_usd`, and `grade`.

Set `BENCH_RUNNER` to a public handle before a live run if the file should say who ran
it. The harness does not record a hostname.

Do not publish `raw/` by default. The JSONL redacts `ANTHROPIC_API_KEY` and `sk-ant-...`
from `stderr_tail`. The transcript itself is not stored on the row. It is stored under
`raw/`.

`testdata/synthetic-runs.jsonl` is invented. It is not a result. Do not copy it here.
`analyze.py` refuses a file that mixes synthetic and real rows, and it refuses a dry-run
file unless you pass `--allow-dry-run`.

Rebuild a report any time:

```bash
./analyze.py results/runs.jsonl
./analyze.py results/runs.jsonl --drop-first-rep -o results/runs.summary.md
```

How to read the ratios is in the benchmark README and is printed at the bottom of every
summary.
