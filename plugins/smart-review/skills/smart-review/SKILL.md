---
name: smart-review
description: Rigorous multi-lens code review of a diff. Use this whenever the user asks to review code, review a PR or branch, check a diff, do a pre-merge or pre-commit review, hunt for bugs, security issues, performance problems, or design smells in changed code, or asks whether something is ready to merge — even if they never say the words "code review". Runs six specialized review lenses (spec-conformance, correctness, security, performance, design, tests) and merges their findings into one deduplicated, severity-ranked verdict. Offers a fast single-pass mode (min) for tight loops and an orchestrated ensemble mode (max) that fans the lenses out as isolated parallel subagents for high-stakes or pre-merge review. Prefer this over an ad-hoc review any time correctness or shipping safety matters.
---

# Smart Review

## Why this skill exists

No single reviewer catches everything. A reviewer asked to check six things in one pass does each one worse than six reviewers each checking one thing — attention gets diluted and the last items on the list get skimmed. And one model reviewing alone repeats its own blind spots on every run. So the goal here is not a bigger checklist. It is an **ensemble of decorrelated reviewers plus a strong merge step**.

The value lives in the merge. Running many reviewers without aggregation just produces a pile of overlapping, conflicting, nit-heavy findings and no verdict — and *more* reviewers raises the noise floor, so a naive ensemble is worse, not better. Everything below exists to keep the ensemble's recall while holding the line on precision.

There are three ways to run it:

- **`min`** — one pass, one context, no subagents. Fast and cheap. The 90% case: pre-commit, tight loops, small diffs.
- **`max`** — spec-gate, then the lenses run as a decorrelated ensemble (isolated parallel subagents where the harness supports them, otherwise a disciplined sequential walk — see `references/ensemble.md`), findings merged into one verdict. For PRs, pre-merge, and anything touching sensitive paths.
- **auto** (plain `/smart-review`) — pick `min` or `max` by change size and sensitivity (see Routing).

**Harness support.** The `/smart-review:*` slash commands, the auto-trigger on "review this…", and native parallel subagents for `max` are Claude Code features. On other harnesses (Cursor, Codex, Gemini CLI) this skill loads via the session-start hook and runs the same workflow, with `max` degrading to the sequential ensemble. The lens checklists, finding schema, and merge contract under `references/` are the shared core and behave identically everywhere.

## Routing: choosing min vs max

When invoked as plain `/smart-review` (no mode), decide the lane before doing anything else. Escalate to **max** if *any* of these hold; otherwise run **min**:

- The diff changes more than ~150 lines or touches more than ~5 files.
- The diff touches a **sensitive path**: authentication, authorization, session/token handling, cryptography, deserialization, raw SQL or query building, file-system or shell execution, payment or billing, or anything reading/writing PII.
- The diff touches a **silent-pass mechanism**: CI/CD config, test harness or runner setup, coverage thresholds, feature-flag gating, or anything else that fails *quietly* rather than loudly when broken. Escalate regardless of size — a broken gate here doesn't show up until something it should have caught ships.
- The user asks for a pre-merge / release / "is this safe to ship" review, or names a spec/PRD to check against.
- The user is unfamiliar with the code under review, or explicitly asks for thoroughness.

State the chosen lane in one line and why (e.g. "Running max — this touches auth and the migration path."). If the user asked for `min`/`max` explicitly, honor that and skip the heuristic.

## Step 1 — Scope the diff (all modes)

Reviews run against a **diff**, never the whole tree, and are **read-only**. Do not modify the working tree, the index, HEAD, or branch state at any point during a review.

1. Establish the base. Use whatever the user gave (a commit SHA, branch, tag, `main`, `HEAD~5`). If they gave nothing, ask for the base, or default to reviewing uncommitted changes (`git status -sb`, `git diff`).
2. Capture the diff against the merge-base with a three-dot range so you compare against where the branch actually diverged, not against a moving tip:
   ```bash
   git diff <base>...HEAD          # three-dot: against merge-base
   git log <base>..HEAD --oneline  # the commits in scope
   git diff --stat <base>...HEAD   # size + files, for routing
   ```
   (Use two-dot / `git diff` alone when reviewing uncommitted work.)
3. If you need a full-file view of a revision to understand context, check it out into a scratch worktree — never move HEAD on the user's checkout:
   ```bash
   git worktree add /tmp/review-<sha> <sha>
   ```
4. Confirm the base resolves and the diff is non-empty before continuing.

## Step 2 — Find the spec

The spec is what the change is *supposed* to do. Look, in order: an issue/PR reference in the commit messages; a path the user passed; a PRD/spec file under `docs/`, `specs/`, or similar matching the branch/feature. If you find nothing, ask. If the user says there is no spec, the spec-conformance lens reports "no spec available" and is skipped — do not invent requirements.

## The lenses

Six lenses, each defined by a checklist in `references/lenses/`. Read a lens file before applying it; do not review from memory of these categories.

| Lens | What it owns | Checklist |
|---|---|---|
| spec-conformance | Does it do what the spec asked? drift, missing scope, silent behavior changes | `references/lenses/spec-conformance.md` |
| correctness | Logic, edge cases, error handling, boundaries, concurrency/races | `references/lenses/correctness.md` |
| security | Injection, authz/authn, secrets, SSRF, unsafe deserialization, input trust | `references/lenses/security.md` |
| performance | N+1, hot paths, allocation, caching, algorithmic complexity | `references/lenses/performance.md` |
| design | SOLID, Fowler smells, cohesion/coupling, module boundaries, dead code | `references/lenses/design.md` |
| tests | Behavior vs mocks, edge coverage, test pyramid, do the tests actually run | `references/lenses/tests.md` |

The lenses are **fixed**. Domain depth (databases, a language/framework, APIs, frontend a11y) is *not* a separate lens — it is a checklist injected into whichever lens is relevant. See `references/checklist-routing.md` for the trigger → checklist → target-lens table, and consult it in Step 1 once you know what the diff touches.

## Every finding uses the same schema

All lenses, in every mode, emit findings in the one canonical shape defined in `references/finding-schema.md` — `{file, line_start, line_end, lens, category, severity, title, why, proposed_move, confidence}`. This is not decoration: the merge operates on these fields (dedup on `file`+line-overlap+`category`, agreement-weighting across lenses, severity rollup). A finding that only names a problem without a `proposed_move` is incomplete — reach for a specific, named restructuring, not "improve this".

Severity is **P0–P3**, defined in `references/severity.md`, with the rule that structure beats nits: one architectural problem outweighs ten style nits, and the review should lead with it.

## min workflow

One agent, one context, no fan-out.

1. Scope the diff (Step 1) and find the spec (Step 2).
2. From `references/checklist-routing.md`, note which domain checklists the diff triggers. State it in one line, e.g. "Routing the database checklist into correctness + performance — diff touches migrations/." Say "no domain checklists triggered" if none matched; don't skip the line.
3. Walk all six lenses in sequence in this one context. For each, read its checklist file, plus any domain checklist routed to it, and record findings in the canonical schema. Give a quick spec-conformance check inline — full gating is a `max` feature.
4. Apply the merge rules from `references/merge-contract.md` yourself (dedup, agreement-weight, lead filters, severity rollup, structural-over-nits ordering, nit cap), including the validation pass (`references/validation.md`: static checks plus the certainty ladder on P0/P1) before findings ship, and emit the report in the format at the bottom of this file.

`min` trades the ensemble's decorrelation for speed. That is the right trade for small, low-risk diffs; it is the wrong trade before a merge that touches something dangerous.

## max workflow

The orchestrated ensemble. **The top-level agent is the orchestrator** — subagents cannot spawn subagents, so fan out from here, then collect.

1. Scope the diff and find the spec (Steps 1-2). Note triggered domain checklists and state them in one line with the reason, same as `min`. This is what goes into each subagent's prompt, so get it right before fanning out. Write the one-paragraph intent the ensemble template requires (`references/ensemble.md`) before fanning out. If you cannot write it, ask.
2. Run the ensemble per `references/ensemble.md`. That file has the capability check (isolated parallel subagents if this harness supports them, otherwise a sequential lens walk) and the model panel. Claude Code dispatches the bundled `agents/*-reviewer.md` and passes `model` at dispatch time when the panel is on. Default is single-model max (`panel: off`). Both paths keep the spec-gate and all six lenses. No personas: extra signal is model diversity, configured as `panel: on` (same template to each model) or `panel: per-lens`.
3. **Merge.** Apply `references/merge-contract.md`: dedup, agreement-weighting (≥2 lenses, or ≥2 models when the panel ran, gives a confidence + rank boost), conflict resolution, **validation** (`references/validation.md`: static checks, then the certainty ladder; a P0 hard-blocks only at `proof: ran` or `proof: reproduced`, and `unproven` stays visible without blocking unless the user overrides), lead filters (nitpick gravity, hypothetical, preference, Act On cap ~5), severity rollup, structure-over-nits ordering, nit cap, one verdict. On Claude Code this can go to the `merge-synthesizer` subagent (the only stage that sees everything); elsewhere do it inline.

## Guardrails

- **Read-only.** A review never edits code. A validation proof may run an existing test or a one-liner (`references/validation.md`) and must not write into the repo. If the user then asks you to fix findings, that is a separate action taken after they confirm. Present findings first.
- **Be specific or say nothing.** `file:line`, a concrete failure, and a named fix. No "consider improving error handling".
- **Do not inflate.** A nit is not a P0. Give a real verdict; "looks good" without having read the diff is a failure.
- **Acknowledge what is solid.** A review that only lists problems is less useful and less trusted.

## Report format

Use this exact structure for the final output in every mode:

```
## Smart Review — <mode> · <base>...HEAD
**Scope**: N files, +X/−Y lines · **Spec**: <found / none> · **Panel**: off | on (<models>) | per-lens (<models>)
**Verdict**: APPROVE | APPROVE WITH NITS | REQUEST_CHANGES
<one-sentence why, leading with the most important finding. Name any unproven P0 that is visible and not blocking.>

### Spec conformance
<one-line verdict: implements the spec / implements it with gaps / implements the wrong thing / no spec available — plus any spec-conformance findings, each still tagged with its own P0-P3 severity. Kept separate so a spec drift can't get buried under a pile of correctness/style findings; it still feeds the overall verdict rollup below.>

### P0 — Blocking
1. **[file:line]** Title: why it matters. -> proposed move. (lens; ✓N lenses agree; models: ... when the panel ran; proof: ran | reproduced)
   Findings tagged `proof: unproven` stay in this section after the proven items, title prefixed with `[unproven]`. They do not count toward the verdict unless the user overrides.
### P1 — Fix before merge
### P2 — Should fix
### P3 — Nits (capped; collapse the tail: "…and 9 more style nits")

### Conflicts / judgement calls
<where lenses disagreed, both sides, and the call made>

### Discarded
<findings dropped by validation or by the lead filters, one line each: file:line | claim | discarded: reason. Covers a misread, a script that contradicted the claim, a hypothetical with no call site, and a preference with no defect. Omit this section if nothing was discarded.>

### Strengths
<what is genuinely well done>
```

Verdict rollup: any proven P0 (`proof: ran` or `reproduced`) → REQUEST_CHANGES; an unproven P0 does not hard-block unless the user overrides; a P1 that survived the ladder and the lead filters → REQUEST_CHANGES (fix before merge); only P2/P3 → APPROVE / APPROVE WITH NITS. Act On (proven P0 plus blocking P1) stays at about 5. See `references/severity.md` and `references/merge-contract.md`.
