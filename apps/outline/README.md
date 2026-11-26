# OpenOutline

Maintained in the [OpenOak monorepo](https://github.com/open-oak/openoak/tree/main/apps/outline).
The earlier separate repository is a historical archive.

The canonical hosted app is `https://outline.openoak.org`. The branded entry
domain `https://app.openoutline.org` permanently redirects to the canonical
host while preserving the requested path and query string.

OpenOutline is the notes app in the OpenOak ecosystem, deployed at
`outline.openoak.org`. Independent installations use local accounts. Shared Account authentication is optional. Notes, flat folders, ordering, note colours, and
appearance settings live in this app's own database, keyed by the central
user ID.

User-created items remain notes; OpenOutline is the product name everywhere.

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Prisma 7 on PostgreSQL,
Better Auth. Package manager: **npm** (`package-lock.json`).

## Setup and checks

Use Node.js 22.x (22.18.0 or later), npm, and PostgreSQL 17. Keep the complete monorepo
checkout and its root npm lockfile. Follow [Self-hosting](../../docs/SELF_HOSTING.md)
for environment variables, local accounts, migrations, build and startup.

From the repository root, after setup:

```sh
npm run dev:outline
npm test --workspace=@openoak/outline
npm run typecheck --workspace=@openoak/outline
npm run lint --workspace=@openoak/outline -- --max-warnings=0
```

## Project layout

- `app/` — page, server actions, styles
- `components/notes-app.tsx` — state, saving, and layout
- `components/notes/` — sidebar, editor, settings menu, background, dialogs
- `lib/notes-view.ts` — ordering, search, excerpts, and server-response merging
- `lib/note-save-queue.ts` — per-note debounced autosave scheduling
- `lib/notes-data.ts` — session-scoped data loading and validation
- `lib/folder-validation.ts` — normalized, case-insensitive folder naming
- `tests/` — `node --test` coverage of the two `lib` modules above

## Saving

Edits autosave on a short debounce, per note. Patches for the same note merge
into one request; patches for different notes are independent, so deleting one
note never discards another note's unsaved text. Hiding or closing the tab
flushes anything still waiting.

Note order is sent as a complete list of ids — the server rejects a partial one,
since renumbering part of a collection leaves two notes sharing a position.
Reordering a note that is still being created is held until its real id arrives.

A failed save is reported in the editor with a retry, not just a tooltip, and
the text stays queued until it succeeds.

## Large collections

The initial request returns one 40-note metadata page and only the selected
note's body. Previous/next controls keep the DOM bounded, off-screen rows use
browser content visibility, and selecting a note fetches its body on demand.
Search runs on PostgreSQL and returns the same bounded page contract instead of
filtering an unbounded browser snapshot.

Manual reordering is available while the complete collection fits on one page.
Larger collections keep their stored order without renumbering unseen notes.


## Interaction notes

- Reorder notes by dragging (a line shows where the note will land), with the
  arrow buttons on each row, or with `Alt`+`Up`/`Down` while a note is focused.
- Search: `Escape` clears it; results show a count; the empty state differs for
  "no notes yet" and "no matches".
- Dialogs close on `Escape`, keep focus inside while open, and return focus to
  whatever opened them.
- Each note has its own colour, set in the editor footer and shown in the
  sidebar.

## License

AGPL-3.0-or-later.

See [Contributing](../../CONTRIBUTING.md) and
[Database architecture](../../docs/DATABASE.md).
