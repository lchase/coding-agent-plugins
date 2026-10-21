#!/usr/bin/env bash
# Same follow-up, twice: once while the prompt cache is warm, once after the 5-minute TTL.
# Turn 1 reads two large files (a cold write). Turn 2 says OK (cache reads). After the wait,
# turn 3 says OK again and should be a cache write. Same bytes, different clock.
# This spends API money and sleeps for more than 5 minutes. Pre-record it.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=SCRIPTDIR/../lib.sh
source "$ROOT/lib.sh"

WAIT=${WAIT:-330}
MODEL=${MODEL:-sonnet}

if [[ ${1:-} != --yes ]]; then
  cat <<EOF >&2
This demo calls Claude three times and then sleeps ${WAIT}s. It spends API money.
Set ANTHROPIC_API_KEY and re-run with --yes.
FORCE_PROMPT_CACHING_5M=1 is set so a subscription account uses the 5-minute TTL too.
EOF
  exit 2
fi
[[ -n ${ANTHROPIC_API_KEY:-} ]] || die "ANTHROPIC_API_KEY is required"
command -v claude >/dev/null 2>&1 || die "claude is not on PATH"
ensure_target
export FORCE_PROMPT_CACHING_5M=1
cd "$CACHE"

show() {
  local label=$1
  local payload=$2
  python3 -c 'import json,sys
label, raw = sys.argv[1], sys.argv[2]
r = json.loads(raw)
u = r.get("usage") or {}
c = u.get("cache_creation") or {}
print(f"{label}\tfresh={u.get(\"input_tokens\")}\tcache_write={u.get(\"cache_creation_input_tokens\")}\tcache_read={u.get(\"cache_read_input_tokens\")}\tout={u.get(\"output_tokens\")}\tcost=${r.get(\"total_cost_usd\")}\t5m/1h={c.get(\"ephemeral_5m_input_tokens\",\"?\")}/{c.get(\"ephemeral_1h_input_tokens\",\"?\")}")' \
    "$label" "$payload"
}

r1=$(claude -p "Read src/click/core.py and src/click/types.py fully, then reply only: READY" --model "$MODEL" --output-format json --allowedTools Read)
sid=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("session_id") or "")' "$r1")
[[ -n $sid ]] || die "turn 1 did not return a session_id"
show "turn1 cold" "$r1"
r2=$(claude -p "Reply only: OK" --resume "$sid" --model "$MODEL" --output-format json)
show "turn2 warm" "$r2"
printf 'sleeping %ss so the 5-minute cache entry expires\n' "$WAIT"
sleep "$WAIT"
r3=$(claude -p "Reply only: OK" --resume "$sid" --model "$MODEL" --output-format json)
show "turn3 cold" "$r3"
printf '\nTurn 2 and turn 3 sent the same bytes. The clock is the difference.\n'
printf 'Expected shape: turn 2 is mostly cache_read; turn 3 is mostly cache_write.\n'
