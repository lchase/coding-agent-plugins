# Checklist routing

Domain depth is not a separate reviewer — it is a checklist **injected into an existing lens** when the diff touches that domain. This keeps the number of parallel reviewers bounded (six) while letting coverage grow without limit: add a domain checklist and a routing row, not another subagent.

Consult this table in Step 1 once you know what the diff touches. For each trigger that matches, load the checklist and hand it to the target lens(es) — in `min`, you read it yourself when you reach that lens; in `max`, it goes into that lens's subagent prompt.

| Trigger (what the diff touches) | Checklist | Inject into lens(es) |
|---|---|---|
| SQL, ORM queries, migrations, schema changes, files under `migrations/`, `*.sql`, repository/DAO layers | `references/domain/database.md` | correctness, performance |
| TypeScript / Node source (`*.ts`, `*.tsx`, `*.mjs`), async code, package.json deps | `references/domain/typescript-node.md` | correctness, design |
| Java / Kotlin source (`*.java`, `*.kt`), Maven/Gradle files | `references/domain/jvm-java.md` | correctness, design |
| Python source (`*.py`), especially `asyncio`, worker/activity code, long-lived processes | `references/domain/python-async.md` | correctness, performance |
| A DTO, event, or message that crosses a process boundary: queue producers/consumers, websocket/RPC payloads, event schemas, golden JSON fixtures, serializer annotations (`@Json*`, pydantic, serde) | `references/domain/messaging-serialization.md` | security, correctness, spec-conformance |
| Public API surface: route handlers, controllers, RPC/GraphQL schemas, exported package entry points, versioned endpoints, and any changed `public`/exported signature in a module other modules or repos import | `references/domain/api.md` | design, spec-conformance |
| Frontend components, JSX/TSX views, forms, anything user-facing | `references/domain/frontend-a11y.md` | design |

## How injection works

A domain checklist **adds** category-specific prompts to a lens; it does not replace the lens's own checklist. The correctness lens still runs its full checklist *and*, when a migration is present, additionally works through the database checklist's correctness section (transactions, backfills, locking, reversibility). The findings still come out tagged with the lens (`correctness`), with a domain-specific `category` (`missing-index`, etc.).

If two triggers route the same checklist into the same lens, load it once.

## Extending

To add framework or language depth (a Go checklist, a React-specific one, a Terraform/IaC one, a payments one):

1. Write `references/domain/<name>.md` with sections keyed by the lens they feed.
2. Add one row here mapping a file/content trigger to that checklist and its target lens(es).
3. Do **not** add a new lens or a new subagent. If a whole new *kind* of concern appears that no lens owns (e.g. accessibility as a first-class gate), that is the rare case where a new lens is justified — but start by trying to route it into `design`.

Keep triggers based on **what the diff touches** (paths, syntax, symbols), not on the author's description, so routing is deterministic and can be applied without asking the user.
