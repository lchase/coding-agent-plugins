# Lens: design

**Owns:** structure, cohesion, and whether the next person can understand and change this. Working code that is unreadable or architecturally wrong is debt that compounds. This lens carries the highest-leverage findings — one structural problem outweighs ten nits, and it leads the review.

Respect documented repo conventions first: where a project's own standards endorse something this checklist would flag, the repo wins — suppress the smell and say why. Absent a documented standard, this baseline applies.

## SOLID (name the violated principle)

- **SRP** — a module/function doing several unrelated jobs; the reason-to-change is more than one (`srp-violation`). Symptom: "and" in the honest description of what it does.
- **OCP** — extending behavior requires editing existing branching instead of adding at an extension point; a `switch` on type that grows every feature (`ocp-violation`).
- **LSP** — a subtype that breaks its base's contract or forces callers to type-check (`lsp-violation`).
- **ISP** — a wide interface whose implementers must stub methods they do not use (`isp-violation`).
- **DIP** — high-level policy wired directly to a low-level concrete detail, so it cannot be tested or swapped (`dip-violation`).

## Fowler smells (baseline that always applies)

- **Duplication** — the same logic in two places that will drift apart (`duplication`). Prefer reusing the canonical helper over a near-duplicate.
- **Dead code** — unused, unreachable, or feature-flagged-off code left in the diff (`dead-code`). After a refactor, hunt for orphaned functions the change stranded. Distinguish safe-delete-now from defer-with-a-plan.
- **Leaky abstraction / feature envy** — a module reaching deep into another's internals (`feature-envy`); an abstraction that exposes what it should hide (`leaky-abstraction`).
- **God object / long function / large file** — one thing that knows or does too much (`god-object`). A small diff can still bolt another branch onto an already-overgrown file — flag the trajectory.
- Primitive obsession, long parameter lists, temporal coupling (must call A before B with no enforcement).
- **Hidden side effects**: a function whose name reads as a query or a builder (`getX`, `buildContext`) that also mutates its input or shared state (`hidden-side-effect`).
- **Two sources of truth**: the same value derived in two places from inputs that can differ (stamped at turn start from one context, re-derived later from a newer one), so one unit of work ends up tagged both ways (`dual-source-of-truth`). Derive once, read after.
- **Stale docs**: a docstring or comment that now contradicts what the code does or relies on (`stale-doc`). The next reader trusts the doc.
- **Signature footguns**: a public signature replaced instead of overloaded (source break for other callers); a trailing positional boolean; an overload that silently defaults a value callers should have to decide (`breaking-signature`).

## Negative space

- Did this change add a second way to do something the codebase already has one blessed way to do, instead of extending the existing one — a parallel path that will drift?
- Is there a module/package that obviously owns this concept, and the diff put the logic somewhere else because that was the file already open?
- Does removing code here strand something else (a helper only that caller used, a config flag only that branch read) that the diff didn't clean up because it wasn't in the diff's own file?

## Propose the move, not just the smell

A finding that says "this is complex" leaves the author guessing. Reach for a **named restructuring**: replace a conditional chain with a typed dispatch; collapse duplicate branches into one flow; separate orchestration from business logic; move feature-specific logic into the package that owns the concept; make a type boundary explicit so downstream branching disappears; delete a pass-through wrapper. Prefer the remedy that *removes* moving pieces over one that relocates the same complexity — relocating complexity is not reducing it. If the restructuring is non-trivial, propose an incremental path, not a big-bang rewrite.

## Output

Canonical schema, `lens: design`. `proposed_move` is the named restructuring. Structural findings are usually P1–P2; pure naming/style is P3.
