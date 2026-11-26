# Modular OpenKanban API

The v2 namespace is explicit because its IDs and concurrency tokens differ from
the legacy document API. `boardKey` is globally unique; the existing `id` and
`?board=...&card=...` links remain intact. Owner access is checked on every request,
including each cursor continuation. Sharing is not enabled by this API.

## Bounded reads (KAN-03)

| MCP tool | HTTP GET resource under `/api/kanban/v2/` | Result |
| --- | --- | --- |
| `kanban_v2_list_boards` | `boards` | Board metadata/counts/keys/versions |
| `kanban_v2_list_lists` | `lists?boardKey=...` | Lists, counts and ordering versions |
| `kanban_v2_list_cards` | `cards?boardKey=...` | Compact card summaries |
| `kanban_v2_get_card` | `card?boardKey=...&id=...` | Full card or `detail_required` |
| `kanban_v2_read_card_details` | `card-details?boardKey=...` | Bounded full-detail page |
| `kanban_v2_read_detail_chunk` | `detail-chunks?boardKey=...&id=...&cursor=...` | Consecutive JSON fragment |

Pages default to 20 items and cap at 50; bytes can end a page sooner. Pass
`nextCursor` into the next otherwise identical request until absent. Card pages
support `listId`, literal case-insensitive `query`, and up to 50 `ids` (repeat the
`ids` query parameter for HTTP). No SQL wildcard interpretation is applied to
search input. Summary descriptions are explicitly excerpts.

Full-detail entries are discriminated: `kind: card` contains a complete card;
`kind: detail_required` contains the identity and first chunk cursor. Concatenate
each `jsonFragment` string in sequence, then parse the combined JSON. It includes
the complete card with all fields, not merely its description. Never skip the
entry or treat a partial fragment as a complete card.

Every result includes the migration `epoch`. Cards include `contentVersion` and
`placementVersion`; list pages include metadata/order versions. A board revision
is a read/checkpoint token, not the normal compare-and-swap token for a card edit.

Pagination reads metadata and rows in one REPEATABLE READ transaction. Page
cursors are bound to owner, epoch, board/filter/projection and a stable revision
plus ordered key. Owner board-summary cursors use a database-computed digest of
board revisions/order. Changes invalidate an affected cursor with `restart_read`.
Chunk continuations bind the card's content and placement versions. Reauthorize
on every call; cursors grant no access and are not a bearer credential.

The service packs the full MCP result, including its compact text block, to at
most 65,000 bytes, reserving room below 65,536 bytes for the transport wrapper.
HTTP JSON is smaller. Oversized existing descriptions use Unicode-safe chunks;
oversized metadata that cannot represent a continuation fails with `too_large`.
Descriptions are never silently truncated on the detail path.

Legacy tools retain their prior schemas and account-revision behavior while the
bridge is in place. V2 returns `upgrade_required` until an account is cut over;
shadow data is never served as an independent authority. Use the staged migration
procedure rather than manually flipping a production account's mode.

Verification: `npm run test:migration` covers SQL footprints, full 88-card
traversal, owner/filter/projection isolation, stale cursors and HTTP bodies. In
the suite, `npm run test:kanban --workspace=@openoak/mcp` exercises the actual MCP
HTTP handler and full response envelopes against PostgreSQL. Its injected
authenticated middleware context does not claim live OAuth refresh coverage.

## Item operations and compatibility (KAN-04)

POST an operation to `/api/kanban/v2/operations`, or pass it as the `operation`
argument to `kanban_v2_apply_operation`. The strict discriminated schema lives in
`lib/kanban-operations-schema.ts`. Every operation includes `contractVersion: 2`,
`epoch`, a stable `operationId` and `boardKey`. Actor identity is authenticated,
never taken from the payload. Web JSON request streams are limited to 64 KiB.

Card text/date/color patches require `expectedContentVersion`. Moves require
`expectedPlacementVersion` plus exactly the source/destination order versions and
the index after removing the card. Container removal requires the board revision;
metadata edits and list ordering use their separate versions. Empty card titles
remain valid drafts. Invalid or over-limit new fields are rejected, not truncated;
unchanged historical oversized fields are preserved.

The same transaction changes records/counters/versions, records identity/deletion
markers and persists the operation receipt. Retry the exact ID and payload after
a lost response; `duplicate` returns the original compact outcome. Reusing the ID
with a changed target, payload or precondition returns `operation_id_reused`.
No-op operations retain revision but record a receipt. A stale epoch is rejected,
including a replay from before rollback. Receipts and identity tombstones remain
stored; cleanup is separate.

Results carry affected identities and versions. For a large ordering change,
follow `refreshCursor` using `kanban_v2_get_changes` / GET `changes`, then refetch
affected records. Change pages can also start at `sinceRevision`. GET `profile`
returns private active selection and profile versions; `profile.selectBoard` is
web-only. MCP edits never implicitly switch the selected board.

Normal final writes share-lock the transition row, serialize only the same
receipt ID, then lock the affected board. Lifecycle operations additionally lock
the profile before boards. During the temporary rollback window only, writers
also take the owner advisory lock and update the separate compatibility snapshot
atomically. The mirror retains the 2 MiB aggregate limit until explicitly retired.
Migration/cutover code takes the transition lock before the owner advisory lock;
no migration takes the legacy document row lock.

Bridge-aware legacy reads use the compatibility snapshot. Legacy writes check its
exact account revision, translate the proposed state into the shared item
operations, verify the resulting fields/order, and advance one compatibility
revision. They never update the fenced original document. Once the mirror is
retired, legacy aggregate access returns `upgrade_required`; suite keyword search
continues through selective modular queries.

`npm run test:operations` checks parallel edits, stale items, duplicate/lost-response
creates, moves, final-board/list invariants, injected rollback failures, query
footprints, HTTP writes, change continuations and the legacy bridge. The suite MCP
integration command additionally exercises edit/retry/move/conflict on the actual
transport. Browser operation queuing and offline reconciliation are KAN-05 work.
