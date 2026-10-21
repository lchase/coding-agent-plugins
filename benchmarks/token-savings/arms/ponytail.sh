# shellcheck shell=bash
# shellcheck disable=SC2034
# Ponytail (DietrichGebert/ponytail), YAGNI rules, default level.
# Install lines checked against the upstream README on 2026-10-18.
# The band above the prompt does not render in `claude -p`. The rules still load.
# This arm is the default level, not ultra.

arm_summary="Ponytail plugin at its default level. YAGNI rules. The status band does not render in claude -p; the rules still load."
arm_homepage="https://github.com/DietrichGebert/ponytail"

arm_version_commands() {
  printf '%s\n' "claude plugin details ponytail"
}

arm_setup() {
  command -v claude >/dev/null 2>&1 || {
    printf '%s\n' "claude is not on PATH" >&2
    return 1
  }
  claude_marketplace_add DietrichGebert/ponytail
  claude_plugin_install ponytail@ponytail
}

arm_check() {
  return 0
}

arm_env() {
  :
}
