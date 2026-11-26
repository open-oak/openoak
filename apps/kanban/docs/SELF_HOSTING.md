# OpenKanban recovery and legacy storage

Follow [Self-host OpenOak](../../../docs/SELF_HOSTING.md) to install and run
OpenKanban. It covers independent local accounts and the shared Account suite.

## Upgrade and recovery

Before an upgrade, stop application writes and take a complete PostgreSQL
backup with `pg_dump --format=custom`, using connection credentials supplied
through your normal secure PostgreSQL configuration. Keep the matching source
revision and environment configuration securely. Rehearse `pg_restore` into a
separate empty database, then launch the matching application against that copy
and check login, boards, card content and ordering, shared membership and Archive.
Never aim a rehearsal at the production database.

Install the new locked dependencies, apply `npm run migrate:deploy`, build and
restart. The card recovery migration is additive and must precede the new code.
Older modular writers continue to preserve deleted cards while the recovery
migration is installed. Keep that migration during application-code rollback.
See [Card recovery](CARD_RECOVERY.md) for lifecycle and rollback restrictions.

Migrate each legacy-document account separately. Run these commands from the
repository root.

```bash
# Set KANBAN_MIGRATION_DATABASE_URL explicitly to the intended database/schema.
node apps/kanban/scripts/kanban-shadow.mjs backfill --owner OWNER_ID
node apps/kanban/scripts/kanban-shadow.mjs verify --owner OWNER_ID
node apps/kanban/scripts/kanban-cutover.mjs cutover --owner OWNER_ID
```

Inspect each command's evidence before proceeding. Keep the compatibility
mirror until the modular installation is verified; then use `retire-mirror`.
These scripts read their explicit environment variable. They do not load `.env`
automatically. See [Modular storage migration](MODULAR_STORAGE_MIGRATION.md) for checkpoint
and reconciliation procedures. Legacy rollback is blocked while cards remain in Archive.

[Board archives](BOARD_ARCHIVE.md) provide portable active and archived board content. A full
database backup also retains accounts, sharing, operation receipts and original audit timestamps.
