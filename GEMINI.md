# smart-review

This repo's **smart-review** skill lives at
`plugins/smart-review/skills/smart-review/SKILL.md`. Before any code-review-shaped task
(reviewing a diff, PR, branch, or uncommitted changes; a pre-merge or pre-commit check;
hunting for bugs, security, performance, or design problems in changed code), read that
file and follow it.

`max` mode has no native parallel subagents on Gemini CLI; it runs the sequential
ensemble described in
`plugins/smart-review/skills/smart-review/references/ensemble.md`.

# show-evidence

This repo's **show-evidence** skill lives at
`plugins/show-evidence/skills/show-evidence/SKILL.md`. After implementing a change and
before opening or updating a pull request, or handing the work back to a human, and
whenever someone asks to prove, verify, or show what changed, read that file and follow
it. The per-surface references next to that file apply the same way here as on any other
harness. Gemini has no per-plugin manifest in this repo; this file is the registration.
