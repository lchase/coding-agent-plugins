# AGENTS.md

This repo is the **`lchase`** marketplace of Claude Code plugins. Two skills apply to
non-Claude agents.

**smart-review** (`plugins/smart-review/skills/smart-review/SKILL.md`). Before any
code-review-shaped task (reviewing a diff, PR, branch, or uncommitted changes; a
pre-merge or pre-commit check; hunting for bugs, security, performance, or design
problems in changed code), read that file and follow it.

The shared core is under `plugins/smart-review/skills/smart-review/references/`: the six
lens checklists, the domain checklists, the finding schema, the merge contract, and the
ensemble protocol. These behave identically on every harness. `max` mode uses native
parallel subagents only on Claude Code; elsewhere it runs the sequential ensemble in
`references/ensemble.md`.

**show-evidence** (`plugins/show-evidence/skills/show-evidence/SKILL.md`). After
implementing a change and before opening or updating a pull request, or handing the work
back to a human, and whenever someone asks to prove, verify, or show what changed, read
that file and follow it. Per-surface notes (Playwright UI, Playwright request, vhs, Hurl,
script runs, redaction) live in `references/` next to the skill. The workflow is the same
on every harness.

The other plugins are Claude Code only and do not apply here.
