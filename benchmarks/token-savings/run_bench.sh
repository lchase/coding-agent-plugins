#!/usr/bin/env bash
# Paired, interleaved Claude Code runs. One JSONL row per session.
#
#   ./run_bench.sh --plan
#   ./run_bench.sh --pilot --yes          # one baseline session, to price the matrix
#   ./run_bench.sh --yes -n 5             # the default matrix
#   ./run_bench.sh --quick --yes          # two tasks, two repeats, Haiku 5.5
#   ./run_bench.sh --ollama qwen3-coder   # local Anthropic-compatible server, no API bill
#   ./run_bench.sh --dry-run              # harness only, claude is not called
#
# A paid run requires --yes. A local --ollama run does not.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$ROOT/lib.sh"

REPS=$DEFAULT_REPS
MODEL=$DEFAULT_MODEL
EFFORT=$DEFAULT_EFFORT
MAX_TURNS=$DEFAULT_MAX_TURNS
MAX_BUDGET=$DEFAULT_MAX_BUDGET_USD
WALL_TIMEOUT=$DEFAULT_WALL_TIMEOUT
ARMS_SEL=""
TASKS_SEL=$TASKS
ARMS_SET=0
TASKS_SET=0
REPS_SET=0
MODEL_SET=0
PILOT=0
YES=0
PLAN=0
DRY=0
FRESH=0
QUICK=0
OLLAMA_SET=0
OLLAMA_MODEL=""
SKIP_HEADROOM=0

usage() {
  cat <<EOF
Usage: ./run_bench.sh [--yes] [--pilot] [--quick] [--plan] [--dry-run] [--fresh]
                      [--ollama MODEL]
                      [-n REPS] [-m MODEL] [-e EFFORT]
                      [-a "arm ..."] [-t "task ..."]
                      [--max-turns N] [--max-budget-usd N] [--wall-timeout SECONDS]

Default matrix: $(echo "$TASKS" | wc -w | tr -d ' ') tasks x every arm under arms/ x $DEFAULT_REPS repeats.
--pilot prices a single baseline session (first task, one repeat) and writes results/pilot.jsonl.
--quick is a cheap paid preset: tasks $QUICK_TASKS, $QUICK_REPS repeats, model $QUICK_MODEL.
  Explicit -n, -m, -a, or -t overrides that one setting. It still requires --yes.
--ollama MODEL points Claude Code at a local Anthropic-compatible server (Ollama v0.14.0+).
  No API key and no --yes. Headroom is skipped, because it is itself a proxy.
  Writes results/local.jsonl. Not a cost or prompt-cache measurement.
--plan prints the matrix and exits. It does not need an API key.
--dry-run prepares a real worktree and grades it, but does not call claude.
--yes is required for any paid run. It is not required for --ollama.
--fresh truncates the destination JSONL before appending.

Each paid session is capped at --max-budget-usd (default $DEFAULT_MAX_BUDGET_USD) and --max-turns (default $DEFAULT_MAX_TURNS).
A local run does not pass --max-budget-usd. Turns and the wall clock still apply.
The wall clock cap defaults to ${DEFAULT_WALL_TIMEOUT}s. Pass --wall-timeout 0 to disable it.
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -n|--reps) REPS=$2; REPS_SET=1; shift 2 ;;
    -m|--model) MODEL=$2; MODEL_SET=1; shift 2 ;;
    -e|--effort) EFFORT=$2; shift 2 ;;
    -a|--arms) ARMS_SEL=$2; ARMS_SET=1; shift 2 ;;
    -t|--tasks) TASKS_SEL=$2; TASKS_SET=1; shift 2 ;;
    --max-turns) MAX_TURNS=$2; shift 2 ;;
    --max-budget-usd) MAX_BUDGET=$2; shift 2 ;;
    --wall-timeout) WALL_TIMEOUT=$2; shift 2 ;;
    --pilot) PILOT=1; shift ;;
    --quick) QUICK=1; shift ;;
    --ollama)
      [[ $# -ge 2 ]] || die "--ollama needs a model name, for example: --ollama qwen3-coder"
      OLLAMA_MODEL=$2
      OLLAMA_SET=1
      shift 2
      ;;
    --yes) YES=1; shift ;;
    --plan) PLAN=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --fresh) FRESH=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
done

[[ $REPS =~ ^[0-9]+$ && $REPS -ge 1 ]] || die "reps must be an integer >= 1"
[[ $MAX_TURNS =~ ^[0-9]+$ && $MAX_TURNS -ge 1 ]] || die "max-turns must be an integer >= 1"
[[ $MAX_BUDGET =~ ^[0-9]+([.][0-9]+)?$ ]] || die "max-budget-usd must be a number"
[[ $WALL_TIMEOUT =~ ^[0-9]+$ ]] || die "wall-timeout must be a whole number of seconds (0 disables it)"

ollama_base_url() {
  local raw=${BENCH_OLLAMA_BASE_URL:-}
  if [[ -z $raw && -n ${OLLAMA_HOST:-} ]]; then
    raw=$OLLAMA_HOST
  fi
  if [[ -z $raw ]]; then
    raw=$DEFAULT_OLLAMA_BASE
  fi
  if [[ $raw != http://* && $raw != https://* ]]; then
    raw="http://${raw}"
  fi
  raw=${raw%/}
  printf '%s\n' "$raw"
}

if [[ $OLLAMA_SET -eq 1 ]]; then
  [[ -n $OLLAMA_MODEL ]] || die "--ollama needs a model name, for example: --ollama qwen3-coder"
  if [[ $MODEL_SET -eq 1 ]]; then
    die "--ollama ${OLLAMA_MODEL} conflicts with -m ${MODEL}. The name after --ollama is the model."
  fi
  MODEL=$OLLAMA_MODEL
fi
if [[ $QUICK -eq 1 && $PILOT -eq 1 ]]; then
  die "--quick and --pilot ask for different matrices. Pick one."
fi
if [[ $QUICK -eq 1 ]]; then
  if [[ $REPS_SET -eq 0 ]]; then
    REPS=$QUICK_REPS
  fi
  if [[ $TASKS_SET -eq 0 ]]; then
    TASKS_SEL=$QUICK_TASKS
    TASKS_SET=1
  fi
  if [[ $MODEL_SET -eq 0 && $OLLAMA_SET -eq 0 ]]; then
    MODEL=$QUICK_MODEL
  fi
fi

if [[ $PILOT -eq 1 ]]; then
  REPS=1
  if [[ $ARMS_SET -eq 0 ]]; then
    ARMS_SEL=baseline
    ARMS_SET=1
  fi
  if [[ $TASKS_SET -eq 0 ]]; then
    TASKS_SEL=${TASKS%% *}
    TASKS_SET=1
  fi
fi

if [[ $DRY -eq 1 && $QUICK -eq 0 && $PILOT -eq 0 && $ARMS_SET -eq 0 && $TASKS_SET -eq 0 && $REPS -eq "$DEFAULT_REPS" ]]; then
  # A bare --dry-run checks one injected bug. Pass -n/-a/-t to widen it.
  REPS=1
  ARMS_SEL=baseline
  ARMS_SET=1
  TASKS_SEL=${TASKS%% *}
  TASKS_SET=1
fi

declare -a ARM_ARR=()
declare -a TASK_ARR=()
if [[ $ARMS_SET -eq 0 ]]; then
  mapfile -t ARM_ARR < <(list_arm_ids)
else
  # shellcheck disable=SC2206
  ARM_ARR=($ARMS_SEL)
fi
# shellcheck disable=SC2206
TASK_ARR=($TASKS_SEL)
((${#ARM_ARR[@]} > 0)) || die "no arms selected"
((${#TASK_ARR[@]} > 0)) || die "no tasks selected"

if [[ $OLLAMA_SET -eq 1 ]]; then
  headroom_selected=0
  for id in "${ARM_ARR[@]}"; do
    if [[ $id == headroom ]]; then
      headroom_selected=1
    fi
  done
  if [[ $headroom_selected -eq 1 && $ARMS_SET -eq 1 ]]; then
    die "headroom is skipped with --ollama. Headroom is itself a proxy: it sets ANTHROPIC_BASE_URL, and a custom base URL disables MCP tool search. Local mode already points that variable at Ollama. Drop headroom from -a."
  fi
  if [[ $headroom_selected -eq 1 ]]; then
    declare -a filtered=()
    for id in "${ARM_ARR[@]}"; do
      if [[ $id == headroom ]]; then
        continue
      fi
      filtered+=("$id")
    done
    ARM_ARR=("${filtered[@]}")
    SKIP_HEADROOM=1
  fi
  ((${#ARM_ARR[@]} > 0)) || die "no arms left after skipping headroom"
fi

for id in "${ARM_ARR[@]}"; do
  valid_id "$id" || die "bad arm id: $id"
  [[ -f $(arm_file "$id") ]] || die "no arm file for $id"
done
for id in "${TASK_ARR[@]}"; do
  valid_id "$id" || die "bad task id: $id"
  [[ -f $ROOT/tasks/$id.md ]] || die "no task prompt: tasks/$id.md"
done

sessions=$(( ${#TASK_ARR[@]} * ${#ARM_ARR[@]} * REPS ))
# Ceiling is sessions times the per-session cap. It is a cap, not an estimate.
ceiling=$(python3 -c 'import sys; print(f"{float(sys.argv[1]) * int(sys.argv[2]):.2f}")' "$MAX_BUDGET" "$sessions")
default_arms=$(list_arm_ids | wc -l | tr -d ' ')
default_tasks=$(wc -w <<< "$TASKS" | tr -d ' ')
default_sessions=$(( default_tasks * default_arms * DEFAULT_REPS ))
default_ceiling=$(python3 -c 'import sys; print(f"{float(sys.argv[1]) * int(sys.argv[2]):.2f}")' "$DEFAULT_MAX_BUDGET_USD" "$default_sessions")

mode=live
if [[ $DRY -eq 1 && $OLLAMA_SET -eq 1 ]]; then
  mode=local-dry-run
elif [[ $DRY -eq 1 ]]; then
  mode=dry-run
elif [[ $OLLAMA_SET -eq 1 && $QUICK -eq 1 ]]; then
  mode=local-quick
elif [[ $OLLAMA_SET -eq 1 ]]; then
  mode=local
elif [[ $PILOT -eq 1 ]]; then
  mode=pilot
elif [[ $QUICK -eq 1 ]]; then
  mode=quick
fi

OLLAMA_BASE=""
BACKEND=anthropic
if [[ $OLLAMA_SET -eq 1 ]]; then
  OLLAMA_BASE=$(ollama_base_url)
  BACKEND=local
fi

print_plan() {
  printf 'mode: %s\n' "$mode"
  if [[ $OLLAMA_SET -eq 1 ]]; then
    printf 'backend: local\n'
    printf 'ollama base: %s\n' "$OLLAMA_BASE"
  else
    printf 'backend: anthropic\n'
  fi
  if [[ $QUICK -eq 1 ]]; then
    printf 'preset: quick\n'
  fi
  printf 'model: %s\n' "$MODEL"
  printf 'effort: %s\n' "$EFFORT"
  printf 'reps: %s\n' "$REPS"
  printf 'tasks (%s): %s\n' "${#TASK_ARR[@]}" "${TASK_ARR[*]}"
  printf 'arms (%s): %s\n' "${#ARM_ARR[@]}" "${ARM_ARR[*]}"
  if [[ $SKIP_HEADROOM -eq 1 ]]; then
    printf 'skipping headroom: it is a proxy, and --ollama already sets ANTHROPIC_BASE_URL. Pass -a without headroom to silence this, or do not combine them.\n'
  fi
  printf 'sessions: %s\n' "$sessions"
  if [[ $OLLAMA_SET -eq 1 ]]; then
    printf 'dollar cap: not applied (local backend, no Anthropic bill)\n'
    printf 'local caveat: harness shake-out and rough raw-token deltas only. Not a cost result. Not a prompt-cache result.\n'
  else
    printf 'per-session cap: $%s\n' "$MAX_BUDGET"
    printf 'hard ceiling for this selection: $%s\n' "$ceiling"
  fi
  if [[ $QUICK -eq 1 && $OLLAMA_SET -eq 0 ]]; then
    printf 'quick check: %s sessions, hard ceiling $%s. Few repeats, so the interval will be wide. This is a check, not proof.\n' \
      "$sessions" "$ceiling"
  fi
  printf 'default full matrix: %s tasks x %s arms x %s reps = %s sessions, ceiling $%s at $%s each\n' \
    "$default_tasks" "$default_arms" "$DEFAULT_REPS" "$default_sessions" "$default_ceiling" "$DEFAULT_MAX_BUDGET_USD"
  printf 'wall timeout per session: %ss\n' "$WALL_TIMEOUT"
  printf 'target: click %s %s\n' "$TARGET_TAG" "$TARGET_COMMIT"
}

print_plan
if [[ $PLAN -eq 1 ]]; then
  exit 0
fi

if [[ $DRY -eq 0 && $OLLAMA_SET -eq 0 && $YES -eq 0 ]]; then
  cat <<EOF >&2

This would call Claude Code ${sessions} time(s) against the Anthropic API. Each call is capped at \$${MAX_BUDGET}, so the hard ceiling is \$${ceiling}.
That ceiling is a cap, not a price. Tasks and arms do not cost the same. Price one session first:

  ./run_bench.sh --pilot --yes

Or run the cheap preset (still billed, still needs --yes):

  ./run_bench.sh --quick --yes

A local model does not use this gate:

  ./run_bench.sh --ollama qwen3-coder

Nothing was sent. No API key was required for this message.
EOF
  exit 2
fi

if [[ $DRY -eq 0 && $OLLAMA_SET -eq 1 ]]; then
  command -v claude >/dev/null 2>&1 || die "claude is not on PATH"
  python3 - "$OLLAMA_BASE" "$MODEL" <<'PY' || die "Ollama health check failed"
import json, sys, urllib.request
base, model = sys.argv[1], sys.argv[2]
url = base + "/api/tags"
try:
    with urllib.request.urlopen(url, timeout=3) as response:
        payload = json.loads(response.read().decode("utf-8"))
except Exception as exc:
    sys.stderr.write(
        f"Ollama is not reachable at {base} ({exc}). Start it with: ollama serve\n"
        "Then pull a model, for example: ollama pull qwen3-coder\n"
        "Override the URL with BENCH_OLLAMA_BASE_URL or OLLAMA_HOST.\n"
        "Connection docs: https://docs.ollama.com/integrations/claude-code\n"
    )
    sys.exit(1)
names = [item.get("name") or "" for item in (payload.get("models") or []) if isinstance(item, dict)]
wanted = {model, model + ":latest"}
if model.endswith(":latest"):
    wanted.add(model[: -len(":latest")])
if not any(name in wanted for name in names):
    listed = ", ".join(names) if names else "(none)"
    sys.stderr.write(
        f"Ollama at {base} does not list {model}. Pulled models: {listed}\n"
        f"Pull it with: ollama pull {model}\n"
    )
    sys.exit(1)
PY
fi

if [[ $DRY -eq 0 && $OLLAMA_SET -eq 0 ]]; then
  [[ -n ${ANTHROPIC_API_KEY:-} ]] || die "ANTHROPIC_API_KEY is required. An API key makes total_cost_usd list price and the prompt-cache TTL 5 minutes. A subscription run is a different measurement."
  command -v claude >/dev/null 2>&1 || die "claude is not on PATH"
fi

if [[ $OLLAMA_SET -eq 1 ]]; then
  out_jsonl="$RESULTS/local.jsonl"
elif [[ $DRY -eq 1 ]]; then
  out_jsonl="$RESULTS/dry-run.jsonl"
elif [[ $PILOT -eq 1 ]]; then
  out_jsonl="$RESULTS/pilot.jsonl"
elif [[ $QUICK -eq 1 ]]; then
  out_jsonl="$RESULTS/quick.jsonl"
else
  out_jsonl="$RESULTS/runs.jsonl"
fi
mkdir -p "$RESULTS/raw"
if [[ $FRESH -eq 1 ]]; then
  : > "$out_jsonl"
fi
existing=0
if [[ -f $out_jsonl ]]; then
  existing=$(grep -c . "$out_jsonl" || true)
fi
if [[ $existing -gt 0 ]]; then
  printf 'appending to %s (%s existing rows)\n' "$out_jsonl" "$existing" >&2
fi

claude_version=dry-run
if [[ $DRY -eq 0 ]]; then
  claude_version=$(claude --version 2>&1 | awk 'NR==1 {print; exit}') || claude_version=unknown
fi

bench_rev=unknown
if bench_rev=$(git -C "$ROOT" rev-parse HEAD 2>/dev/null); then
  :
else
  bench_rev=unknown
fi
bench_dirty=0
if [[ -n $(git -C "$ROOT" status --porcelain -- "$ROOT" 2>/dev/null || true) ]]; then
  bench_dirty=1
fi

tool_versions_for() {
  local id=$1
  local manifest=$ARMS_DIR/manifest.json
  if [[ ! -f $manifest ]]; then
    printf '%s\n' "{}"
    return 0
  fi
  python3 - "$manifest" "$id" <<'PY'
import json, sys
data = json.loads(open(sys.argv[1], encoding="utf-8").read() or "{}")
arm = (data.get("arms") or {}).get(sys.argv[2]) or {}
print(json.dumps(arm.get("tool_versions") or {}))
PY
}

require_ready() {
  local id=$1
  local home ready sha
  if [[ $DRY -eq 1 ]]; then
    return 0
  fi
  home=$(arm_home "$id")
  ready=$home/.bench-ready
  [[ -f $ready ]] || die "arm $id is not set up. Run: ./setup_arms.sh $id"
  sha=$(sha256_file "$(arm_file "$id")")
  [[ $(cat "$ready") == "$sha" ]] || die "arms/$id.sh changed since setup. Run: ./setup_arms.sh $id"
}

for id in "${ARM_ARR[@]}"; do
  require_ready "$id"
done

joined_arms=$(IFS=,; printf '%s' "${ARM_ARR[*]}")
joined_tasks=$(IFS=,; printf '%s' "${TASK_ARR[*]}")

run_one() {
  local task=$1 arm=$2 rep=$3 seed=$4 order_csv=$5 order_index=$6
  local wd="" raw err t0 t1 started ended status grade home
  cleanup_wd() {
    if [[ -n ${wd:-} && -d ${wd:-} ]]; then
      rm -rf "$wd"
    fi
  }
  trap cleanup_wd RETURN
  wd=$(make_workdir "$task")
  raw_prefix=""
  if [[ $OLLAMA_SET -eq 1 ]]; then
    raw_prefix="local-"
  fi
  if [[ $DRY -eq 1 ]]; then
    raw_prefix="${raw_prefix}dry-"
  elif [[ $PILOT -eq 1 ]]; then
    raw_prefix="${raw_prefix}pilot-"
  elif [[ $QUICK -eq 1 && $OLLAMA_SET -eq 0 ]]; then
    raw_prefix="${raw_prefix}quick-"
  fi
  raw="$RESULTS/raw/${raw_prefix}${task}.${arm}.${rep}.json"
  err="${raw}.err"
  mkdir -p "$RESULTS/raw"
  home=$(arm_home "$arm")
  t0=$(python3 -c 'import time; print(f"{time.time():.3f}")')
  started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  status=0
  set +e
  (
    export ARM_ID="$arm"
    export ARM_HOME="$home"
    export HOME="$home"
    export CLAUDE_CONFIG_DIR="$home/.claude"
    export XDG_CONFIG_HOME="$home/.config"
    export XDG_DATA_HOME="$home/.local/share"
    export XDG_CACHE_HOME="$home/.cache"
    export PATH="$wd/.venv/bin:${PATH}"
    cd "$wd"
    load_arm "$arm"
    if ! arm_check; then
      printf 'arm_check failed\n' >&2
      exit 86
    fi
    arm_env
    if [[ $OLLAMA_SET -eq 1 ]]; then
      # Official Ollama connection (v0.14.0+): base URL, ignored token, empty API key.
      # Tier variables keep an internal sonnet/haiku/opus request on this model.
      # Set after arm_env so a plugin cannot point the session back at Anthropic.
      export ANTHROPIC_BASE_URL="$OLLAMA_BASE"
      export ANTHROPIC_AUTH_TOKEN=ollama
      export ANTHROPIC_API_KEY=
      export ANTHROPIC_DEFAULT_SONNET_MODEL="$MODEL"
      export ANTHROPIC_DEFAULT_HAIKU_MODEL="$MODEL"
      export ANTHROPIC_DEFAULT_OPUS_MODEL="$MODEL"
    fi
    if [[ $DRY -eq 1 ]]; then
      python3 -c 'import json,sys; json.dump({"dry_run": True, "total_cost_usd": 0, "num_turns": 0, "is_error": False, "usage": {"input_tokens": 0, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 0}, "result": "dry-run: claude was not invoked"}, sys.stdout)'
      exit 0
    fi
    prompt=$(<"$ROOT/tasks/$task.md")
    cmd=(claude -p "$prompt"
      --model "$MODEL"
      --effort "$EFFORT"
      --output-format json
      --no-session-persistence
      --permission-mode bypassPermissions
      --max-turns "$MAX_TURNS")
    if [[ $OLLAMA_SET -eq 0 ]]; then
      cmd+=(--max-budget-usd "$MAX_BUDGET")
    fi
    if [[ $WALL_TIMEOUT != 0 ]] && command -v timeout >/dev/null 2>&1; then
      cmd=(timeout --signal=TERM "$WALL_TIMEOUT" "${cmd[@]}")
    fi
    "${cmd[@]}"
  ) >"$raw" 2>"$err"
  status=$?
  set -e
  t1=$(python3 -c 'import time; print(f"{time.time():.3f}")')
  ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  grade=$("$ROOT/grade.sh" "$task" "$wd")
  rm -rf "$wd"
  wd=""

  timed_out=0
  arm_check_failed=0
  if [[ $status -eq 124 ]]; then
    timed_out=1
  fi
  if [[ $status -eq 86 ]]; then
    arm_check_failed=1
  fi
  tool_json=$(tool_versions_for "$arm")
  BENCH_TASK="$task" \
  BENCH_ARM="$arm" \
  BENCH_REP="$rep" \
  BENCH_GRADE="$grade" \
  BENCH_MODEL="$MODEL" \
  BENCH_EFFORT="$EFFORT" \
  BENCH_STARTED_AT="$started" \
  BENCH_ENDED_AT="$ended" \
  BENCH_T0="$t0" \
  BENCH_T1="$t1" \
  BENCH_EXIT_CODE="$status" \
  BENCH_BACKEND="$BACKEND" \
  BENCH_QUICK="$QUICK" \
  BENCH_OLLAMA_BASE="$OLLAMA_BASE" \
  BENCH_DRY_RUN="$DRY" \
  BENCH_PILOT="$PILOT" \
  BENCH_TIMED_OUT="$timed_out" \
  BENCH_ARM_CHECK_FAILED="$arm_check_failed" \
  BENCH_REV="$bench_rev" \
  BENCH_DIRTY="$bench_dirty" \
  BENCH_CLAUDE_VERSION="$claude_version" \
  BENCH_ARM_SHA="$(sha256_file "$(arm_file "$arm")")" \
  BENCH_TASK_SHA="$(sha256_file "$ROOT/tasks/$task.md")" \
  BENCH_ARM_ORDER="$order_csv" \
  BENCH_ORDER_INDEX="$order_index" \
  BENCH_SHUFFLE_SEED="$seed" \
  BENCH_MAX_TURNS="$MAX_TURNS" \
  BENCH_MAX_BUDGET="$MAX_BUDGET" \
  BENCH_WALL_TIMEOUT="$WALL_TIMEOUT" \
  BENCH_SELECTED_REPS="$REPS" \
  BENCH_SELECTED_TASKS="$joined_tasks" \
  BENCH_SELECTED_ARMS="$joined_arms" \
  BENCH_TOOL_VERSIONS="$tool_json" \
  BENCH_TARGET_URL="$TARGET_URL" \
  BENCH_TARGET_TAG="$TARGET_TAG" \
  BENCH_TARGET_COMMIT="$TARGET_COMMIT" \
  BENCH_TARGET_TREE="$TARGET_TREE" \
  BENCH_RUNNER="${BENCH_RUNNER:-}" \
  python3 "$ROOT/record_run.py" --from-env --raw "$raw" --stderr "$err" --append "$out_jsonl"
}

for ((rep = 1; rep <= REPS; rep++)); do
  for task in "${TASK_ARR[@]}"; do
    seed=$(python3 -c 'import random; print(random.SystemRandom().randrange(2**31))')
    mapfile -t order < <(shuffle_lines "$seed" "${ARM_ARR[@]}")
    order_csv=$(IFS=,; printf '%s' "${order[*]}")
    index=0
    for arm in "${order[@]}"; do
      run_one "$task" "$arm" "$rep" "$seed" "$order_csv" "$index"
      index=$((index + 1))
    done
  done
done

printf 'wrote %s\n' "$out_jsonl"
analyze=(python3 "$ROOT/analyze.py" "$out_jsonl" -o "${out_jsonl%.jsonl}.summary.md")
if [[ $DRY -eq 1 ]]; then
  analyze+=(--allow-dry-run)
fi
"${analyze[@]}"
