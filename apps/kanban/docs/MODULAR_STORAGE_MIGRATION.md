# KAN-02: shadow storage and migration rehearsal

KAN-02 adds independent board, list and card tables. The browser API and MCP still
read and write `KanbanDocument`. No account switches authority through this tool.
The migration creates no memberships, sharing UI or new MCP operations.

## Run on a disposable database first

From this application directory, set `KANBAN_TEST_DATABASE_URL` to an explicitly
chosen disposable PostgreSQL database and run:

```sh
npm run test:migration
```

The test creates a unique schema, deploys the complete Prisma migration history
twice, checks database/schema parity, and drops only that schema afterward. The
database role must be able to create schemas. Tests use synthetic content only.
This command fails if the database URL is absent; CI runs it in the PostgreSQL job.

The rehearsal covers preservation of every visible field, dense ordering and
counts, stable aliases across retries/deletion/re-addition, same IDs across owners
and boards, blank drafts, long Unicode descriptions, appearance and active board.
It also covers old-format cards, repair evidence, ambiguous duplicate rejection,
failed-backfill transaction rollback, corrupted shadow data, foreign keys,
concurrent old writers, missing-document inserts, and compatibility recovery.

## Apply schema, backfill, verify

Take the deployment's normal verified database backup before applying a migration
outside the disposable test environment. KAN-02 itself does not run against live
accounts or establish that deployment's backup readiness.

1. Set the usual explicit Kanban migration connection and run `npm run
   migrate:deploy`. This adds tables and the legacy write fence transactionally.
   Existing `KanbanDocument` content is untouched. Normal Prisma writes remain
   allowed because each owner's mode defaults to `legacy`.
2. Set `KANBAN_MIGRATION_DATABASE_URL` explicitly. There is deliberately no
   fallback to `DATABASE_URL` or other application credentials. Optional
   `?schema=kanban` selects a lowercase schema name; default is `public`. TLS
   follows the application's existing PostgreSQL connection policy.
3. Run the following from the application directory, replacing the owner ID:

```sh
npm run migration:shadow -- backfill --owner OWNER_ID
npm run migration:shadow -- verify --owner OWNER_ID
```

Use `--all` instead of `--owner OWNER_ID` to process existing document owners
sequentially, one transaction per owner. Explicit `--owner` also supports an owner
without a saved document, reproducing the current starter-board behavior.

Output is JSON lines: owner ID, status, source revision/digest, visible digest,
counts and normalization paths. It excludes card bodies. Exit codes are `0` for
verified, `2` for normalization requiring review, `1` for a blocked owner or failure.
A blocked owner does not prevent other owners being checked. Restrict access to
reports because owner IDs are included.

`KanbanTransition.sourceDocument` retains the exact source JSON/revision/selection
used for the latest successful shadow build, including fields the current app
normalizes or drops. `evidence.repairs` lists every changed/added/removed path.
The live legacy row remains intact. Ambiguous duplicate IDs are rejected before
any writes; the error identifies the scope, and the original row remains the
recovery source. Never silently rename or deduplicate them.

Review normalization against the retained source. A `review_required` result is
not cutover approval. Correct an actual defect through the authoritative legacy
path and rerun; accepted historical normalization requires explicit recorded
review in the later cutover process. KAN-02 exposes no command to override this.

Backfill runs again whenever the source digest changes. It atomically replaces
only that owner's shadow rows, retaining identity mappings. Identical retries
verify existing rows without recreating them. A discrepancy in an unchanged
shadow stops the operation rather than silently hiding corruption. Evidence is a
checkpoint, not a promise that later legacy writes cannot make it stale: run
backfill and verification again before a future cutover.

## Locks and authority boundary

The database trigger and migration tool share an owner/schema advisory lock. The
tool acquires it **before reading the source**, at READ COMMITTED. It must not
also acquire a document row lock: an old UPDATE may already hold that row while
waiting in the trigger, creating the reverse lock order. Missing-row inserts use
the same advisory lock. The trigger rejects legacy writes at other isolation
levels so an old repeatable-read snapshot cannot conceal an authority switch.

A writer that acquires the owner lock first commits before the migration's final
read. A writer that waits behind a future cutover observes the new mode and fails
with `kanban_upgrade_required`. UPDATE, DELETE and INSERT all pass this fence.
Unrelated owners have independent locks. `TRUNCATE`/DDL/trigger disabling are
maintenance operations, not supported application write paths.

The future bridge must use this lock before mode/epoch changes and modular writes
during the compatibility window. Do not manually set `modular` on a live owner:
the current UI does not yet handle that mode. KAN-03 through KAN-06 supply the new
read/write paths, browser handling and production cutover.

## Recovery procedure exercised here

Before cutover, rollback means stopping backfills and continuing the unchanged
legacy application. Retain the additive schema, mappings and diagnostic evidence;
no table deletion or data restoration is required.

The integration test also rehearses the later compatibility-window procedure on
real SQL rows: simulate an atomic modular edit plus updated rollback snapshot,
quiesce the owner with the shared lock, compare the snapshot content/digest and
board revisions with current modular rows, confirm it fits the old aggregate
limit, then restore its boards/selection/compatibility revision to the legacy row.
The maintenance transaction changes mode/epoch and restores data atomically;
the lock continues fencing old writers until commit. Modular rows remain intact.
The restored card contains the post-cutover edit, not the original backfill value.

This is a database rehearsal, not an exposed production rollback command. Later
cards must make every actual modular writer maintain the snapshot/checkpoint in
the same transaction and honor paused mode/epochs. A stale or oversized snapshot
must block rollback. Reverting binaries alone is not a recovery procedure.
