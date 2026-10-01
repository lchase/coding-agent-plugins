# smart-review

A multi-lens code review skill. Six specialized review lenses run over a diff and their findings are merged into a single deduplicated, severity-ranked verdict. Built on the observation that no single reviewer catches everything: the differentiator here is the **merge**, not any individual lens.

It ships from one harness-neutral core (`skills/smart-review/`, under this plugin directory)
with a thin manifest per harness. Claude Code gets slash commands and native
parallel-subagent `max`; Cursor, Codex, Gemini CLI, and any AGENTS.md agent run the same
workflow with `max` as a sequential ensemble.

## Install

**Claude Code:**

```
/plugin marketplace add lchase/skills
/plugin install smart-review@lchase
```

**Other harnesses:** point the harness's plugin/extension mechanism at this repo — it reads
the matching manifest (`plugins/smart-review/.cursor-plugin/`,
`plugins/smart-review/.codex-plugin/`, root `gemini-extension.json`) or root `AGENTS.md`,
all of which resolve to the same `skills/smart-review/` core.

## Modes

On Claude Code, commands are namespaced by the plugin (`/smart-review:<mode>`); elsewhere
the skill loads via hook/AGENTS.md and you just ask for a review.

- **`/smart-review:review`** — auto: picks min or max by change size and sensitivity.
- **`/smart-review:min`** — one pass, one context, no subagents. Fast; for tight loops and small diffs.
- **`/smart-review:max`**: spec-gate, then the lens ensemble, merged into one verdict. For pre-merge and high-stakes changes. Isolated parallel subagents on Claude Code; a disciplined sequential lens walk on harnesses without subagents (`references/ensemble.md`). Model panel defaults off. Set `panel: on` or `panel: per-lens` plus `models` when this harness can route more than one model.
- **`/smart-review:add-pr-review <PR number or URL>`** — fetches a GitHub PR's diff via `gh`, runs the same min/max review, then shows you the report and asks what to publish (all findings, P0/P1 only, a custom subset, or nothing) before posting a summary comment (and inline comments for confirmed P0/P1s). Never approves, requests changes, or merges.
- **`/smart-review:review-pr-comments <PR number or URL>`** — triages a PR's *existing* unresolved review comments (Copilot, human reviewers, etc.): fetches unresolved threads via GraphQL, classifies each as fix/docs/explain/disagree, gates on your approval before editing code, gates again before pushing, then replies to and resolves each addressed thread. Not a review pass — glue around comment threads, not the lenses.

The skill also triggers automatically when you ask Claude to review code, check a diff, or judge whether something is ready to merge — you don't have to run a command. The commands just force a specific mode.

## How it works

```
/smart-review:review ─► router (size + sensitivity) ─► min | max

min :  scope diff ─► all 6 lenses in ONE context ─► merge ─► verdict
max :  scope diff ─► SPEC-GATE ─► lens ensemble ─► merge ─► verdict
        ensemble = isolated parallel subagents (Claude Code; model panel when configured)
                   OR sequential lens walk (harnesses without subagents; panel off unless models route)
```

Component layout:

- **The shared core** (`skills/smart-review/`) — harness-neutral. Every manifest points here.
  - **`SKILL.md`** — routing, the min/max workflows, the report format.
  - **`references/lenses/`** — the six review perspectives: spec-conformance, correctness, security, performance, design, tests. Fixed set.
  - **`references/domain/`** — database, TypeScript/Node, API, frontend/a11y. Injected into the relevant lens when the diff touches that domain (see `references/checklist-routing.md`). Add depth by adding a checklist + a routing row, not a new reviewer.
  - **`references/finding-schema.md`** — the one shape every lens emits, so findings can be merged mechanically.
  - **`references/merge-contract.md`**: dedup, agreement-weighting (lenses, and models when the panel ran), conflict resolution, validation, lead filters, severity rollup, structure-over-nits, nit cap. This is the product.
  - **`references/validation.md`**: static re-check, then a certainty ladder. A P0 hard-blocks only after a minimal script or test (`proof: ran`), or an in-app repro. Otherwise it ships as `unproven` and does not hard-block.
  - **`references/ensemble.md`**: the max fan-out protocol, the harness capability check, and the model panel (`off` by default, `on` or `per-lens` when configured).
- **Reviewer subagents** (`agents/`, Claude Code only): the isolated reviewers `max` fans out (`*-reviewer`), plus `merge-synthesizer`. Reviewers are read-only (`tools: Read, Grep, Glob`). The merge synthesizer also has Bash, for blame and for the validation proof command. Each runs in its own context, which keeps findings decorrelated. Each reviewer mirrors a `references/lenses/*.md` checklist, kept in sync, checked by `scripts/validate-adapters.sh`. The orchestrator passes `model` at dispatch time when the panel is on.
- **Commands** (`commands/`, Claude Code only) — the entry points above.
- **Hooks** (`hooks/`) — a session-start bootstrap that nudges harnesses without description-based skill triggering to load the skill on review requests.

## Key design choices

- **Context isolation**: in max, each reviewer sees only the filled template (intent, diff, spec, its checklist), never the author's reasoning or the other reviewers. Running them as separate subagents gives that isolation by construction, and it's what makes the ensemble beat any single pass.
- **Spec-gate first** — don't spend quality-review budget on code that implements the wrong thing.
- **Bounded reviewers, unbounded coverage**: six lenses; domain depth rides in as checklists, so the reviewer count stays fixed as coverage grows. A model panel multiplies that set only when you turn it on.

## Model panel (first-class max config, default off)

Same model reviewing alone repeats its own blind spots. Different models miss different things. The adversarial signal is that diversity, not assigned personas. `references/ensemble.md` is the knob:

```
panel: off | on | per-lens
models: <model-a>, <model-b>
```

- **`off`** (default). Single-model max. Complete on a harness that only has one model.
- **`on`**. The same filled template (intent, diff, spec, that lens's checklist) goes to each model. Merge agreement across models and lenses.
- **`per-lens`**. Cheaper: zip the model list across the five quality lenses.

On Claude Code the orchestrator passes `model` when it dispatches `agents/*-reviewer.md`. Do not bake a `model:` line into those files; the panel is per run. If the harness cannot route models, say so and run single-model max. Use model ids the harness accepts.

Try it: `/smart-review:max` with no panel line is single-model max. `/smart-review:max` plus `panel: on` and two model ids this harness can dispatch is the multi-model panel. `panel: per-lens` is the cheaper split.

## Evals

The eval kit lives under `plugins/smart-review/evals/` (dev-only; it isn't part of the installed plugin). It measures the reviewer empirically — recall and precision per lens, and each lens's marginal contribution via ablation — so you can answer "is max worth its cost?" and "which lenses actually earn their place?" with numbers rather than vibes. See `evals/README.md`.
