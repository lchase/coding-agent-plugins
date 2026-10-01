# Finding schema

Every lens, in every mode, emits findings as objects of this exact shape. The merge step and the eval scorer both operate on these fields, so the shape is a contract, not a suggestion.

```jsonc
{
  "file": "src/checkout/charge.ts",   // repo-relative path
  "line_start": 42,                    // first line of the span (1-indexed)
  "line_end": 45,                      // last line; == line_start for a point
  "lens": "security",                  // which reviewer raised it (see below)
  "category": "sql-injection",         // stable taxonomy key — drives dedup
  "severity": "P0",                    // P0 | P1 | P2 | P3 (see severity.md)
  "title": "Attacker-controlled input concatenated into SQL",
  "why": "req.query.id flows unescaped into the query string; enables data exfiltration and blind injection.",
  "proposed_move": "Use a parameterized query: db.query('… WHERE id = $1', [id]).",
  "confidence": 0.9                    // 0..1 — the reviewer's own certainty
}
```

## Field rules

- **`lens`** — one of `spec-conformance | correctness | security | performance | design | tests`. Set by the reviewer that produced the finding. The merge uses it for agreement counting and conflict arbitration.
- **`category`** — a short, stable, lowercase-hyphen key from a bounded vocabulary. This is the dedup key together with location, so two reviewers describing the same defect must land on the same category. Prefer an existing key over inventing one. Seed vocabulary:
  - correctness: `off-by-one`, `null-deref`, `unhandled-error`, `swallowed-exception`, `race-condition`, `boundary`, `logic-inversion`, `resource-leak`
  - security: `sql-injection`, `command-injection`, `xss`, `ssrf`, `authz-gap`, `authn-gap`, `secret-in-code`, `unsafe-deserialization`, `path-traversal`, `open-redirect`
  - performance: `n-plus-one`, `hot-path-allocation`, `missing-index`, `missing-cache`, `quadratic-loop`, `blocking-io`
  - design: `srp-violation`, `ocp-violation`, `lsp-violation`, `isp-violation`, `dip-violation`, `duplication`, `dead-code`, `leaky-abstraction`, `god-object`, `feature-envy`
  - tests: `mocked-behavior`, `missing-edge-case`, `no-failure-test`, `flaky-pattern`, `untested-change`
  - spec-conformance: `missing-requirement`, `scope-drift`, `contradicts-spec`, `silent-behavior-change`
- **`proposed_move`** — a specific, named remedy. "Replace the conditional chain with a dispatch table", "collapse the two duplicate branches", "parameterize the query". Not "improve this" or "consider refactoring". A finding without a real `proposed_move` is incomplete and should not ship.
- **`why`** — the concrete consequence, tied to *this* code. Enough that the author can judge it without re-deriving the problem. Exploitability + impact for security; the failing input for correctness; the cost for performance.
- **`confidence`** — the reviewer's certainty that this is real (not how bad it is — that is severity). The merge boosts confidence when lenses agree and can down-weight lone low-confidence findings.

## Optional fields

Lenses omit these. The orchestrator and the merge fill them in. Old findings that lack them still validate.

- **`model`**: set on each finding when the max model panel ran (`ensemble.md`). The id is whatever model the harness actually dispatched. The merge copies distinct values into `agreed_by_models`.
- **`proof`**: set during validation on P0/P1 only: `said-so`, `file-line`, `walked`, `ran`, `reproduced`, or `unproven`. A P0 hard-blocks only at `ran` or `reproduced`. See `validation.md`.

## Why one schema

Structured, uniform findings are what make the merge possible: you can dedup on `(file, overlapping lines, category)`, count how many lenses independently raised the same `(category, location)`, roll `severity` up into a verdict, and sort structural findings ahead of nits — all mechanically. Free-text reviews can't be merged; they can only be concatenated, which is exactly the pile-of-noise failure mode this skill exists to avoid.

A machine-readable mirror of this schema lives in the eval kit (`evals/smart-review/types.ts` at the repo root) for the scorer. Keep the two in sync when you extend the category vocabulary.
