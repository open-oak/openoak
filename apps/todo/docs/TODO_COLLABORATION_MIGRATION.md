# OpenTodo collaboration migration

This is an additive, mixed-version-safe migration. Deploy the database expansion before deploying collaboration-aware application code.

## Forward sequence

1. Apply `20260820120000_add_todo_collaboration`.
2. Verify every `TodoProfile` has exactly one `DEFAULT` list, no `DEFAULT` list has members, and every legacy task has a creator `TaskPersonalState` row.
3. Deploy the application. It reads personal flags from `TaskPersonalState` and continues mirroring a creator's flag changes into the legacy task columns.
4. Keep `Task.userId`, `Task.isImportant`, and `Task.isMyDay` for the entire compatibility window. No contraction is part of this phase.

Do not deploy the collaboration-aware application before step 1. The new code
expects `List.kind`, `ListMember`, and `TaskPersonalState` to exist. Run the
migration once as a deliberate release step, not concurrently from web
instances.

Useful verification queries:

```sql
SELECT "ownerId", COUNT(*) FROM "List" WHERE "kind" = 'DEFAULT' GROUP BY "ownerId" HAVING COUNT(*) <> 1;
SELECT COUNT(*) FROM "ListMember" member JOIN "List" list ON list."id" = member."listId" WHERE list."kind" <> 'CUSTOM';
SELECT COUNT(*) FROM "Task" task LEFT JOIN "TaskPersonalState" state ON state."taskId" = task."id" AND state."userId" = task."userId" WHERE state."taskId" IS NULL;
```

All three queries must return no rows or a count of zero. Also validate the
database rules directly in a staging or disposable production-like Postgres:

```sql
-- Must fail: default lists are never shareable.
UPDATE "List" SET "inviteEnabled" = true, "inviteNonce" = 'test'
WHERE "kind" = 'DEFAULT';

-- Must fail: default lists cannot receive members.
INSERT INTO "ListMember" ("id", "listId", "userId", "updatedAt")
SELECT 'invalid-default-member', "id", "ownerId", CURRENT_TIMESTAMP
FROM "List" WHERE "kind" = 'DEFAULT' LIMIT 1;
```

Release validation for this migration was run from an empty database through
all 11 migrations and against a seeded two-user fixture. The automated fixture
exercises invite enable/rotate/disable, idempotent concurrent acceptance,
owner/editor boundaries, removal/leave, the default-list membership trigger,
and per-user task flags. Re-run it against a disposable database with:

```bash
TODO_DATABASE_URL="postgresql://.../disposable" \
TODO_INTEGRATION_DATABASE_URL=1 \
npm test -- --run tests/todoSharing.integration.test.ts
```

Never point that cleanup-capable integration test at a database containing
real data.

## Rollback

Roll application code back first. Because creator flag writes are mirrored, the old application can continue using the legacy columns without losing creator state.

Only after all collaboration-aware application instances have been removed, roll back the expansion with:

```sql
DROP TABLE IF EXISTS "TaskPersonalState";
DROP TRIGGER IF EXISTS "ListMember_custom_list_only" ON "ListMember";
DROP FUNCTION IF EXISTS "enforce_custom_list_membership"();
DROP TABLE IF EXISTS "ListMember";
DROP INDEX IF EXISTS "List_one_default_per_owner";
DROP INDEX IF EXISTS "List_ownerId_kind_idx";
ALTER TABLE "List" DROP COLUMN IF EXISTS "inviteNonce", DROP COLUMN IF EXISTS "inviteEnabled", DROP COLUMN IF EXISTS "kind";
ALTER TABLE "TodoProfile" DROP COLUMN IF EXISTS "email", DROP COLUMN IF EXISTS "displayName";
DROP TYPE IF EXISTS "ListKind";
```

This intentionally leaves the physical `Task.userId`, `Task.isImportant`, and `Task.isMyDay` columns untouched. Membership and member-only personal state created after rollout are collaboration data and are discarded by a schema rollback; owned lists, tasks, subtasks, creator identity, and all legacy creator flags remain intact.

## Compatibility-window exit

There is no automatic cleanup date. Remove the legacy task flag columns only
in a separately reviewed contraction migration after every deployed version
reads `TaskPersonalState`, dual writes have been observed in production, and a
fresh export/restore rehearsal succeeds. Until then the legacy columns are the
rollback bridge.
