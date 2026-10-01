---
description: Orchestrated ensemble review — spec-gate, then lenses fan out as isolated parallel subagents, merged into one verdict. For pre-merge and high-stakes changes.
argument-hint: "[base ref] [spec path]"
---

Use the **smart-review** skill in **max** mode on `$ARGUMENTS`.

Run the skill's max workflow: one intent paragraph, spec-gate via the `spec-conformance-reviewer` subagent, then fan out the five lens reviewer subagents in parallel (each given only the filled template: intent, diff, spec, its checklist). Honor a model panel when the user or the run config sets one (`references/ensemble.md`: `panel: off | on | per-lens`, plus `models`). Default is single-model max. Pass `model` at dispatch time. Do not bake a model into reviewer frontmatter. Then merge via the `merge-synthesizer` subagent.
