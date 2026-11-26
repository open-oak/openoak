# Board export and import

The JSON envelope is `format: "openkanban"`, `version: 2`, with `exportedAt`,
`activeBoardId` and `boards`. Each board includes name, appearance, ordered lists,
active `tasks`, and optional `archivedTasks`. Cards preserve title, full notes,
due date, color and position. Archived cards additionally carry an ISO UTC
`archivedAt` timestamp and retain their original list ID even if it was removed.
Lists preserve name, color and icon. Archived cards remain outside active counts.

Board actions offers Export this board; Settings exports owned boards. Members
can explicitly export a shared board. Export waits for pending edits to sync,
then reads active and archived content, verifying each board revision before
finishing. Concurrent changes abort the export for retry. Unsent edits remain
available as a separate device-recovery download. Memberships, invite links,
credentials and operation receipts are excluded from portable board backups.

The import preview names boards and counts lists, active cards and archived
cards. Each imported board receives a new identity owned by the importing user.
Card and list IDs are scoped to that new board; archived cards receive fresh
recovery tokens. Repeated imports create independent private copies, preserving
archive state and leaving source boards intact. Each board is committed in one
transaction; operation receipts make lost-response retries idempotent.

Version 1 files remain supported. Version 1 cannot carry archived cards. The
reader rejects unsupported fields/versions, duplicate identities across active
and archived cards, malformed content, invalid dates, missing active lists and
invalid active ordering. Archived cards may reference removed lists. Files must
fit 10 MiB and each board 2 MiB with envelope space reserved; exports exceeding
these limits fail explicitly. Nothing is silently truncated or discarded.

Legacy document mode retains explicit replace-current-boards confirmation for
active-only backups. Files with archived content are blocked until modular
storage is available. A database backup additionally retains accounts, sharing,
operation receipts and original audit timestamps.
