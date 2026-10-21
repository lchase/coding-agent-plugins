# shellcheck shell=bash
# shellcheck disable=SC2034
# Headroom proxy (PyPI project headroom-ai, import name headroom).
# The PyPI project named headroom is a different program. Do not install that one.
# Install and launch, from the Headroom docs checked on 2026-10-18:
#   pip install "headroom-ai[proxy]"
#   headroom proxy --port 8787
# run_bench.sh points ANTHROPIC_BASE_URL at the proxy. A custom base URL turns
# off MCP tool search. This benchmark has no MCP servers, so that confound is
# small here and is not small in a session that has MCP servers.
# --ollama also sets ANTHROPIC_BASE_URL. The harness skips this arm in that
# mode: two proxies, and the local server is not an Anthropic bill.
# The proxy is started by you and left running. setup does not background it,
# because a proxy that dies mid-matrix would bill errors and look like a result.

arm_summary="Headroom proxy on 127.0.0.1:8787. Compresses traffic in front of the API. Start the proxy yourself before the run."
arm_homepage="https://github.com/headroomlabs-ai/headroom"

arm_version_commands() {
  printf '%s\n' "headroom --version"
}

arm_setup() {
  command -v headroom >/dev/null 2>&1 || {
    printf '%s\n' 'headroom is not on PATH. Install with: pip install "headroom-ai[proxy]"' >&2
    printf '%s\n' "The PyPI name is headroom-ai. The package named headroom is a different project." >&2
    return 1
  }
  printf '%s\n' "Headroom is installed. Before any headroom session, start: headroom proxy --port ${HEADROOM_PORT:-8787}"
}

arm_check() {
  local port=${HEADROOM_PORT:-8787}
  python3 - "$port" <<'PY'
import sys
import urllib.request
port = sys.argv[1]
url = f"http://127.0.0.1:{port}/health"
try:
    with urllib.request.urlopen(url, timeout=2) as response:
        sys.exit(0 if response.status == 200 else 1)
except Exception:
    sys.stderr.write(
        f"Headroom is not healthy at {url}. Start it with: headroom proxy --port {port}\n"
    )
    sys.exit(1)
PY
}

arm_env() {
  local port=${HEADROOM_PORT:-8787}
  export ANTHROPIC_BASE_URL="http://127.0.0.1:${port}"
}
