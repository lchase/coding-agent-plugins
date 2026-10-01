# The ensemble protocol

`max` runs the lenses as a decorrelated ensemble and then merges. How the fan-out
happens depends on what the running harness can do. The merge is identical either way.
A model panel, when you turn it on, sits on top of this protocol: the same review, read
by more than one model.

## Capability check

**If this harness can dispatch isolated parallel subagents** (Claude Code Task tool, or
any harness with an equivalent), run the *isolated* variant below. This is the real
ensemble. The reviewers cannot see each other or the author's session, so their errors
do not line up.

**If it cannot** (Cursor, Codex, Gemini CLI, plain chat), run the *sequential* variant.
It keeps the spec-gate, the six lenses, the panel when one is configured and you can
still route models, and the merge. It drops isolation. Treat that as a complete `max`.
A harness that cannot route models runs single-model max (panel off). That is also a
complete `max`.

## Shared template

Before any fan-out, write one **intent** paragraph. Take it from the user, the commit
messages, or the PR description. If you cannot write it, ask, then stop.

Every reviewer receives the same filled template:

1. The intent paragraph.
2. The diff.
3. The spec, if there is one.
4. That reviewer's lens checklist (`references/lenses/<lens>.md`) and any domain
   checklist the routing table sends to that lens.

No personas. The reviewers are the six lenses. When you want a stronger adversarial
signal, add models. Models differ in blind spots. Assigned personalities mostly add
style. (This is the interrogate pattern from poteto/pstack: same template, model
diversity, no persona roster.)

## Model panel

First-class `max` config. Default is **off**, so a one-model harness keeps today's max
with no extra setup.

Set it in the user request, or in a project note the orchestrator already reads:

```
panel: off | on | per-lens
models: <model-a>, <model-b>
```

- **`off`** (default). One model. Isolated or sequential, per the capability check.
  Empty `models`, a single entry, or a harness that cannot choose a model all mean
  `off`.
- **`on`**. Each entry in `models` receives the same filled template. Run the lens
  ensemble once per model. Spec-gate once, on the orchestrator's model, before spending
  the panel. Isolated harnesses dispatch the lens subagents once per model, in parallel
  when the tool allows. Sequential harnesses walk the six lenses once per model,
  resetting between models the same way they reset between lenses.
- **`per-lens`**. Cheaper panel. Zip `models` across the five quality lenses so each
  lens runs on a different model. Same template fields. Use this when a full panel
  (lenses times models) is more than the review is worth. Spec-gate stays on the
  orchestrator's model.

Rules:

- Use model ids this harness accepts. Do not invent slugs. If an id is rejected, drop
  that model, say so in one line, and continue. If none remain, run single-model max.
- If the user asked for a panel and this harness cannot route models, say that in one
  line and run single-model max.
- On Claude Code the orchestrator passes `model` at dispatch time. Leave
  `agents/*-reviewer.md` frontmatter without a baked-in model, so the panel can change
  per run.
- Stamp `model` on every finding from a panel run. The merge counts distinct models
  the way it counts distinct lenses (`references/merge-contract.md`).

## Isolated variant (parallel subagents)

1. **Intent + spec-gate.** Write the intent paragraph. Dispatch the spec-conformance
   reviewer alone (orchestrator model). If it reports the change implements the wrong
   thing, stop and report that. Skip the gate only if there is no spec.
2. **Fan out the remaining five lenses.** Each subagent receives only the filled
   template above. It must not receive the author's session history or any other
   reviewer's output. Each returns findings in `references/finding-schema.md` shape,
   plus `model` when the panel is on.
   - `panel: off`: one batch, one model. On Claude Code these subagents are the bundled
     `agents/*-reviewer.md`. On another harness with subagents, construct the equivalent
     prompt from the lens checklist.
   - `panel: on`: one batch per model, same template, different `model`.
   - `panel: per-lens`: one batch, each lens on its zipped model.
3. **Merge.** One stage sees everything. Apply `references/merge-contract.md`: dedup,
   agreement across lenses and models, conflict resolution, validation (including the
   P0 proof ladder), lead filters, severity rollup, structure-over-nits ordering, nit
   cap, one verdict.

## Sequential variant (one context)

1. **Intent + spec-gate** inline. Write the intent paragraph, then check the diff
   against the spec. If it is the wrong thing, stop and report.
2. **Walk the lenses.** For `panel: off`, walk the six lenses in order. For `panel: on`,
   repeat that walk once per model. For `panel: per-lens`, walk each lens on its zipped
   model. Between lenses, and between models, reset framing: re-read the checklist
   (plus the routed domain checklist), review only against that lens, record findings,
   then drop that pass's conclusions before the next. Do not let "correctness looked
   fine" soften the security pass. Stamp `model` when the panel is on.
3. **Merge** per `references/merge-contract.md` and emit the report.

This is what `min` also does, in one model, without the formal spec-gate. `min` is for
small, low-risk diffs.
