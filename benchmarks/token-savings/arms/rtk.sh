# shellcheck shell=bash
# shellcheck disable=SC2034
# RTK (rtk-ai/rtk), the shell-output compressor. Not the unrelated Rust Type Kit,
# and not rtk-proxy: a proxy would change the transport and confound this arm.
# Install command checked against rtk INSTALL.md on 2026-10-18:
#   rtk init -g --auto-patch
# --auto-patch writes the PreToolUse hook without a prompt.
# RTK_TELEMETRY_DISABLED skips the consent prompt in a non-interactive shell.
# If a newer rtk init offers to enable rtk-proxy, decline it.
# If this rtk build does not accept --auto-patch, edit this file. It is the only
# place the install command lives.

arm_summary="RTK shell-output hook (rtk init -g). Filters command output. Does not enable rtk-proxy."
arm_homepage="https://github.com/rtk-ai/rtk"

arm_version_commands() {
  printf '%s\n' "rtk --version"
}

arm_setup() {
  command -v rtk >/dev/null 2>&1 || {
    printf '%s\n' "rtk is not on PATH. Install the Token Killer from https://github.com/rtk-ai/rtk (not the Rust Type Kit crate)." >&2
    return 1
  }
  RTK_TELEMETRY_DISABLED=1 rtk init -g --auto-patch
}

arm_check() {
  command -v rtk >/dev/null 2>&1
}

arm_env() {
  :
}
