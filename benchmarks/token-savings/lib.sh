#!/usr/bin/env bash
# Shared helpers. Sourced, not executed.
# shellcheck shell=bash

_lib_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$_lib_dir
# shellcheck source=pins.sh
source "$ROOT/pins.sh"

CACHE="$ROOT/.cache/click"
TOOL_VENV="$ROOT/.cache/tool-venv"
ARMS_DIR="$ROOT/.arms"
# shellcheck disable=SC2034
RESULTS="$ROOT/results"

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

arm_file() {
  printf '%s\n' "$ROOT/arms/$1.sh"
}

valid_id() {
  [[ "$1" =~ ^[a-z0-9][a-z0-9-]*$ ]]
}

list_arm_ids() {
  local f base id
  local -a rest=()
  for f in "$ROOT/arms/"*.sh; do
    [[ -e $f ]] || continue
    base=$(basename "$f")
    [[ $base == _* ]] && continue
    id=${base%.sh}
    valid_id "$id" || die "arm file $base: id must match [a-z0-9][a-z0-9-]*"
    if [[ $id == baseline || $id == concise ]]; then
      continue
    fi
    rest+=("$id")
  done
  [[ -f $ROOT/arms/baseline.sh ]] && printf '%s\n' baseline
  [[ -f $ROOT/arms/concise.sh ]] && printf '%s\n' concise
  if ((${#rest[@]} > 0)); then
    printf '%s\n' "${rest[@]}" | sort
  fi
}

# Reset the arm hooks, then source arms/<id>.sh. Functions leak into the caller
# on purpose; call this from a subshell when that matters.
load_arm() {
  local id=$1
  local file
  file=$(arm_file "$id")
  [[ -f $file ]] || die "unknown arm: $id"
  arm_summary=""
  # shellcheck disable=SC2034
  arm_homepage=""
  arm_setup() { :; }
  arm_check() { return 0; }
  arm_env() { :; }
  arm_version_commands() { :; }
  # shellcheck disable=SC1090
  source "$file"
  [[ -n $arm_summary ]] || die "arm $id: set arm_summary"
}

arm_home() {
  printf '%s\n' "$ARMS_DIR/$1"
}

# Marketplace and plugin installs fail the second time with "already exists".
# Treat that as success. Any other failure is a real failure.
claude_marketplace_add() {
  local repo=$1
  local out
  if out=$(claude plugin marketplace add "$repo" 2>&1); then
    printf '%s\n' "$out"
    return 0
  fi
  if printf '%s\n' "$out" | grep -Eiq 'already|exists'; then
    printf '%s\n' "$out"
    return 0
  fi
  printf '%s\n' "$out" >&2
  return 1
}

claude_plugin_install() {
  local plugin=$1
  local out
  if out=$(claude plugin install "$plugin" 2>&1); then
    printf '%s\n' "$out"
    return 0
  fi
  if printf '%s\n' "$out" | grep -Eiq 'already|exists|installed'; then
    printf '%s\n' "$out"
    return 0
  fi
  printf '%s\n' "$out" >&2
  return 1
}

ensure_target() {
  if [[ ! -d $CACHE/.git ]]; then
    mkdir -p "$ROOT/.cache"
    git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$TARGET_TAG" "$TARGET_URL" "$CACHE"
  fi
  local head tree
  head=$(git -C "$CACHE" rev-parse HEAD)
  tree=$(git -C "$CACHE" rev-parse 'HEAD^{tree}')
  [[ $head == "$TARGET_COMMIT" ]] || die "cached click HEAD is $head, pin is $TARGET_COMMIT. Remove $CACHE and run fetch_target.sh again."
  [[ $tree == "$TARGET_TREE" ]] || die "cached click tree is $tree, pin is $TARGET_TREE. Remove $CACHE and run fetch_target.sh again."
}

ensure_tool_venv() {
  ensure_target
  local py_ver pin_file pin_now
  py_ver=$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')
  pin_file="$TOOL_VENV/PIN"
  pin_now="${TARGET_COMMIT} ${py_ver}"
  if [[ -x $TOOL_VENV/bin/python && -f $pin_file ]] && [[ $(cat "$pin_file") == "$pin_now" ]]; then
    return 0
  fi
  printf 'building pytest venv for click %s (once per pin and Python version)\n' "$TARGET_TAG" >&2
  rm -rf "$TOOL_VENV"
  python3 -m venv "$TOOL_VENV" || die "python3 -m venv failed. On Debian or Ubuntu install python3-venv."
  "$TOOL_VENV/bin/python" -m pip install --disable-pip-version-check -q "$CACHE" pytest \
    || die "pip install of click and pytest failed"
  printf '%s\n' "$pin_now" > "$pin_file"
}

# Fresh click checkout plus a private venv. The venv imports this workdir's
# src/click (a .pth file) and keeps pytest plus the pinned distribution
# metadata in a copy of site-packages, so one run cannot edit the next run's
# environment. Prints the workdir path on stdout.
#
# The copy is local and self-contained: no --shared alternate, no origin URL.
# A path back to .cache would also be a path back to hidden/. The task patch
# is amended into the only commit. A shallow clone has no parent object, so
# `git show` cannot print the injection as a one-line diff.
make_workdir() {
  local task=$1
  local wd pure tool_site head
  ensure_tool_venv
  printf 'preparing %s\n' "$task" >&2
  wd=$(mktemp -d "${TMPDIR:-/tmp}/token-savings.XXXXXX")
  case $wd in
    "$ROOT"|"$ROOT"/*)
      rm -rf "$wd"
      die "refusing to place a workdir inside the benchmark tree (TMPDIR=$TMPDIR)"
      ;;
  esac
  if ! git -c advice.detachedHead=false clone --quiet --branch "$TARGET_TAG" "$CACHE" "$wd"; then
    rm -rf "$wd"
    die "could not clone the click cache into a workdir"
  fi
  git -C "$wd" remote remove origin 2>/dev/null || true
  head=$(git -C "$wd" rev-parse HEAD)
  if [[ $head != "$TARGET_COMMIT" ]]; then
    rm -rf "$wd"
    die "workdir HEAD is $head, pin is $TARGET_COMMIT"
  fi
  if [[ -f $ROOT/patches/$task.patch ]]; then
    if ! git -C "$wd" apply --whitespace=nowarn "$ROOT/patches/$task.patch"; then
      rm -rf "$wd"
      die "patch $ROOT/patches/$task.patch did not apply"
    fi
    if ! git -C "$wd" \
      -c user.email=bench@localhost \
      -c user.name='token-savings bench' \
      -c commit.gpgsign=false \
      commit -q --amend --no-edit -a; then
      rm -rf "$wd"
      die "could not fold the task patch into the workdir commit"
    fi
  fi
  if ! python3 -m venv --without-pip "$wd/.venv"; then
    rm -rf "$wd"
    die "could not create a workdir venv"
  fi
  pure=$("$wd/.venv/bin/python" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
  tool_site=$("$TOOL_VENV/bin/python" -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
  cp -a "$tool_site/." "$pure/"
  rm -rf "$pure/click"
  # pip records the local checkout path. That path sits inside this repo.
  rm -f "$pure"/click-*.dist-info/direct_url.json
  # Bytecode records the path it was compiled from. The tool venv lives under
  # this repo, so those .pyc files would point at .cache/.
  find "$pure" -type d -name '__pycache__' -prune -exec rm -rf {} +
  # git records "clone: from <cache>" in the reflog. The cache is inside this repo.
  rm -rf "$wd/.git/logs"
  printf '%s\n' "$wd/src" > "$pure/aaa_workdir_src.pth"
  if workdir_leaks_bench "$wd"; then
    rm -rf "$wd"
    die "workdir still contains the benchmark path"
  fi
  printf '%s\n' "$wd"
}

# True when git metadata or the venv names this benchmark directory.
# The task prompt never does. The workdir must not do it either.
workdir_leaks_bench() {
  local wd=$1
  grep -R -I -F -q -- "$ROOT" "$wd/.git" "$wd/.venv" 2>/dev/null
}

shuffle_lines() {
  local seed=$1
  shift
  python3 - "$seed" "$@" <<'PY'
import random
import sys
seed = int(sys.argv[1])
items = sys.argv[2:]
random.Random(seed).shuffle(items)
print("\n".join(items))
PY
}
