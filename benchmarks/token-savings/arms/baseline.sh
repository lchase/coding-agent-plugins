# shellcheck shell=bash
# shellcheck disable=SC2034
# Stock Claude Code. No plugin, no output-style override.
# Every other arm is a paired comparison against this one.

arm_summary="Stock Claude Code. No token-saving plugin and no output-style override."
arm_homepage=""

arm_version_commands() {
  :
}

arm_setup() {
  printf '%s\n' '{}' > "$ARM_HOME/.claude/settings.json"
}

arm_check() {
  return 0
}

arm_env() {
  :
}
