# Merge contract

This is the aggregation layer — the part that turns many overlapping reviews into one trustworthy verdict, and the part that determines whether `max` is better than `min` or just noisier. Apply these rules in order. The merge is the **only** stage that sees every lens's output; the reviewers themselves stay blind to each other so their errors stay decorrelated.

## Input

A flat list of findings (finding-schema.md) from all lenses that ran. In `max`, that is up to five quality lenses plus whatever the spec-gate emitted. When the model panel ran (`ensemble.md`), the same lens may appear once per model; those findings carry `model`. Each finding already carries its `lens`, `category`, location, `severity`, and `confidence`.

## 1. Dedup

Two findings are the **same** finding when they share a `category` **and** their line spans overlap (or sit within 3 lines of each other) in the same `file`. Collapse each group into one:

- Keep the clearest `title` / `why` / `proposed_move` across the group.
- Record which lenses contributed (`agreed_by: [security, correctness]`). When the panel ran, also record `agreed_by_models`.
- Take the **max** severity and the **max** confidence of the group as the starting point (agreement can only raise these, step 2).

Near-duplicates that describe the same root cause under *different* categories (e.g. `null-deref` and `unhandled-error` on the same line) are **not** auto-merged — surface both but note the relationship, since fixing one may or may not fix the other.

## 2. Agreement-weight

Independent agreement is the strongest signal you have that a finding is real, and it is free because the passes ran independently (lenses, and models when the panel ran).

- A finding raised by **≥2 lenses**, or by **≥2 models** when the panel ran, gets its `confidence` bumped toward 1.0 and moves up within its severity tier. Count a lens once and a model once. The same lens on two models is model agreement. Two lenses on one model is lens agreement. Either bump is enough.
- A **lone** finding (one lens, and one model if the panel ran) with `confidence < 0.4` is demoted: keep it, but drop it to the bottom of its tier and mark it "single lens, low confidence" (add "single model" when the panel ran) so the author can weigh it. Do not silently discard. A real bug is often found by only one lens.

## 3. Resolve conflicts

Lenses will sometimes prescribe opposite moves (design says "extract a helper", performance says "inline it to avoid the call"). Two models on the same lens can disagree the same way. Do **not** silently pick one.

- Merge them into a single finding that states both moves and the trade-off.
- If a call is needed, the higher-severity concern wins the framing (a P1 correctness/security concern outranks a P3 style preference). Security and correctness generally win ties over style and micro-perf.
- Put unresolved judgement calls in the report's "Conflicts / judgement calls" section, with both sides, so the author decides with eyes open.

## 3b. Validate before it ships

Agreement and dedup tell you findings are *consistent*; they don't tell you a finding is *true*. Before rolling up severity, run `references/validation.md` on every P0/P1 and on any P2/P3 that step 2 promoted into the visible tiers. That pass is the static checks (re-read, blame, caller guards, intentional patterns, library version) plus the certainty ladder for anything that would still block. A P0 hard-blocks only at rung 4 or 5 (`proof: ran` or `proof: reproduced`). An earlier stop is `proof: unproven`: keep it, cap confidence at 0.5, and leave it out of the hard-block unless the user overrides. Discarded findings still get one line in the report's `### Discarded` note, never a silent drop. Lens or model agreement does not substitute for the run.

## 3c. Lead filters

Validation asks whether a claim is true. This step asks whether it should block. It is the interrogate lead-judgment pass (poteto/pstack `interrogate` / `references/lead-judgment.md`), folded into the existing pipeline. The report format does not grow new headings. Map the buckets onto the severity ladder you already emit:

| Lead bucket | Where it lands |
|---|---|
| Act On | Proven P0, plus P1 that stayed merge-blocking. The must-fix list. Capped at about 5. |
| Consider | P2, including must-fix items this step demotes. |
| Noted | P3. Still under the nit cap in step 6. |
| Dismissed | `### Discarded`, same one-line audit trail as a failed validation. |

Apply in order, after validation:

1. **Nitpick gravity.** If a lens (or, when the panel ran, a model) produced only P3s, that axis is probably fine. Say so under Strengths. Do not promote those P3s into Act On. Two nit-only passes agreeing with each other stay a nit.
2. **Hypothetical vs actual.** No call site and no reachable path: discard, or demote out of P0/P1. "What if null" is not Act On when no caller can pass null. Discard line: `discarded: hypothetical, no reachable call site`. A real smell with no current path demotes to P2 (Consider). It does not block.
3. **Preference is not a defect.** "I would have done it differently", a different structure with no concrete failure, or an abstraction this code does not need yet: dismiss. Discard line: `discarded: preference, no concrete defect`. A preference that names a real maintenance cost can stay as P3 (Noted). It does not become Act On.
4. **Act On cap (~5).** Act On is the blocking list: proven P0s plus merge-blocking P1s. If that list is longer than about 5, the filters above were too soft. Re-run 1-3. Then keep every proven P0 (the cap is not a reason to hide a breach). Demote the weakest remaining P1s (lowest confidence, then narrowest impact) to P2 until the blocking list is about 5. Each demotion names the reason in `why` (`demoted from P1: Act On cap`). Do not silent-drop.

Security and correctness still outrank style when a conflict is real (step 3). Do not dismiss a walked security or correctness finding because it is uncomfortable. A single lens with a reachable path can still be Act On. The hypothetical filter still applies: unreachable is not Act On.

## 4. Normalize and roll up severity

Every finding is already P0-P3 (severity.md). Compute the verdict from the set that survived validation and the lead filters:

- any **proven P0** (`proof: ran` or `proof: reproduced`) → `REQUEST_CHANGES` (blocking)
- any **unproven P0** does not, by itself, request changes. It stays in the report, tagged, and the user can override it into a block.
- any **P1** that stayed merge-blocking after the ladder and the lead filters → `REQUEST_CHANGES` (fix before merge)
- only **P2/P3**, or only unproven P0s plus P2/P3 → `APPROVE` (or `APPROVE WITH NITS` if there are P3s). Name the unproven P0s in the verdict sentence so the override is obvious.
- nothing → `APPROVE`, and say so explicitly rather than staying silent.

## 5. Order: structure over nits, spec-conformance stays separate

Within the P0-P3 ladder, order by severity, then by structural weight, then by agreement count. The single most important finding leads — if there is one structural problem and ten nits, the structural problem *is* the review and goes first. A reader who fixes only the top three findings should be fixing the three that matter most.

`lens: spec-conformance` findings are the one exception: pull them out of the P0-P3 ladder into their own always-shown `### Spec conformance` section (report format in `SKILL.md`), instead of interleaving them by severity with everything else. Reason: code can pass every quality lens and still implement the wrong thing, and a P2 spec-drift finding sitting in the middle of a pile of correctness P2s is exactly the kind of signal this skill exists to stop from getting buried. They still count toward the overall verdict rollup (step 4) as if they were in the ladder — only their *display position* changes.

## 6. Cap the nits

This is the rule that keeps the ensemble honest. Left uncapped, five reviewers produce a wall of P3s that buries the P0.

- Show at most ~5 P3 nits; collapse the rest into one line: "…and 9 more style nits (naming, formatting) — available on request."
- If a single category produces many instances (e.g. 12 missing JSDoc comments), report it **once** as a pattern with a count, not 12 times.

## Output

Emit the report in the format at the bottom of `SKILL.md`. The merged finding shape gains these fields for the report:

```jsonc
{
  "...": "all finding-schema.md fields (max severity/confidence of the group)",
  "agreed_by": ["security", "correctness"],   // lenses that raised it
  "agreed_by_models": [],                     // panel entries that raised it; omit or [] when panel is off
  "proof": "ran",                             // P0/P1 only: said-so | file-line | walked | ran | reproduced | unproven
  "conflict_with": null                       // or a sibling finding id
}
```

## The failure mode this prevents

Running all your favorite review tools at once already gives you union coverage — and a mess. Without this merge you get duplicated findings (three tools flag the same N+1), contradictory advice, no severity normalization, and P0s lost in nit-noise. The merge is the actual product; the lenses are commodities.
