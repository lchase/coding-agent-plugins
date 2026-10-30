# Lens: correctness

**Owns:** does the code do the right thing under all inputs it will actually see — including the ugly ones. This is where most real bugs live, and where AI-written code fails most often: it is confident and plausible on the happy path and quietly wrong at the edges. Give AI-generated diffs *more* scrutiny here, not less.

## Check

- **Edge cases.** Empty collections, single-element collections, zero, negative numbers, the maximum value, the first and last iteration. Off-by-one in bounds, ranges, and slicing (`off-by-one`, `boundary`).
- **Null / undefined / absent.** Every value that can be missing — is it handled before use? Optional chaining that silently produces `undefined` and defers the crash. `null-deref`.
- **Error handling.** Every failure path: is the error caught, or does it propagate to somewhere that handles it? A `catch` that logs and continues as if nothing failed is `swallowed-exception`. An error path that leaves state half-updated is worse than a crash.
- **Async and concurrency.** Missing `await` (a promise used as a value). Unhandled rejections. Shared state mutated by concurrent requests without guarding (`race-condition`). Operations assumed atomic that are not (read-modify-write on a counter, check-then-act on a resource).
- **Resource lifecycle.** Files, connections, locks, timers, subscriptions — opened and always closed, even on the error path (`resource-leak`).
- **Logic.** Inverted conditions (`logic-inversion`), `&&`/`||` mixups, wrong comparison operator, a loop that never advances or never terminates, integer/float and rounding assumptions (especially money — never float for currency).
- **Contracts.** Does the code uphold what its callers assume, and assume only what its callees guarantee? A function that now returns `null` where it never did before breaks every caller.
- **Guard placement.** When the diff adds a guard for an invariant ("never write an emptied object", "a client never sets this field"), is it where every path converges (the sink function, the model, the deserializer) or at one caller? List the paths into the sink from the context pack. A guard that covers one of several is `guard-at-wrong-layer`: name the unguarded path and move the check to the shared point.
- **Unenforced invariants.** Does correctness now depend on something nothing enforces: another module returning every object it was handed, `id()`/identity staying unique while an object may be freed, callbacks firing once, one event loop, a call order? Name who owns the invariant and what breaks when it changes (`unenforced-invariant`). This is a present defect in the design even when today's callers happen to comply.
- **Every producer.** When the diff adds a field or a required step to a type, check every producer in the context pack (constructors, builders, copies, timeout/retry/error paths that build the object by hand). One that does not set it ships the default silently (`incomplete-propagation`).
- **Sentinel meanings.** Does a change collapse two states into one value: `null` ("unknown", omitted downstream) replaced by primitive `false`, a released/cleared object indistinguishable from a genuinely empty one, a default value omitted on the wire that a reader reads as absent? Read the consumer of the value before accepting the change (`sentinel-ambiguity`).
- **Failure blast radius.** When one item of a batch hits an error, does the whole batch fail and discard the good results? Does the error reach the user as a generic message? Would the log line let someone find the bad item (ids, both sides of a mismatch)? `failure-blast-radius` for the first two, `undiagnosable-failure` for the log.

## Negative space

The bugs above are all in the diff. These are the ones that live in what the diff *didn't* touch:

- What calls this function today with the old contract, and does the diff's change to inputs/outputs/errors break an assumption none of those callers know changed?
- Does a caller elsewhere rely on this still throwing/returning the old shape on the path this diff altered?
- Is there a sibling function (the sync version of an async one, the batch version of a single-item one) that needed the same fix and didn't get it?
- Does a docstring or comment outside the diff describe threading, ordering, or ownership that contradicts what the new code relies on? Either the code is unsafe or the doc is stale; say which.

Answer these from the context pack, then Read and Grep past it where a question stays open. Cite the out-of-diff `file:line` you read.

## How to find them, not just recognize them

Pick the two or three riskiest changed functions and trace a hostile input through them by hand: what does an empty string, a huge list, a concurrent second call, or a downstream timeout do here? Recognizing categories is easy; running the input is what surfaces the bug.

## Output

Canonical schema, `lens: correctness`. Always give the failing input in `why` ("crashes when `items` is empty because `items[0]` is read before the length check").
