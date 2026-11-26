# OpenKanban modular release runbook

This runbook keeps the legacy document and modular rows reversible while the
new client and MCP paths are validated. Every command requires an explicit
database URL and owner; none changes authority implicitly.

## Preflight

The raw SQL pool needs a direct PostgreSQL connection because it sets a
schema-scoped startup option. Set `KANBAN_DIRECT_URL`; the suite can reuse its
existing `SUITE_DATABASE_URL_UNPOOLED`. Neon transaction-pooled URLs reject this
option. Verify an authenticated board read as well as `/health` before declaring
a deployment healthy; the health endpoint does not access the database.

1. Run `npm run typecheck --workspace=@openoak/kanban` and
   `npm test --workspace=@openoak/kanban`.
2. Run the migration, operation, MCP and `test:browser-sync` integration suites
   against a disposable PostgreSQL database. Build Kanban and run
   `node tests/integration/kanban-ui.test.mjs` from its app directory for the
   authenticated desktop/mobile, second-session, offline-reload and reconnect gate.
3. Run `node scripts/kanban-shadow.mjs backfill --owner <id>` and inspect the
   returned `status`, `repairs`, counts, and digest. `review_required` is a
   deliberate stop for operator review.
4. Run `node scripts/kanban-shadow.mjs verify --owner <id>` immediately before
   authority changes.

## Authority changes

Set `KANBAN_MIGRATION_DATABASE_URL` to the target database (including its
`schema` query parameter), then run:

```sh
npm run migration:cutover --workspace=@openoak/kanban -- cutover --owner <id>
```

Cutover verifies the complete projection, stores a rollback snapshot, advances
the migration epoch, and enables modular writes with the temporary compatibility
mirror. Old aggregate writes are fenced by the database trigger.

During the mirror window, every modular operation updates the snapshot in the
same transaction. Monitor operation conflicts, `refreshRequired` responses,
legacy bridge traffic, and snapshot digest/checkpoint health before retiring it:

```sh
npm run migration:cutover --workspace=@openoak/kanban -- retire-mirror --owner <id>
```

After retirement, normal item writes no longer reconstruct any aggregate.
Take a database backup before recovery. Capture a fresh recovery snapshot
explicitly, then restore it:

```sh
npm run migration:cutover --workspace=@openoak/kanban -- checkpoint --owner <id>
npm run migration:cutover --workspace=@openoak/kanban -- rollback --owner <id>
```

Rollback first proves that the modular projection still matches the snapshot,
then changes the transition to legacy and writes the snapshot as a new,
versioned legacy document. Modular rows, identities, receipts, and change
markers remain intact for a later cutover.

If legacy edits occur after rollback, run `reconcile --owner <id>` through the
same command before `cutover`. This uses the item primitives and preserves
published versions. Ordinary shadow backfill intentionally refuses this state.
Reconciliation refuses ambiguous or normalized source data and reused deleted
identities; investigate those cases instead of resetting the history.

Checkpoint/rollback refuses a changed or corrupted snapshot. If a write lands
between checkpoint and rollback, repeat the checkpoint after draining clients.
Rollback excludes legacy table writers before taking the owner fence to avoid
deadlock with an old client. Owners above the legacy 2 MiB size limit require
database restore procedures; do not truncate them to force rollback.

## Evidence to retain

Keep the JSON result from each command, the source and visible digests, the
operation error/latency counters, a successful MCP traversal with bounded
detail chunks, and a backup export/import check. Production OAuth refresh and
client evidence must be recorded separately; local suites do not prove an
external connector's refresh cycle. Shared-board invitations are outside this
release. Record the first observed request separately from warmed calls;
do not claim a forced cold start when the hosting platform cannot establish it.

The browser caches the selected board and bounded catalog under the account ID.
Only one tab per account owns its local operation queue; other tabs explain
how to release it. Different browser sessions remain independently usable.
The service worker caches a public shell and versioned assets, never API data
or authenticated HTML. Unsent edits remain exportable after loss of access.
Complete exports explicitly load every board. Imports create new owned copies
atomically per board, without replacing existing boards.
