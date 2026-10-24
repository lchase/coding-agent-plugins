#!/usr/bin/env bash
# Checks every per-harness manifest: valid JSON, matching version, resolvable paths,
# and a marketplace entry. Gemini is root-scoped (GEMINI.md); it has no manifest here.
# Run before pushing. Requires: python3.

set -euo pipefail
cd "$(dirname "$0")/.."

manifests=(
  .claude-plugin/plugin.json
  .cursor-plugin/plugin.json
  .codex-plugin/plugin.json
)

fail=0
ref_version=""

for m in "${manifests[@]}"; do
  if [ ! -f "$m" ]; then
    echo "MISSING  $m"; fail=1; continue
  fi
  if ! python3 -c "import json,sys; json.load(open('$m'))" 2>/dev/null; then
    echo "BAD JSON $m"; fail=1; continue
  fi
  v=$(python3 -c "import json; print(json.load(open('$m')).get('version',''))")
  if [ -z "$ref_version" ]; then
    ref_version="$v"
  elif [ "$v" != "$ref_version" ]; then
    echo "VERSION  $m has '$v', expected '$ref_version'"; fail=1
  fi
  s=$(python3 -c "import json; print(json.load(open('$m')).get('skills',''))")
  if [ -n "$s" ] && [ ! -d "$s" ]; then
    echo "PATH     $m skills='$s' does not resolve"; fail=1
  fi
  echo "OK       $m (v$v)"
done

if [ ! -f skills/show-evidence/SKILL.md ]; then
  echo "MISSING  skills/show-evidence/SKILL.md"; fail=1
fi

mkt=$(python3 -c "
import json
d = json.load(open('../../.claude-plugin/marketplace.json'))
e = next((p for p in d['plugins'] if p['name'] == 'show-evidence'), None)
print('yes' if e else 'no')
" 2>/dev/null || echo "no")
if [ "$mkt" != "yes" ]; then
  echo "MISSING  marketplace.json has no show-evidence entry"; fail=1
else
  echo "OK       marketplace.json entry"
fi

if [ "$fail" -eq 0 ]; then
  echo "all adapters consistent"
else
  echo "adapter validation FAILED" >&2
fi
exit $fail
