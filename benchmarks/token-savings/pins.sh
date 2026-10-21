#!/usr/bin/env bash
# Pin for the target repo. Sourced by lib.sh. Running this file prints the pin.
# Click is not vendored. fetch_target.sh clones this commit and checks the tree.
# shellcheck disable=SC2034

TARGET_URL=https://github.com/pallets/click.git
TARGET_TAG=8.5.0
# Peeled commit for the annotated tag 8.5.0 (tag object 9e17c52f00a9d1e1479cfb44130ac1ecc47e3938).
TARGET_COMMIT=8b19813f2bfca99f1018a587a8cf54fc959f2e5d
TARGET_TREE=2955d48825c98fd7dcbc60eb41cf18a952a2c0a3

# Tests that need a pager. They fail on a machine without `less`. Click's own
# config already drops the `stress` marker via addopts; do not override addopts.
PYTEST_K='not echo_via_pager'

DEFAULT_REPS=5
DEFAULT_MODEL=sonnet
DEFAULT_EFFORT=medium
DEFAULT_MAX_TURNS=60
DEFAULT_MAX_BUDGET_USD=5
DEFAULT_WALL_TIMEOUT=2700

# Cheap paid preset. Full model id: the short alias "haiku" has resolved to
# Sonnet in Claude Code, so the preset does not use it. Haiku 5.5 is the
# current low-priced tool-using Claude Code model (claude-haiku-5-5).
QUICK_REPS=2
QUICK_TASKS="t2-splitopt t3-explain"
QUICK_MODEL=claude-haiku-5-5

# Ollama's Anthropic-compatible endpoint (v0.14.0 and later). Override with
# BENCH_OLLAMA_BASE_URL, or with OLLAMA_HOST (host:port or a full URL).
DEFAULT_OLLAMA_BASE=http://127.0.0.1:11434

# Adding a task is deliberate: a new file under tasks/ is not billed until it
# is listed here and grade.sh knows how to score it. Adding an arm is the
# opposite: every arms/*.sh (except _*.sh) joins the default matrix.
TASKS="t1-intrange t2-splitopt t3-explain t4-pluralize"

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  printf 'target %s\n' "$TARGET_URL"
  printf 'tag %s\n' "$TARGET_TAG"
  printf 'commit %s\n' "$TARGET_COMMIT"
  printf 'tree %s\n' "$TARGET_TREE"
fi
