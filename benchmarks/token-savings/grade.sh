#!/usr/bin/env bash
# grade.sh <task_id> <workdir>
# Prints PASS or FAIL:<reason>. Exits 0 either way so a failing grade is data, not a crash.
# Hidden fixtures stay in hidden/ and are copied to a temp file only while scoring.
set -u
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$ROOT/lib.sh"

if [[ $# -ne 2 ]]; then
  printf '%s\n' "FAIL:usage"
  exit 0
fi

task=$1
wd=$2
hidden_dir=""
cleanup() {
  if [[ -n $hidden_dir ]]; then
    rm -rf "$hidden_dir"
  fi
}
trap cleanup EXIT

if [[ ! -d $wd ]]; then
  printf '%s\n' "FAIL:nowd"
  exit 0
fi
cd "$wd" || {
  printf '%s\n' "FAIL:nowd"
  exit 0
}

py="$wd/.venv/bin/python"
if [[ ! -x $py ]]; then
  printf '%s\n' "FAIL:no_venv"
  exit 0
fi
if [[ ! -d $CACHE/.git ]]; then
  printf '%s\n' "FAIL:no_pin"
  exit 0
fi

# Compare against the pinned cache, not HEAD. An agent that commits or amends
# still shows up. Untracked files under the path count too.
tree_dirty() {
  local path=$1
  local pinned head
  pinned=$(git -C "$CACHE" rev-parse "$TARGET_COMMIT:$path" 2>/dev/null) || return 0
  head=$(git -C "$wd" rev-parse "HEAD:$path" 2>/dev/null) || return 0
  [[ $pinned == "$head" ]] || return 0
  git -C "$wd" diff --quiet HEAD -- "$path" || return 0
  [[ -z $(git -C "$wd" status --porcelain -- "$path") ]] || return 0
  return 1
}

suite() {
  local log=$wd/.venv/grade-pytest.log
  "$py" -m pytest -q -k "$PYTEST_K" -p no:cacheprovider --tb=line >"$log" 2>&1
}

case_result() {
  printf '%s\n' "$1"
  exit 0
}

if tree_dirty tests; then
  case_result "FAIL:tests_modified"
fi

case "$task" in
  t1-intrange|t2-splitopt)
    if suite; then
      case_result PASS
    fi
    case_result "FAIL:suite"
    ;;
  t3-explain)
    if tree_dirty src; then
      case_result "FAIL:src_modified"
    fi
    if [[ ! -f ANSWER.md ]]; then
      case_result "FAIL:no_answer"
    fi
    miss=""
    keyword=""
    for keyword in consume_value value_from_envvar lookup_default get_default ParameterSource; do
      if ! grep -q -F -- "$keyword" ANSWER.md; then
        miss="${miss},${keyword}"
      fi
    done
    if [[ -z $miss ]]; then
      case_result PASS
    fi
    case_result "FAIL:missing${miss}"
    ;;
  t4-pluralize)
    if ! grep -q 'def pluralize(' src/click/utils.py; then
      case_result "FAIL:not_in_utils"
    fi
    if ! grep -q 'pluralize' src/click/__init__.py; then
      case_result "FAIL:not_exported"
    fi
    # A hyphen in the filename is not a valid module name, and pytest imports the file.
    hidden_dir=$(mktemp -d "${TMPDIR:-/tmp}/tokensavings.XXXXXX")
    hidden_tmp="$hidden_dir/test_t4_pluralize.py"
    cp "$ROOT/hidden/test_t4_pluralize.py" "$hidden_tmp"
    log=$wd/.venv/grade-hidden.log
    if ! "$py" -m pytest -q -p no:cacheprovider --tb=line "$hidden_tmp" >"$log" 2>&1; then
      case_result "FAIL:hidden"
    fi
    if suite; then
      case_result PASS
    fi
    case_result "FAIL:suite"
    ;;
  *)
    case_result "FAIL:unknown_task"
    ;;
esac
