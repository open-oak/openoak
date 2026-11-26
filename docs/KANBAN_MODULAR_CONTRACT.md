# OpenKanban modular contract (KAN-01)

This contract covers the modular storage migration and the legacy bridge.
New accounts use modular board, list, and card records. Accounts with a legacy
aggregate can use the bridge until the operator migrates them. This contract
describes the original owner-only migration. Later changes add
[shared boards](../apps/kanban/docs/COLLABORATION.md) and
[card recovery](../apps/kanban/docs/CARD_RECOVERY.md).

## Outcome and boundaries

Modular reads and writes address specific items and the records required for
authorization, versions, receipts, and ordering. Unrelated item edits do not
conflict solely because a notification revision changed. The board view and
export can assemble a full board through bounded reads.

## Legacy aggregate and compatibility

| Surface | Legacy path | Compatibility requirement |
| --- | --- | --- |
| Persistence | One `KanbanDocument` JSON record per user | Preserve raw source, visible content, IDs, and active selection |
| Browser | `/api/boards` GET/PUT and `use-board-sync.ts` | Fence stale whole-document PUTs and preserve unacknowledged local work |
| MCP | Legacy tools in `lib/mcp.ts` | Retain legacy revision guards during compatibility |
| Local state | `lib/kanban-data.ts`, `kanban-reducer.ts`, `kanban-board.ts` | Preserve visible ordering and lifecycle rules |
| Backup | Format `openkanban`, version 1 | Read old backups and reproduce equivalent visible content |

The legacy browser and MCP paths use the aggregate's revision and 2 MiB
limit. The v2 paths use modular records and per-item versions.
Legacy IDs such as `main`, `todo`, `doing`, `done`, and starter card IDs can
repeat across accounts. An imported ID also carries no global uniqueness
guarantee. The browser permits blank drafts, while legacy MCP creation
requires a title.

## Identity and records

See the [Prisma schema](../apps/kanban/prisma/kanban.prisma) for the physical tables.

| Record | Identity and required fields |
| --- | --- |
| Board | `boardKey` (new opaque globally unique key), `ownerId`, existing `id`, `name`, appearance, owner-visible `position`, `metadataVersion`, `listOrderVersion`, `revision`, `cardCount`, timestamps |
| List | `(boardKey, id)`, name/color/icon, `position`, `metadataVersion`, `orderVersion`, `cardCount`, timestamps |
| Card | `(boardKey, id)`, `listId`, `position`, title/description/dueDate/color, `contentVersion`, `placementVersion`, timestamps |
| Profile | `userId`, `activeBoardKey`, `boardOrderVersion`, profile `version` |
| Receipt | `(actorId, operationId)`, bound board key, canonical input hash, original compact result, applied revision |
| Change | `(boardKey, revision, sequence)`, entity identity, changed version or deletion marker; no full historical content required |
| Transition | `ownerId`, storage mode, migration epoch, source revision/digest, verification evidence |
| Rollback snapshot | `ownerId`, compatible aggregate, compatibility revision, source modular checkpoint; only during the rollback window |

Preserve existing `id` strings and version-1 backup IDs. Allocate and persist the
board-key mapping once; retrying backfill reuses it. Enforce unique `(ownerId, id)`
for boards and `(boardKey, id)` for lists/cards. Foreign keys include `boardKey` so
a card cannot reference another board's list. Owner IDs remain opaque auth IDs;
there is no foreign key into the separate central Account database.

Legacy `?board=<id>&card=<id>` links resolve within the signed-in owner's boards.
The new contract addresses `{boardKey, cardId}`; canonical links may add
`boardKey` while retaining legacy aliases. Never guess a board from a bare card
ID. Future membership lookup uses `boardKey` and can resolve joined boards
without collisions with the member's own `main` board. No legacy ID is silently
renamed to make a uniqueness constraint pass.

Duplicate board IDs within one owner, duplicate list/card IDs within one board,
and ambiguous identity cause a per-owner migration failure. Cross-owner/cross-board
duplicates are valid. Preserve the raw source for diagnosis. Apply `cleanBoards`
only as the existing visible normalization rule: log every repair/drop and require
discrepancies to be explained before cutover. Preserve already-visible long fields
and blank drafts; do not run new write validation over legacy data and truncate it.
An empty account follows the current starter-board behavior with a recorded mapping.

Useful indexes start with owner+board position, board+list position,
board+list+card position, board+card ID, receipt identity and board+change revision.
Read projections select only requested columns; list reorder never loads descriptions.

| Operation | Required read/write footprint on the final path |
| --- | --- |
| Read card | Requested card plus board authorization metadata; no unrelated card rows |
| Patch card text | Board lock/revision, target card, receipt and change marker; no list or sibling content writes |
| Move card | Board metadata, source/destination list ordering, moved card and affected position ranges, receipt/change markers |
| Reorder lists | Board list-order version, affected list positions, receipt/change markers; no card-content reads |
| Rename board/list | Target metadata and required board revision/authorization, receipt/change marker |
| Delete/import container | Explicitly affected container records; this is inherently larger and must have bounded/staged input and atomic publication |

During the rollback window, writes can reconstruct the aggregate for the compatibility mirror.

## Versions, transactions and future collaboration

Versions start at 1; comparisons are exact nonnegative safe integers where a
legacy zero means absent. The new entity versions are positive safe integers.

- Card text/date/color edits compare and increment `contentVersion`.
- A move compares card `placementVersion` and source/destination list
  `orderVersion`; shifted cards get new placement versions, not content versions.
- List name/appearance compares `metadataVersion`; list order uses board
  `listOrderVersion`. Board name/appearance compares its `metadataVersion`.
- Card deletion checks both content and placement versions. A container deletion
  uses an explicit strict revision covering its contents, so an unseen child edit
  cannot be removed accidentally. This is an intentional destructive-operation guard.
- Board `revision` increments once per accepted content/structure operation. It
  is for change delivery, cursors and optional strict writes, not the default CAS
  guard on every card. Profile selection has no board-content revision side effect.
- Structural ordering uses dense integer positions, preserving today's display
  rules. Shift only the affected ordering range and parent counters. This can
  update several position columns; it does not rewrite their text or whole boards.

The first implementation serializes content mutations through the affected board
row inside the transaction. This deliberately favors a simple correct ordering
and change sequence. Same-board operations may wait for that lock, but unrelated
card content versions still succeed; different boards do not share that lock.
Do not claim unrestricted parallel writes or add fractional ordering infrastructure.
Account lifecycle operations additionally lock the profile; lock order is profile,
then board keys in stable order. Normal final card edits do not lock a profile.
The temporary compatibility mirror is the explicit exception described below.

Resolve access inside the same transaction after acquiring the relevant lock.
The shared service requires capabilities (`read`, `editContent`, `manageAccess`,
`deleteBoard`) rather than scattering `ownerId` checks through UI and MCP routes.
Today all resolve to the owner. Later, OpenTodo-style editors can receive content
access while membership and final deletion remain owner-only; membership changes
must use the same board lock so removal races are well-defined. No membership
is granted by a cache, an operation receipt or a source link.

Current OpenTodo references are `lib/todo-access.ts`, `todo-sharing-service.ts`,
`todo-invites.ts`, `todo-sync.ts`, and their tests. Reuse behavior at the appropriate
stage. The checked-out invite implementation uses a random opaque nonce; do not
copy the old roadmap's HMAC description as if it were current code.

## Operation envelope and results

```json
{
  "contractVersion": 2,
  "operationId": "client-generated-uuid",
  "boardKey": "opaque-board-key",
  "type": "card.update",
  "cardId": "1",
  "expectedContentVersion": 3,
  "changes": { "title": "Prepare the release" }
}
```

Actor identity comes from the authenticated request, never the payload. A patch
can contain only the fields permitted by its discriminated operation. Omitted
fields remain unchanged; explicit null is allowed only for nullable fields.
New writes reject invalid values instead of truncating: board/list names 1–160
UTF-16 units after trim; card title 0–500 (empty is a valid explicit draft);
description 0–20,000; dueDate 0–100 with current string semantics. Reuse existing
color/icon/wallpaper enums. Request bytes must also fit the 64 KiB JSON budget.
Existing over-limit legacy values remain readable and survive patches to other
fields. Do not introduce new timezone/recurrence semantics in this migration.

| Existing action family | Modular operation and extra checks |
| --- | --- |
| Create board | `board.create`, client-generated stable IDs, profile board-order version; no existing board key required |
| Rename/appearance | `board.update`, expected metadata version |
| Delete board | `board.delete`, owner-only strict board revision; transaction creates a replacement if final, returns receipt-backed replacement identity |
| Create/update list | `list.create` with list-order version / `list.update` with metadata version |
| Delete list | `list.delete`, strict board revision; reject final list, append its cards to first remaining list in existing order |
| Reorder lists | `list.move`, expected list-order version and validated target index |
| Create card | `card.create`, caller's stable card ID, destination order version; non-reused ID required |
| Update card | `card.update`, expected content version; position/list changes prohibited in text patches |
| Move/index/relative/keyboard card moves | `card.move`, placement and source/destination order versions, destination and zero-based index after removing the moving card |
| Delete card | `card.delete`, content and placement versions; sync deletion marker, no new trash promise |
| Select/open/dialog | Local UI state; explicit `profile.selectBoard` can persist private selection; opening/editing through MCP never implicitly selects a board |
| `replaceState` from refresh | Client projection/reconciliation only; never an unrestricted server mutation |
| Backup restore/import | Compatibility snapshot only in the bridge phase; afterward stage an explicit owned-copy import (new keys), never an implicit overwrite |

List/card moves are within the same board in this contract. UI relative moves
resolve their target index from an acknowledged ordering snapshot and include its
versions. A stale order returns conflict; it must not reinterpret an old index
against a changed list. Profile, create and final-delete operation receipts are
bound to their explicit scope and retain enough owner/tombstone identity to
authorize a duplicate after deletion. Container deletion never permits ID reuse.

Successful results contain operation ID, status (`applied`, `duplicate`, `no_op`),
applied board revision, changed identities/versions and bounded patches, plus a
refresh cursor if a large ordering delta cannot fit. They never return the entire
board/account. No-op writes retain the revision but record a receipt. Failures
leave content, counters, revisions and receipts unchanged. Distinguish `invalid`,
`not_found` (also outsiders), `conflict`, `operation_id_reused`, `too_large`,
`restart_read`, and `upgrade_required`; authorization failure precedes entity data.

Receipt sequence: authenticate → resolve current authorization (including deletion
identity if needed) → look up `(actorId, operationId)` → verify canonical-input
hash/scope → either return original result or check preconditions and apply →
store receipt in the same transaction as data, counters and change marker.
Retain receipts and deletion markers in v2 initially; cleanup is a separate
retention decision. Reusing an ID with changed payload, target or preconditions
is an error. A retry uses the identical ID and payload. A user-approved rebased
edit is a new operation. A delayed duplicate response acknowledges the queue item;
it must not replace a newer local base with the old applied snapshot.

## Bounded reads, details and MCP compatibility

The v2 service exposes summary pages, list pages, card metadata pages, one-card
detail, bounded full-detail pages, and per-board changes. Optional card-ID filters
are bounded and scoped to one board. Normal lists default to 20 and cap at 50.
One-card lookup joins only its authorization/parent metadata and the requested row.
Summary/count/search queries never hydrate every owner's board JSON.

Every complete JSON HTTP result or MCP result envelope is at most 65,536 UTF-8
bytes, including escaped strings, cursors, structured content and any text block.
MCP text is a compact summary, not a duplicate of full structured content. Pack
up to the count or byte limit, whichever comes first. Never silently truncate
content or skip an oversized card to advance a cursor.

If a single legacy card cannot fit, return a small `detail_required` entry with
its identity and an opaque continuation. A detail-chunk read returns consecutive
`jsonFragment` strings of the complete canonical card JSON; concatenating them
reconstructs the record exactly. Choose fragments by the size of the *serialized
envelope*, preserve Unicode boundaries and account for JSON escaping. The first
fragment must make progress. Bind continuations to caller, board, card, relevant
versions, projection/filter and offset. Re-authorize every fragment. If anything
relevant changes, return `restart_read`, never splice two versions together.
This exceptional path preserves oversized existing data without weakening the
normal response bound. Fixtures include escape-heavy and multibyte content.

Normal page cursors bind a stable board revision, filter/projection and last
ordered key. Compare that revision and read the page in one consistent database
snapshot. If the board changes between pages, explicitly restart the read instead
of promising a complete snapshot from mutable offset pages. A bounded summary
digest can invalidate owner-board-summary cursors when a returned summary changes;
do not add an account-wide write precondition for pagination. Export uses a
consistent snapshot/staged stream with the same bound, not an unbounded MCP tool.

The v2 service exposes discriminated schemas under its HTTP and MCP namespaces.
HTTP: `/api/kanban/v2/{boards,lists,cards,card-details,detail-chunks,changes,operations,profile}`.
MCP: `kanban_v2_list_boards`, `kanban_v2_list_lists`, `kanban_v2_list_cards`,
`kanban_v2_get_card`, `kanban_v2_read_card_details`, `kanban_v2_read_detail_chunk`,
`kanban_v2_get_changes`, `kanban_v2_apply_operation`. Profile selection is web-only.

Legacy tool names and `/api/boards` retain their exact schemas and strict
account-revision semantics during the bridge period. Translate a guarded legacy
write against the latest compatibility projection into a transactionally applied
diff; a missing base or stale revision is a conflict, never blind replacement.
Do not silently reinterpret `expectedRevision` as a card version.

When compatibility mirroring is retired, old aggregate writes return
`upgrade_required` without changing data. Clients must export/preserve drafts and
reload/reconnect to the v2 catalog. Any continuing legacy read service explicitly
advertises that its revision is not a v2 write token; removal/versioning is part of
the published compatibility notice. No mixed-generation writer may bypass the
fence by directly updating the original `KanbanDocument` row.

## Offline cache and reconciliation

Namespace the new durable cache/outbox by server identity, account, contract
version, migration epoch and board key. Store acknowledged entity versions,
ordered pending operations and draft recovery separately. Reuse suitable existing
storage helpers; no native-runtime dependency. Do not mark unsent work durable if
the local write fails: keep the draft visible and offer export/retry.

Send stable queued operations in order. Coalesce only operations never sent or
assigned a durable retry identity; never change the payload under an issued ID.
Lost acknowledgements retry identically. A newer snapshot/change page updates
the acknowledged base and replays pending intents without closing dialogs or
discarding text. Same-field/content-version and stale-order conflicts retain
recoverable drafts and require explicit reconciliation, not silent latest-write-wins.
Poll/focus/reconnect feeds this same path. Deletion markers prevent resurrection;
access loss stops sends and removes normal cached navigation while preserving
appropriate exportable unsynced local work. Logout never flushes another account's
queue. No server-side permission can be acquired from a cached board.

Keep old storage keys intact during upgrade. If a legacy pending snapshot has its
acknowledged base, derive a proposed item diff, compare against the new server
versions and enqueue only safe changes. Without that base, retain an exportable
recovery copy and offer explicit import/reconciliation; never upload the entire
snapshot as authoritative. Reject operations from a stale migration epoch on
rollback/re-cutover, preserving their local payload for recovery. The new browser
must handle `upgrade_required` without repeatedly submitting an obsolete PUT.

## Migration and rollback boundary

1. **Expand and bridge:** add independent records, mappings, transition state and
   the database write fence. Deploy readers/writers that understand the modes in
   both browser API and MCP. Keep legacy data authoritative. New records are shadow
   data only; a shadow backfill does not permit mixed independent authorities.
2. **Backfill:** normalize with recorded provenance; persist mapping, source
   revision and digests. Repeat idempotently. Check visible fields, list/card/board
   order, aliases and profile selection. Block ambiguous or unexplained cases.
3. **Per-owner cutover:** acquire the shared owner/schema advisory lock before
   reading the profile/transition and legacy document at READ COMMITTED,
   reconcile all writes since the source revision and verify again. Atomically
   switch authority, increase migration epoch and enable the old-row write fence.
   A legacy write already in flight either commits before the locked final read
   or fails after cutover; it cannot silently win afterward. Missing-document
   inserts are fenced too. Prove this at the database boundary in KAN-02/KAN-06.
   KAN-02's SQL rehearsal establishes that the migration must not additionally
   take a legacy document row lock: an old UPDATE may hold that row while waiting
   in its trigger for the advisory lock, reversing the lock order.
4. **Compatibility window:** modular records are authoritative. Every write also
   advances a separate rollback snapshot and legacy compatibility revision in the
   same transaction. This temporary mirror may lock/reconstruct the owner's
   aggregate and retain the 2 MiB legacy limit. A failure aborts the write; do not
   create an allegedly safe but stale rollback copy. Clients see a clear size error
   if the mirror cannot represent their write. Original legacy rows remain fenced.
5. **Retire mirror deliberately:** after acceptance evidence and an operator-chosen
   stability checkpoint, disable legacy writes and mirroring together. Lift only
   the old aggregate constraint, retaining item/request limits. The final normal
   path now has neither account-wide reconstruction nor a legacy aggregate guard.
   Retain old tables, mappings and evidence; destructive cleanup is a later task.

Rollback *during* the compatibility window pauses/fences writes, drains in-flight
transactions, verifies the latest snapshot matches the modular checkpoint, restores
that snapshot into the legacy table through the controlled maintenance path, then
switches authority/epoch. Retain modular data and receipts for diagnosis. Unpause
only after checks. A binary rollback to an old direct writer is not the rollback
procedure.

After mirror retirement, old binaries cannot safely accept new modular data by
themselves. Prefer a forward fix; a planned rollback must quiesce writes and
regenerate/verify a representable legacy snapshot first. If it exceeds the old
limit, keep service in recovery mode and use modular recovery/export; never
truncate to make rollback fit. Document the actual backup/restore readiness before
production cutover. KAN-01's examples prove no database operation or real restore.

## Executable examples and next-card proof

Run `npm run test:kanban-contract` from the repository root. The JSON fixtures and
small test-only reference model exercise identity isolation, one-card updates,
unrelated concurrent edits, stale same-card rejection, a card move and a list
reorder, lost-response replay, oversized detail reads and a post-cutover rollback
snapshot. They also compare normalization/export with the current application
helpers. This is specification/example validation, not production performance,
SQL locking, authorization, migration, browser or OAuth proof.

| Next card | Required implementation evidence beyond these examples |
| --- | --- |
| KAN-02 | Real schema/foreign keys, duplicate-identity failures, migration replay, old-writer fence and cutover races on disposable PostgreSQL |
| KAN-03 | SQL/query traces showing selective reads, 88-card detail traversal, actual HTTP/MCP envelope size and cursor authorization |
| KAN-04 | Transaction rollback, concurrent sessions, receipt atomicity, owner policy, all current reducer/MCP actions and ordering ranges |
| KAN-05 | Real durable-cache failure, reload/pagehide, out-of-order acknowledgement, conflict, epoch/account isolation and mobile interaction |
| KAN-06 | Recorded production/standalone parity, client compatibility/refresh, final no-mirror path and exercised recovery procedure |

KAN-01 stops with this contract and its runnable fixtures. It does not create the
tables, register the named tools, claim collaboration is delivered or execute a
production migration.

KAN-02 implementation and operator procedure:
[shadow migration runbook](../apps/kanban/docs/MODULAR_STORAGE_MIGRATION.md).
