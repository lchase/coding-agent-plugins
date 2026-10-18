#!/usr/bin/env bash
# Give every arm a private HOME and run that arm's own install commands.
#   ./setup_arms.sh                 # every arms/*.sh except _*.sh
#   ./setup_arms.sh baseline rtk    # a subset
# Re-running overwrites that arm's settings and refreshes .arms/manifest.json.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$ROOT/lib.sh"

usage() {
  cat <<EOF
Usage: ./setup_arms.sh [arm ...]

With no arguments, set up every arm under arms/ (files starting with _ are templates).
Each arm gets $ARMS_DIR/<id>/ as HOME, CLAUDE_CONFIG_DIR, and the XDG config roots.
Plugin install commands run there, so they do not touch your real ~/.claude.

Reset one arm with: rm -rf $ARMS_DIR/<id> && ./setup_arms.sh <id>
EOF
}

if [[ ${1:-} == -h || ${1:-} == --help ]]; then
  usage
  exit 0
fi

declare -a ids=()
if [[ $# -eq 0 ]]; then
  mapfile -t ids < <(list_arm_ids)
else
  ids=("$@")
fi
((${#ids[@]} > 0)) || die "no arms to set up"

mkdir -p "$ARMS_DIR"
manifest="$ARMS_DIR/manifest.json"

setup_one() {
  local id=$1
  local home file sha ver_tmp
  valid_id "$id" || die "bad arm id: $id"
  file=$(arm_file "$id")
  [[ -f $file ]] || die "no arm file $file"
  home=$(arm_home "$id")
  mkdir -p "$home/.claude" "$home/.config" "$home/.local/share" "$home/.cache"
  printf '== setup %s\n' "$id"
  (
    export ARM_ID="$id"
    export ARM_HOME="$home"
    export HOME="$home"
    export CLAUDE_CONFIG_DIR="$home/.claude"
    export XDG_CONFIG_HOME="$home/.config"
    export XDG_DATA_HOME="$home/.local/share"
    export XDG_CACHE_HOME="$home/.cache"
    load_arm "$id"
    arm_setup
  )
  sha=$(sha256_file "$file")
  printf '%s\n' "$sha" > "$home/.bench-ready"
  ver_tmp=$(mktemp)
  (
    export ARM_ID="$id"
    export ARM_HOME="$home"
    export HOME="$home"
    export CLAUDE_CONFIG_DIR="$home/.claude"
    export XDG_CONFIG_HOME="$home/.config"
    export XDG_DATA_HOME="$home/.local/share"
    export XDG_CACHE_HOME="$home/.cache"
    load_arm "$id"
    while IFS= read -r cmd; do
      [[ -z $cmd ]] && continue
      out=""
      status=ok
      if ! out=$(bash -c "$cmd" 2>&1); then
        status=unavailable
      fi
      one_line=$(printf '%s\n' "$out" | awk 'NR<=8 {printf "%s ", $0}')
      printf '%s\t%s\t%s\n' "$cmd" "$status" "$one_line"
    done < <(arm_version_commands)
  ) > "$ver_tmp"
  local summary homepage
  summary=$(
    load_arm "$id"
    printf '%s' "$arm_summary"
  )
  homepage=$(
    load_arm "$id"
    printf '%s' "$arm_homepage"
  )
  python3 "$ROOT/benchlib.py" manifest \
    --path "$manifest" \
    --arm "$id" \
    --summary "$summary" \
    --homepage "$homepage" \
    --script-sha "$sha" \
    --versions-tsv "$ver_tmp"
  rm -f "$ver_tmp"
  printf 'ready %s\n' "$home"
}

for id in "${ids[@]}"; do
  setup_one "$id"
done

printf 'manifest %s\n' "$manifest"
