# Shared boards (COL-01–03)

OpenKanban supports an owner and trusted editors. Editors can change board
appearance, lists, cards and ordering. Only the owner can delete/reset the board,
manage invite links or remove members. A member can leave. There are no viewer
roles, ownership transfer, comments, assignments or presence features.

## Access and identity

All v2 discovery, detail/chunk reads, changes, search and item writes use the same
owner/member boundary. A write locks the board before checking membership; join,
rotation, disable and removal use that lock too. Even an exact successful receipt
retry must pass current access checks. Receipts distinguish actor from board owner.
The request epoch belongs to the actor's account; both actor and owner must be in
modular mode. Owner recovery uses the existing protected internal executor.

Hosted installations resolve people through the configured shared account database;
standalone installations use their local auth database. A new account initializes
its own empty board, profile, epoch and recovery checkpoint atomically. Existing
legacy accounts are not implicitly converted: joining explains that their boards
need an explicit storage upgrade. No owner data/state is copied to an invitee.

Joined boards use their public board key for browser navigation, avoiding the
historical `main` ID shared by many accounts. Owner links retain their local IDs;
public-key links are resolved for owners at page entry. `selectedBoardKey` is a
personal preference. The existing owned `activeBoardKey` and its foreign key remain
intact for compatibility and recovery.

## Invitations

Share board is in the board menu. An owner creates/copies, replaces or disables a
random 144-bit invite token. GET only previews the board name. The recipient signs
in or signs up, returns to the invitation, and explicitly chooses Join board.
Repeated joins are safe. Member lists are paginated, 50 people at a time; editors
cannot enumerate other members or retrieve the invite token.

Disabling/replacing a link stops joins through that link and keeps existing members.
Removal stops current membership. A removed member can explicitly join again if
they still have an active link; replace/disable the link to prevent that. There is
no email sending or public board directory.

## Synchronization, offline work and backup

The existing 15-second polling, focus/visibility refresh and durable operation
queue are retained. Independent edits merge through individual versions; same-field
conflicts keep local drafts until explicitly discarded. Uncertain responses replay
the exact operation ID/payload. Membership is checked again at replay time.

An authoritative catalogue removes unavailable boards from navigation and normal
cache. Already-local unsent intents move into a separate durable recovery archive;
they are never retried automatically. Other boards continue syncing. Offline
network failure alone does not remove a board. A device cannot discover revocation
until it reconnects; previously downloaded/exported copies cannot be remotely erased.

Settings exports only owned boards. Export this board explicitly exports one
currently readable board, including a joined board. Imports create fresh owned
copies. JSON backups do not transfer membership, invite tokens or ownership.
Database backups must include `KanbanBoardMember`, `KanbanBoard.inviteNonce`,
`KanbanProfile.selectedBoardKey`, identity/version/receipt tables and the relevant
auth database. Owner checkpoint/rollback retains membership and tokens in modular
rows; shared access is unavailable while the owner is in legacy mode. Re-cutover
restores access without resetting item versions. Deleted boards lose memberships.

## Rollout and rollback

1. Back up the Kanban schema and restore it into an isolated database. Apply
   `202609080001_board_sharing` twice and compare existing rows. This migration is
   additive: a member table and nullable invite/selection columns. No old columns
   or constraints are removed.
2. Run `test:migration`, `test:operations`, `test:browser-sync`, `test:sharing` and
   the MCP `test:kanban` integration command against disposable PostgreSQL.
3. Build, then run `tests/integration/kanban-ui.test.mjs` and `test:sharing-ui`.
   The latter uses isolated desktop/mobile accounts, real auth and invitations,
   shared-account cookie/database mode, conflicts, offline reload and removal.
4. Verify standalone product parity. Apply the migration before serving the new
   Kanban and MCP binaries. Stage both deployments, then promote Kanban and MCP.
   Browser reads negotiate sharing metadata. Older tabs with only owned boards
   receive their original response format; tabs with joined boards are asked to
   reload before using role-dependent controls. Current read validators accept
   additive fields while validating known fields. Incompatible responses pause
   sync with a reload action, preserving prepared operations and drafts. They are
   not reported as offline, and failed saves do not restart the 650 ms edit timer.
5. Verify authenticated deployed browser/MCP reads and scoped disposable shared-board
   edits. Health alone does not exercise the database or membership.

For application rollback retain the additive schema and deploy the previous
binaries. Shared-board UI/access is then unavailable; do not drop the new table or
columns. The prior owner-only binary cannot administer membership. Capture a fresh
backup before any data restore and reconcile subsequent edits separately. Suite
and standalone use the same product implementation with their existing auth/build
adapters; no migration or deployment of Todo/Outline is needed.
