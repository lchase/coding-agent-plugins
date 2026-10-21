# shellcheck shell=bash
# shellcheck disable=SC2034
# Built-in Concise output style. The free control a terse-output plugin has to beat.
# Output styles do not break the prompt cache (Claude Code docs).

arm_summary="Built-in Concise output style. The free control for terse-output plugins."
arm_homepage="https://code.claude.com/docs/en/output-styles"

arm_version_commands() {
  :
}

arm_setup() {
  cat > "$ARM_HOME/.claude/settings.json" <<'EOF'
{
  "outputStyle": "Concise"
}
EOF
}

arm_check() {
  return 0
}

arm_env() {
  :
}
