# Severity — P0 to P3

One scale across all lenses so the merge can rank and roll up mechanically. Severity is **impact if this ships**, decided independently of `confidence` (how sure you are it is real).

| Level | Meaning | Examples | Verdict effect |
|---|---|---|---|
| **P0** | Will cause incidents, data loss, or a breach. Ship-blocker once proven. | Exploitable injection, auth bypass, data corruption, guaranteed crash on a common path, money computed wrong. | `REQUEST_CHANGES` when `proof` is `ran` or `reproduced`. `unproven` is reported and does not hard-block. |
| **P1** | Wrong or unsafe under realistic conditions; fix before merge. | Unhandled error on a real path, race under normal load, missing a required piece of the spec, N+1 on a hot endpoint. | `REQUEST_CHANGES` |
| **P2** | Real problem, not blocking. Should fix soon. | Edge case only under unusual input, a smell that will bite later, a missing test for changed behavior, an avoidable allocation off the hot path. | `APPROVE` (noted) |
| **P3** | Nit. Style, naming, formatting, minor polish. | Naming, comment nits, import order, a slightly clearer structure with no behavior change. | `APPROVE WITH NITS` |

## Deciding the level

Ask two questions: *how bad is the consequence*, and *how likely is the triggering condition*. P0 = bad consequence on a likely path. A severe consequence that only fires on input the system can never receive is not a P0 — say why it is bounded. Conversely, a "small" bug on the default path can be a P1.

Security findings carry both **exploitability** and **impact**; a theoretically-injectable field with no reachable sink is lower than a directly attacker-reachable one. Note the reachability either way.

## Structure beats nits

The ordering rule the merge enforces: one structural problem outweighs ten nits. Do not let a pile of P3s dilute a P1. If you find yourself with one architectural issue and a long tail of style points, the architectural issue is the review.

## Verdict rollup

Computed over the merged, deduped set:

- any unresolved **P0** → `REQUEST_CHANGES`
- any **P1** → `REQUEST_CHANGES` (fix before merge)
- only **P2/P3** → `APPROVE` (`APPROVE WITH NITS` when P3s are present)
- nothing found → `APPROVE`, stated explicitly

A P0 hard-blocks only after the validation ladder reaches `proof: ran` or `proof: reproduced` (`validation.md`). An `unproven` P0 stays in the report. It does not, alone, produce `REQUEST_CHANGES`. The reader can override that and block on it. P1 stays merge-blocking when the ladder and the lead filters (`merge-contract.md`) left it that way.

A clean review is a valid, valuable result. State "no blocking issues found" plainly rather than manufacturing findings to look thorough.
