# Validation pass

A lens is confident, not correct. Before any finding ships, re-check it against the actual code with no loyalty to the original claim — this is what catches a misread guard, a pre-existing issue mislabeled as new, or a "bug" that's actually an intentional pattern.

Run this on every **P0/P1** finding, and on any P2/P3 that agreement-weighting promoted into the report's visible tiers. Nit-tier findings that stay collapsed under the cap don't need it — not worth the cost.

## Checks, in order

1. **Re-read the cited span.** Open `file:line_start-line_end` plus enough surrounding context (the whole function/block) fresh. Does the finding's claim still hold when you read it again, slower, without the lens's framing?
2. **Is it actually introduced by this diff?** `git blame <file> -L <line_start>,<line_end> <base>...HEAD` (or just `git log -1 --format=%H -- <file>` against the base if blame is noisy). A real defect that predates the diff is still worth knowing about, but label it `pre-existing` in the finding rather than implying the diff caused it — that changes whether it blocks this merge.
3. **Is it already handled somewhere the lens didn't look?** A caller-side guard, a middleware layer, a framework default, a type system guarantee. Grep for the function's other call sites and for the type/schema involved before trusting "unvalidated input."
4. **Is this an intentional pattern, not a bug?** A `catch` that logs and continues might be deliberate degraded-mode behavior; check for a comment, test, or sibling code doing the same thing on purpose before calling it a `swallowed-exception`.
5. **If the finding claims specific library/framework behavior**, confirm it against that dependency's actual installed version (check `node_modules`/lockfile-pinned source or its docs) rather than trusting the lens's memory of how the API works. Library behavior is exactly the kind of thing training data gets stale or wrong on.

## Certainty ladder for blocking findings

Checks 1-5 are static. They stay. A finding that survives them can still be a convincing writeup of a false claim. For every finding that would still ship as **P0**, and for every **P1** (P1 is merge-blocking: `severity.md` rolls it up to `REQUEST_CHANGES`), record how far you proved the claim. This is the blast-radius ladder (poteto/pstack `blast-radius`): take the one fact the finding depends on as far down this list as is cheap, and name the rung.

1. **said-so.** The lens asserted it. That is not evidence.
2. **file:line.** You re-read the cited span (check 1), or the library source at the pinned version (check 5). A citation.
3. **walked.** You walked the failure. Name the input, the call site or other reachable path, and the bad result. A search that finds no caller is an answer. Do not invent a caller or an API.
4. **ran.** You ran a minimal script or an existing test that imports the same library or module path the app ships and exercises the behavior the finding is about. The command fails loud if the claim is wrong. Paste the command and the output (or the test name and the assertion) into `why`. One command. Do not stand up a new harness. Do not modify the review tree: `node -e`, `python -c`, an existing test invocation, or a throwaway file under `/tmp`.
5. **reproduced.** You hit the same behavior in the running app. Optional. Use it when a script cannot see the failure (UI timing, a live service, more than one process) and an app is already running.

Agreement across lenses or models is not a rung. Two reviewers can share a false memory of a library.

### What the rung allows

- A **P0 that hard-blocks** has reached rung 4 or rung 5. Set `proof: ran` or `proof: reproduced`.
- A **P0 that stops earlier** is `proof: unproven`. Lower `confidence` to at most 0.5. Keep the finding in the report, tagged `unproven`, so the reader can override it into a block. It does not roll up to `REQUEST_CHANGES` on its own.
- **P1** uses the same ladder. Run rung 4 when the claim is a behavioral failure you can exercise cheaply. A P1 that never reached rung 3 (no walked failure) does not stay merge-blocking: downgrade it to P2 and name the rung in `why`. A P1 you walked (rung 3) may still block when a script is not cheap. Say that in `why`.
- A run that contradicts the claim is a discard, not an unproven tag. One line in `### Discarded`.

Worked shape: a P0 that says `slice(start, start + size)` returns the wrong number of items. The proof imports that function and asserts a known page length. Exit 0 means the claim is false (discard). If you cannot run it, the finding stays visible as `unproven` and does not hard-block. A dev-only corpus pair lives at `evals/corpus/08-validation-false-off-by-one/` (`after.mjs` plus `proof.mjs`). The installed plugin does not ship that directory.

## Verdict per finding

- **Survives.** The claim held, and a blocking finding met the rung bar above. Keep it.
- **Downgrade.** The claim is real but weaker than stated (pre-existing, partially guarded, lower severity, or a P1 that never reached a walked failure). Adjust severity and confidence, and say why in `why`.
- **Unproven.** The claim was not disproven, and a P0 did not reach rung 4. Keep it, tag `proof: unproven`, and leave it out of the hard-block.
- **Discard.** The claim does not hold (misread code, already guarded, intentional, or a script showed the opposite). Lead-filter discards (hypothetical, preference) use this same trail; see `merge-contract.md`. Drop it from the blocking tiers. Keep one line in `### Discarded`: `<file:line> | <one-line claim> | discarded: <reason>`. A reader who disagrees can check the reason. Do not drop these silently.

Validation checks one claim. Stop once that claim is confirmed, downgraded, tagged unproven, or discarded.
