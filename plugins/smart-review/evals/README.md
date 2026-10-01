# smart-review evals

A starter harness for measuring the reviewer **empirically** instead of by vibes. It answers the questions that motivated this skill: which lenses actually catch things, how much each lens contributes on the margin, and whether `max` earns its extra cost over `min`.

This directory is dev tooling — it is **excluded from the packaged `.skill`**. It lives with the skill in source control so the reviewer's own quality can be regression-tested like anything else.

## The idea

A small corpus of diffs with **planted defects** of known type and location, plus at least one clean diff to measure false positives. You run the reviewer on each case, save its findings, and the scorer compares them against the ground truth. Metrics:

- **Recall** — of the planted defects, how many did the reviewer catch? Overall, per case, and per lens.
- **Precision** — of the reviewer's findings, how many correspond to a real planted defect? (Clean cases turn every finding into a false positive, which is exactly what you want to penalize.)
- **Marginal recall** — drop a lens and re-score. The recall you lose is that lens's contribution. A lens that loses nothing when dropped is redundant; a lens that loses a lot is load-bearing.

## Layout

```
corpus/<case>/
  meta.json       # id, title, the lens it mainly exercises, the spec/intent, files under review
  after.ts        # the code under review (the planted defect lives here)
  expected.json   # ground truth: must_find (and optionally must_not_find traps)
  actual.json     # YOU produce this by running the reviewer (git-ignored)
```

## Running it

Requires Node 18+ and `tsx` (`npm i`). Two steps:

**1. Produce `actual.json` for each case** by running the skill on that case's `after.ts` (and its `meta.json` spec), and saving the emitted findings array as `corpus/<case>/actual.json`. In Claude Code you can do this by pointing `/smart-review` at the file with the meta's spec; capture the JSON findings the lenses produce. (The report is for humans; the findings array is what the scorer reads. Have the skill emit the raw findings JSON alongside the report when running evals.)

**2. Score:**

```bash
npm run score                 # overall + per-case + per-lens recall & precision
npm run score -- --drop security   # ablation: recall with the security lens removed
npm run score -- --window 8   # widen the line-match tolerance (default 5)
```

`npm run list` prints the corpus manifest (what each case tests) without scoring.

### Ablation loop (marginal recall)

```bash
npm run score                      # baseline recall R
for lens in spec-conformance correctness security performance design tests; do
  npm run score -- --drop "$lens"  # recall without that lens
done
```

The drop in recall for each lens is its marginal contribution. Use it to prune redundant lenses or to justify keeping an expensive one. Do the same comparing a `min` run vs a `max` run of the same corpus to see the recall/precision gained per unit of latency and tokens — that number is where your router threshold between min and max should sit.

## Extending the corpus

Add a `corpus/<n>-<lens>-<defect>/` directory with the four files. Keep the planted defect realistic (the kind of thing that actually slips through review), keep `after.ts` short, and make `category` in `expected.json` match the vocabulary in the finding schema in the plugin (`skills/smart-review/references/finding-schema.md`). Add trap cases (`must_not_find`) that look like defects but are fine: an O(n²) over a bounded constant list, a "tainted" value that never reaches a sink, to keep precision honest.

`08-validation-false-off-by-one` is a trap aimed at the validation ladder, not at a lens. `after.mjs` is a correct exclusive `slice`. A plausible P0 says the page length is wrong. `proof.mjs` imports that same module and asserts a full page. Exit 0 is rung 4 (`proof: ran`) and the finding is discarded. If the script cannot be run, the claim stays `unproven` and must not hard-block. The scorer still treats a matching finding in `actual.json` as a false positive via `must_not_find`. Run the proof with `node corpus/08-validation-false-off-by-one/proof.mjs`.

## Caveats

This is a starter, not a benchmark suite. Eight cases will not give you stable numbers. Expand to a few dozen across categories before trusting the deltas, and re-plant defects periodically so the reviewer is not overfit to a fixed set. Findings are matched on `(category, file, line±window)`, so consistent category naming matters. That is why the schema fixes the vocabulary.
