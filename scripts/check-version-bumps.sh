#!/usr/bin/env bash
# Fails if a plugin's files changed against the merge-base with BASE (default origin/main) without a
# version change in its .claude-plugin/plugin.json. Dev-only evals are exempt.

set -euo pipefail
cd "$(dirname "$0")/.."
base="$(git merge-base "${1:-origin/main}" HEAD)"
fail=0

for dir in plugins/*/; do
  p="${dir%/}"
  manifest="$p/.claude-plugin/plugin.json"
  [ -f "$manifest" ] || continue
  changed=$(git diff --name-only "$base" HEAD -- "$p" ":(exclude)$p/evals" || true)
  [ -n "$changed" ] || continue
  old=$(git show "$base:$manifest" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' || true)
  new=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("version",""))' "$manifest")
  if [ -n "$old" ] && [ "$old" = "$new" ]; then
    echo "NO BUMP  $p changed but version is still $new (edit $manifest)"; fail=1
  else
    echo "OK       $p ${old:-new} -> $new"
  fi
done
exit "$fail"
