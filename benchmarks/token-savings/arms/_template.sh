# shellcheck shell=bash
# shellcheck disable=SC2034
# Template for a new arm. Copy to arms/<id>.sh (lowercase, digits, hyphens).
# The id is the filename. Files whose names start with _ are not arms.
# This file is sourced. Do not run commands at the top level.
#
#   cp arms/_template.sh arms/my-plugin.sh
#   # edit the functions
#   ./setup_arms.sh my-plugin
#   ./run_bench.sh --plan
#   ./run_bench.sh --yes -a "baseline my-plugin" -n 3 -t "t1-intrange"
#
# setup_arms.sh exports ARM_HOME, ARM_ID, HOME, CLAUDE_CONFIG_DIR, and the
# XDG roots before calling arm_setup. Re-running setup must be safe.
# arm_check runs before every session. Return non-zero to skip the call
# (the row is still recorded, with arm_check_failed).
# arm_env may export variables for the claude process. Leave ANTHROPIC_API_KEY alone.

arm_summary="One line: what this arm changes relative to stock Claude Code."
arm_homepage="https://example.com/your-plugin"

arm_version_commands() {
  printf '%s\n' "my-plugin --version"
}

arm_setup() {
  command -v my-plugin >/dev/null 2>&1 || {
    printf '%s\n' "my-plugin is not on PATH" >&2
    return 1
  }
  # Prefer the project's documented non-interactive install.
  # claude_marketplace_add owner/repo
  # claude_plugin_install name@marketplace
  :
}

arm_check() {
  return 0
}

arm_env() {
  :
}
