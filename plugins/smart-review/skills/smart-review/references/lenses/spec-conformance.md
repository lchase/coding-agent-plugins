# Lens: spec-conformance

**Owns:** whether the change does what it was supposed to do. This is the axis that catches "clean code that implements the wrong thing" — code can pass every other lens and still be wrong here. In `max` this lens runs first as a gate.

You need the spec (issue, PRD, ticket, or the user's stated intent). If there is none, report "no spec available" and skip the requirement checks. Do not invent requirements to review against. Still verify the claims list when there is a PR description.

## Check

- **Every required behavior is present.** Walk the spec's acceptance criteria one by one against the diff. A criterion with no corresponding code is `missing-requirement`.
- **Nothing contradicts the spec.** Where the code does something the spec explicitly rules out, or the opposite of what it asks, that is `contradicts-spec` and usually P1+.
- **Scope drift.** Code that does things the spec never asked for is `scope-drift` — not always wrong, but flag it: unrequested behavior is unreviewed behavior and often the source of surprises.
- **Silent behavior changes.** A refactor or "small fix" that changes an observable behavior (an API response shape, a default, an error code, ordering) without the spec calling for it is `silent-behavior-change`. These are the ones that break callers quietly.
- **Every claim in the PR description holds.** Walk the claims list one claim at a time and verify each against the diff and the context pack: "the old overload keeps working" (is it still there?), "payloads are byte-identical" (what serializes the new field?), "peak memory drops to X" (does anything outside the diff keep the data alive longer?), "only one thread touches this" (what does the docstring or the scheduler say?). A claim the code contradicts is `false-claim`, usually P1, because reviewers and the next maintainer trust the description. A claim that holds only under an unstated condition (fast I/O, no retries, one caller) is `false-claim` at P2 with the condition named.
- **Deviations that are actually improvements.** If the code sensibly diverges from an underspecified or wrong spec, say so and call it justified rather than dinging it — but name the divergence so it is a decision, not an accident.

## Negative space

- Does the spec imply a behavior for an old client/consumer/caller that the diff doesn't mention at all — is backward compatibility an unstated requirement here, and does the diff honor or silently break it?
- Are there acceptance criteria that are *implicit* in the spec's framing (performance, error UX, a rollback path) rather than explicitly listed, that the diff has no code for at all?

## Gate rule (max)

If the change misses major scope or contradicts the spec such that it must be substantially rewritten, report that and **stop the review there**. There is no point spending correctness/security/perf effort on code that is going to change shape. If the misses are localized, report them and let the other lenses proceed.

## Output

Findings in the canonical schema, `lens: spec-conformance`. Lead the gate decision with a one-line verdict: implements the spec / implements it with gaps / implements the wrong thing.
