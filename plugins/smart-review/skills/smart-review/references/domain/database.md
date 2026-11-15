# Domain: database

Injected into **correctness** and **performance** when the diff touches SQL, ORM queries, migrations, schema, or repository/DAO code. Adds to those lenses; does not replace them. Findings keep the lens tag with a domain `category`.

## → correctness

- **Migration reversibility.** Is there a down migration, or is this one-way? Irreversible destructive migrations (dropping a column with data) need an explicit call-out and usually a phased rollout.
- **Backfill safety.** A migration that rewrites a large table locks it — will it lock production? Prefer batched backfills. A schema change plus a code change that assumes the new shape must be ordered so neither half breaks between deploys (expand/contract).
- **Transaction boundaries.** Multi-statement changes that must be atomic — are they in a transaction? A partial failure that leaves rows half-updated (`race-condition` / correctness). Check-then-insert without a unique constraint races under concurrency.
- **Nullability & constraints.** Adding a `NOT NULL` column with no default to a populated table fails or locks. Foreign keys and unique constraints actually present where the code assumes them.
- **Explicit columns on touched queries.** When a mapper starts reading a new column, every query that feeds that mapper lists its columns. `SELECT *` works today because columns are read by name, but it ties the query to future table changes (`select-star-schema-coupling`). Check other queries that build the same row type, not only the one the diff edits.
- **Deploy order.** Code that requires a new column on every read and write breaks every row if it reaches an environment, or a rolling pod, before the migration. Is the migration a guaranteed earlier step in every region, or does the code tolerate the column's absence?
- **Tightened validation on persisted rows.** If the diff makes a stored field stricter, existing rows that no longer pass will fail on their next read or update. Say how they are found and migrated.
- **N+1 correctness cousin.** An ORM `save` inside a loop can partially succeed — is failure handled per-row or all-or-nothing?

## → performance

- **N+1** (`n-plus-one`): a query per row of a result set; lazy-loaded associations in a loop. Batch, join, or eager-load.
- **Indexes** (`missing-index`): every filter, join, and sort column on a large table has a supporting index; the new query's `WHERE`/`ORDER BY` is covered. Watch for indexes that the migration adds *non-concurrently* and lock the table.
- **Over-fetching**: `SELECT *` for one field; loading full rows to count; fetching then filtering in app code instead of in SQL.
- **Query in a hot loop / per request**: cache or hoist where the access pattern repeats.
