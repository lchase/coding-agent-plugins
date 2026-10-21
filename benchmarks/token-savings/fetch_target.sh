#!/usr/bin/env bash
# Clone pallets/click at the pinned 8.5.0 commit, or check the cache already matches.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
source "$ROOT/lib.sh"
ensure_target
printf 'click %s\n' "$TARGET_TAG"
printf 'commit %s\n' "$TARGET_COMMIT"
printf 'tree %s\n' "$TARGET_TREE"
printf 'cache %s\n' "$CACHE"
