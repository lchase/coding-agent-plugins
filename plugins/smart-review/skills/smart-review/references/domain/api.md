# Domain: API / interface

Injected into **design**, **correctness**, and **spec-conformance** when the diff changes a public surface: HTTP routes, controllers, RPC/GraphQL schemas, exported package entry points, or versioned endpoints. The governing idea is Hyrum's Law — every observable behavior of an interface will eventually be depended on, so a change to that surface is a change to a contract.

## → design

- **Backward compatibility.** Does the change remove or rename a field, tighten a type, change a default, alter status codes, or change error shapes that existing clients rely on? A breaking change on an unversioned public endpoint is high severity. Additive changes are safer than modifications.
- **Contract clarity.** Consistent resource naming, HTTP verbs matching semantics (no state change on GET), consistent pagination/filtering/error envelope across the surface.
- **Input validation at the boundary.** The API validates and rejects malformed input at the edge rather than trusting it inward (this also feeds security). Unbounded list parameters, missing size limits.
- **Idempotency.** State-changing operations that may be retried — are they idempotent, or is there an idempotency key? Double-submit safety.
- **Leaky internals.** Does the response expose internal identifiers, stack traces, or fields that should not cross the boundary?

## → correctness

- **Write/read symmetry.** Run a value through the write path, store it, then read it back through the read path. Does the writer accept anything the reader rejects (an unknown enum or `type` string, a malformed blob, a value that is only checked when non-null)? Such input saves fine and breaks every later GET or round trip (`write-read-asymmetry`).
- **Guards skipped by null.** `if (value != null) { validate }` lets a required field through when it is absent. For each new check, name what a null, empty, or missing value does.
- **Error mapping is complete.** A catch for one exception type converts only that type to 4xx. Name the other exceptions the same code can raise (cast, null, parse, arithmetic) and say whether each still maps to 500 (`incomplete-error-mapping`). Prefer converting at the shared sink.
- **Tightening on stored data.** A stricter validation (parse as JSON, require a type, reject a range) also applies to rows already saved, so a GET-then-PUT of old data can start returning 400. Ask what stored values or existing clients look like, and whether to enforce only on change or log first (`breaking-stored-data`).
- **Numeric edges.** A check on a broad type (`Number`) admits big integers and decimals that a later `doubleValue()`/`intValue()` rounds or overflows silently. Pick the accepted types on purpose and reject non-finite or out-of-range results.
- **Caller-facing errors.** A 4xx message names the field and the rule in the API's own terms ("must be a string"), says what was received in JSON terms, and never leaks language internals (Java class names, stack text) or the offending value. Build the message in one place so every path words it the same way.

## → spec-conformance

- **The contract matches the spec.** Field names, types, required/optional, status codes, and error cases match what the ticket/PRD/API-design doc specified — not just something reasonable.
- **Versioning.** If the spec calls for a new version or a deprecation, is the old behavior preserved and the new one added, rather than silently swapped (`silent-behavior-change`)?
- **Documented behavior.** If there is an OpenAPI/schema/doc of record, the change updates it and stays consistent with it.
