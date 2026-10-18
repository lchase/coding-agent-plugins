#!/usr/bin/env bash
# Offline checks. Does not call Claude and does not spend API money.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"

if ! command -v shellcheck >/dev/null 2>&1; then
  printf '%s\n' "shellcheck is required (apt install shellcheck)" >&2
  exit 1
fi

printf '== shellcheck\n'
shellcheck -x -S warning \
  pins.sh lib.sh fetch_target.sh setup_arms.sh run_bench.sh grade.sh \
  check.sh check_graders.sh \
  arms/*.sh \
  demos/*.sh

printf '== unit\n'
python3 -m unittest analyze_test.py

printf '== arm contract\n'
# shellcheck source=lib.sh
source "$ROOT/lib.sh"
mapfile -t ids < <(list_arm_ids)
printf '%s\n' "${ids[@]}" | grep -qx baseline
printf '%s\n' "${ids[@]}" | grep -qx concise
printf '%s\n' "${ids[@]}" | grep -qx rtk
printf '%s\n' "${ids[@]}" | grep -qx caveman
printf '%s\n' "${ids[@]}" | grep -qx headroom
printf '%s\n' "${ids[@]}" | grep -qx ponytail
if printf '%s\n' "${ids[@]}" | grep -q '^_'; then
  printf '%s\n' "template files leaked into the arm list" >&2
  exit 1
fi
for id in "${ids[@]}"; do
  (
    load_arm "$id"
    [[ -n $arm_summary ]]
  )
done

printf '== plan and cost gate do not invoke claude\n'
sentinel=$(mktemp)
(
  export CLAUDE_SENTINEL=$sentinel
  export PATH="$ROOT/testdata/bin:$PATH"
  unset ANTHROPIC_API_KEY
  ./run_bench.sh --plan >/dev/null
  quick_plan=$(./run_bench.sh --plan --quick)
  local_plan=$(./run_bench.sh --plan --ollama qwen3-coder)
  both_plan=$(./run_bench.sh --plan --quick --ollama qwen3-coder)
  set +e
  ./run_bench.sh -n 1 >/dev/null 2>&1
  no_yes=$?
  ./run_bench.sh --pilot --yes >/dev/null 2>&1
  no_key=$?
  ./run_bench.sh --quick >/dev/null 2>&1
  quick_gate=$?
  ./run_bench.sh --plan --ollama qwen3-coder -m sonnet >/dev/null 2>&1
  clash=$?
  ./run_bench.sh --plan --ollama qwen3-coder -a "baseline headroom" >/dev/null 2>&1
  headroom_clash=$?
  BENCH_OLLAMA_BASE_URL=http://127.0.0.1:9 ./run_bench.sh --ollama qwen3-coder -n 1 -a baseline -t t1-intrange >/tmp/token-savings-ollama-out 2>/tmp/token-savings-ollama-err
  ollama_down=$?
  set -e
  [[ $no_yes -eq 2 ]]
  [[ $no_key -ne 0 ]]
  [[ $quick_gate -eq 2 ]]
  [[ $clash -ne 0 ]]
  [[ $headroom_clash -ne 0 ]]
  [[ $ollama_down -eq 1 ]]
  printf '%s\n' "$quick_plan" | grep -q 'preset: quick'
  printf '%s\n' "$quick_plan" | grep -q 'model: claude-haiku-5-5'
  printf '%s\n' "$quick_plan" | grep -q 'reps: 2'
  printf '%s\n' "$quick_plan" | grep -q 't2-splitopt'
  printf '%s\n' "$quick_plan" | grep -q 't3-explain'
  printf '%s\n' "$quick_plan" | grep -q 'sessions: 24'
  printf '%s\n' "$quick_plan" | grep -q 'hard ceiling for this selection: $120.00'
  printf '%s\n' "$quick_plan" | grep -q 'not proof'
  printf '%s\n' "$local_plan" | grep -q 'backend: local'
  printf '%s\n' "$local_plan" | grep -q 'skipping headroom'
  printf '%s\n' "$local_plan" | grep -q 'dollar cap: not applied'
  printf '%s\n' "$local_plan" | grep -q 'sessions: 100'
  printf '%s\n' "$both_plan" | grep -q 'sessions: 20'
  printf '%s\n' "$both_plan" | grep -q 'model: qwen3-coder'
  grep -q 'not reachable' /tmp/token-savings-ollama-err
  if grep -q 'Nothing was sent' /tmp/token-savings-ollama-err; then
    printf '%s\n' "local mode hit the paid cost gate" >&2
    exit 1
  fi
)
if [[ -s $sentinel ]]; then
  printf '%s\n' "claude was invoked during the cost gate" >&2
  cat "$sentinel" >&2
  exit 1
fi
rm -f "$sentinel"

printf '== setup baseline and concise\n'
./setup_arms.sh baseline concise
./setup_arms.sh baseline concise
python3 - <<'PY'
import json
from pathlib import Path
root = Path(".").resolve()
base = json.loads((root / ".arms" / "baseline" / ".claude" / "settings.json").read_text())
concise = json.loads((root / ".arms" / "concise" / ".claude" / "settings.json").read_text())
assert base == {}, base
assert concise.get("outputStyle") == "Concise", concise
manifest = json.loads((root / ".arms" / "manifest.json").read_text())
assert "baseline" in manifest["arms"]
assert "concise" in manifest["arms"]
assert manifest["arms"]["baseline"]["script_sha256"]
PY
# The ready stamp must match the arm file or run_bench refuses to start.
baseline_sha=$(sha256_file arms/baseline.sh)
[[ $(cat .arms/baseline/.bench-ready) == "$baseline_sha" ]]

printf '== dry-run grades the injected t1 bug without calling claude\n'
sentinel=$(mktemp)
(
  export CLAUDE_SENTINEL=$sentinel
  export PATH="$ROOT/testdata/bin:$PATH"
  unset ANTHROPIC_API_KEY
  ./run_bench.sh --dry-run --fresh
)
if [[ -s $sentinel ]]; then
  printf '%s\n' "dry-run invoked claude" >&2
  exit 1
fi
rm -f "$sentinel"
python3 - <<'PY'
import json
from pathlib import Path
rows = [json.loads(line) for line in Path("results/dry-run.jsonl").read_text().splitlines() if line.strip()]
assert len(rows) == 1, len(rows)
row = rows[0]
assert row["dry_run"] is True
assert row["synthetic"] is False
assert row["pilot"] is False
assert row["arm"] == "baseline"
assert row["task"] == "t1-intrange"
assert row["rep"] == 1
assert row["grade"] == "FAIL:suite"
assert row["pass"] is False
assert row["target_commit"] == "8b19813f2bfca99f1018a587a8cf54fc959f2e5d"
assert row["schema"] == 1
assert row["backend"] == "anthropic"
assert row["quick"] is False
assert row["ollama_base_url"] is None
assert "claude_version" in row
assert row["started_at"] and row["ended_at"]
PY

printf '== local dry-run is tagged and does not call claude\n'
sentinel=$(mktemp)
(
  export CLAUDE_SENTINEL=$sentinel
  export PATH="$ROOT/testdata/bin:$PATH"
  unset ANTHROPIC_API_KEY
  ./run_bench.sh --dry-run --fresh --ollama qwen3-coder
)
if [[ -s $sentinel ]]; then
  printf '%s\n' "local dry-run invoked claude" >&2
  exit 1
fi
rm -f "$sentinel"
python3 - <<'PY'
import json
from pathlib import Path
rows = [json.loads(line) for line in Path("results/local.jsonl").read_text().splitlines() if line.strip()]
assert len(rows) == 1, len(rows)
row = rows[0]
assert row["dry_run"] is True
assert row["backend"] == "local"
assert row["model"] == "qwen3-coder"
assert row["quick"] is False
assert row["ollama_base_url"] == "http://127.0.0.1:11434"
assert row["arm"] == "baseline"
assert row["task"] == "t1-intrange"
assert row["grade"] == "FAIL:suite"
PY

printf '== graders\n'
./check_graders.sh

printf 'checks ok\n'
