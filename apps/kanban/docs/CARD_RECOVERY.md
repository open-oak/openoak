# Card archive and recovery

Archive removes a modular card from the active board and retains its identity,
content and original list indefinitely. Completing a card remains independent
of archiving it. The board menu opens Archive: search titles/notes, inspect
retained content in the shared card detail view, restore cards, or use the
visible Delete action beneath each preview. Date groups help scanning. The
350px desktop sidebar keeps the board usable; mobile uses a full-screen panel.
Restore keeps the panel open and preserves search and loaded pages. A missing original list requires a choice
of destination in the browser. The panel is full-screen on mobile.

Archiving needs no confirmation. A single floating acknowledgment offers Undo
for the recent group of archived cards. It expires after eight seconds and
pauses while hovered, focused or undoing. Archive remains available afterward.
Routine saving and offline status use the existing sync indicator. Save errors,
conflicts, incompatible responses and recovered unsent edits remain prominent.

Members can archive and restore. Permanent deletion requires the board owner,
a current archive token (`deletionId`) and `confirmPermanent: true`, with an
explicit browser confirmation. Board deletion permanently removes its archive.
List deletion leaves archived cards recoverable. Board/list archiving remains
separate future work.

## Compatibility and rollback

The existing `KanbanCardTrash` table and preservation trigger remain unchanged.
All previously removed cards appear in Archive. No data migration or cleanup
is required. New clients send `card.archive`; `card.delete` remains an exact
compatibility alias that archives. `card.restore` preserves content, creation
time and identity, appending to the original or explicitly chosen list. Existing
API callers retain the first-remaining-list fallback. `card.purge` permanently
removes an archived card. Never reinterpret old delete calls as permanent.

Version checks, operation receipts, authorization and archive tokens retain
existing guarantees. Old tabs can keep using Trash during rollout. Deploy
updated servers before clients using the new archive operation. Older servers
reject the new operation safely; retain its queued request and upgrade the
server before retrying. Rollback retains all archived data, but older code
cannot import version 2 backups or process queued `card.archive` requests.
Legacy rollback remains blocked while the archive contains cards.

Restoration requests use the durable edit queue. An unsent archive can be undone
offline. An uncertain server response must replay its exact request before Undo
resolves. Multiple recent archives can be undone together. The archive panel
waits for confirmation before removing a row; failed requests remain queued and
visible for retry. Existing membership is rechecked for duplicate receipts.

## MCP and exports

`kanban_v2_list_archive` supports bounded pagination and title/content search.
`kanban_v2_get_card` with `archived: true` reads retained content; oversized cards
use `kanban_v2_read_detail_chunk` with the same flag. Archive-token-scoped cursors
reject a later archival of the same card. `kanban_v2_list_trash` remains available
for compatibility. Use `kanban_v2_apply_operation` with `card.archive`,
`card.restore`, `card.purge` or `archive.purge` for changes.

Full version 2 board backups include active and archived cards. Imports preserve
archive state in a new private board. Version 1 files remain readable. See
[Board export and import](BOARD_ARCHIVE.md). Legacy document accounts require
modular cutover for archive support; imports with archived content are blocked
there to prevent silent loss.

## Delete all archived cards

The owner can select Delete all archived cards in the archive footer. The
confirmation counts the entire board archive, including entries hidden by
search, and names the board. Cancellation leaves the archive unchanged.

`archive.purge` requires `confirmPermanent: true` and `expectedRevision` from
the confirmed archive snapshot. It holds the authorized board lock and deletes
the whole archive in one transaction. Any intervening board change rejects the
operation; the user must refresh and confirm again. Active cards, other boards,
and entity identities remain unchanged. Large change sets use the existing
bounded change cursor. Receipts make exact retries safe. The durable browser
queue preserves the confirmed revision across offline retries and never
automatically replaces it with a newer revision.
