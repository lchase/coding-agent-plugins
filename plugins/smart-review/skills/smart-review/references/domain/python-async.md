# Domain: Python / async

Injected into **correctness** and **performance** for `*.py`, especially code using `asyncio`, worker frameworks (Temporal, Celery, Dramatiq), or long-lived processes.

## → correctness

- **Identity is not a stable key.** `id(obj)` is unique only while `obj` is alive; once the last reference drops, CPython reuses the address for a new object. A set of `id()`s outliving the objects (or guarding objects another module may drop) can match an unrelated new object (`unenforced-invariant`). Prefer a flag on the object or a key from the domain.
- **Mutating shared objects.** Clearing or reassigning fields on an object another coroutine, callback, or library still holds (`obj.records = []`) is safe only if nothing reads it later. Find every reader in the context pack, including event payloads built after the callback returns (`race-condition` or `unenforced-invariant`).
- **Event loop vs threads.** `asyncio.to_thread`, `run_in_executor`, and inner loops move work off the event loop; code that assumes "one loop, so no races" must match where the task is actually created, not what a docstring says (`stale-doc` when they disagree).
- **Cancellation.** `CancelledError` is a `BaseException` since 3.8; a bare `except Exception` no longer catches it, but `except BaseException`/bare `except:` swallows it. Cleanup in `finally` must not `await` something that can hang after cancellation.
- **`gather` failure semantics.** Without `return_exceptions=True`, the first failure raises while the other tasks keep running unobserved. With it, every result must be checked for an exception.
- **Batch failure.** One bad item raising out of a loop over a whole batch discards the good results and usually surfaces as a generic error to the caller (`failure-blast-radius`). Log the identifying fields of the bad item (`undiagnosable-failure`).
- **Mutable defaults and late binding.** `def f(x=[])`; lambdas or closures in loops capturing the loop variable.

## → performance

- **Unbounded `gather`.** `asyncio.gather(*[work(x) for x in batch])` over a whole queue drain keeps every payload and serialized body resident until the slowest finishes. Bound it with an `asyncio.Semaphore` or a fixed worker pool (`unbounded-concurrency`).
- **Memory claims.** Freeing a field does not free the memory while any other reference (a returned list, a closure, an event, an in-flight serialized copy) is alive. When the PR claims a memory drop, list the references that keep the data alive and check the claim against them.
- **Blocking calls in async code.** `requests`, `time.sleep`, sync DB drivers, or big `json.dumps` on the event loop stall every other task (`blocking-io`).
