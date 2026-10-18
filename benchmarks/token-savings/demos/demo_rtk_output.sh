#!/usr/bin/env bash
# What RTK shrinks: pytest bytes on the noisy parser bug. This does not call Claude.
# It needs the rtk binary on PATH. A missing binary is an error, not a zero.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=SCRIPTDIR/../lib.sh
source "$ROOT/lib.sh"

command -v rtk >/dev/null 2>&1 || die "rtk is not on PATH. Install the Token Killer from https://github.com/rtk-ai/rtk"
wd=$(make_workdir t2-splitopt)
cleanup() { rm -rf "$wd"; }
trap cleanup EXIT
cd "$wd"
raw=$(.venv/bin/python -m pytest -q -k "$PYTEST_K" 2>&1 | wc -c || true)
cmp=$(PATH="$wd/.venv/bin:$PATH" rtk pytest -q -k "$PYTEST_K" 2>&1 | wc -c || true)
printf 'pytest raw: %s bytes (about %s tokens by RTK bytes/4)\n' "$raw" $((raw / 4))
printf 'rtk pytest: %s bytes (about %s tokens by RTK bytes/4)\n' "$cmp" $((cmp / 4))
printf 'That output is written into the cache once and re-read on later turns at the cache-read price.\n'
printf 'Byte counts are not the bill. The benchmark JSONL is the bill.\n'
