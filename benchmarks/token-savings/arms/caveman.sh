# shellcheck shell=bash
# shellcheck disable=SC2034
# Caveman (JuliusBrussee/caveman), terse output style, default level.
# Install lines checked against the upstream README on 2026-10-18.
# This is the default plugin, not ultra mode and not the input proxy.
# The plugin loads its rules every session. That is the arm.

arm_summary="Caveman plugin at its default level. Terse replies. Not ultra mode and not the input proxy."
arm_homepage="https://github.com/JuliusBrussee/caveman"

arm_version_commands() {
  printf '%s\n' "claude plugin details caveman"
}

arm_setup() {
  command -v claude >/dev/null 2>&1 || {
    printf '%s\n' "claude is not on PATH" >&2
    return 1
  }
  claude_marketplace_add JuliusBrussee/caveman
  claude_plugin_install caveman@caveman
}

arm_check() {
  return 0
}

arm_env() {
  :
}
