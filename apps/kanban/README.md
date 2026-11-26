# OpenKanban

Maintained in the [OpenOak monorepo](https://github.com/open-oak/openoak/tree/main/apps/kanban).
The earlier separate repository is a historical archive.

The canonical hosted app is `https://kanban.openoak.org`. The branded entry
domain `https://app.openkanbanboard.org` permanently redirects to the canonical
host while preserving the requested path and query string.

OpenKanban is the board app in OpenOak. Independent installations use local
accounts and their own PostgreSQL database. Shared Account authentication is
optional. New accounts use modular board/list/card storage, durable offline
operations and per-card conflict checks.

See [card recovery](docs/CARD_RECOVERY.md), [board archives](docs/BOARD_ARCHIVE.md)
and [self-hosting](../../docs/SELF_HOSTING.md) for the current behavior and setup.

## Moving tasks

Tasks keep an explicit position in their list. Drag a card onto another card to
drop it above or below that card, or onto empty list space to append it. Boards
saved before ordering existed keep the order they were stored in.

Every card also carries up/down controls, so reordering never depends on being
able to drag. Without a pointer: focus a card and use `Alt` with the arrow
keys — up and down reorder within the list, left and right move the task to the
neighbouring list. `Enter` or `Space` opens task details, which also has
explicit up/down controls. Each move is announced to screen readers with the new
position.

Dialogs close on `Escape`, keep focus inside while open, return focus to
whatever opened them, and only close on a backdrop click that also started on
the backdrop. Destructive confirmations focus Cancel. See the card recovery guide for archive, restore and permanent-deletion behavior.

On touch screens, hold a card briefly before dragging; a normal swipe scrolls
the board as usual.

## Project layout

- `app/` — page, board API route, and `styles/` (feature stylesheets imported by
  `globals.css` in cascade order)
- `components/kanban-app.tsx` — state, drag handling, layout
- `components/kanban/` — presentation components, dialog focus, and the cloud
  sync hook
- `lib/kanban-data.ts` — board validation, migration, and task-order rules
- `lib/kanban-board.ts` — pure board mutations
- `lib/kanban-drag.ts` — drop-target geometry
- `lib/kanban-reducer.ts` — the single entry point for board state changes
- `tests/` — `node --test` coverage of the modules above

## Setup and checks

Use the complete monorepo and its root npm lockfile. Follow
[Self-hosting](../../docs/SELF_HOSTING.md) for environment setup, local accounts,
migrations, build and startup. The app API never changes database schemas at
request time.

From the repository root, after setup:

```sh
npm run dev:kanban
npm test --workspace=@openoak/kanban
npm run typecheck --workspace=@openoak/kanban
npm run lint --workspace=@openoak/kanban -- --max-warnings=0
```

Read [Contributing](../../CONTRIBUTING.md) before changing data ownership,
retries, recovery or shared behavior.

## License

AGPL-3.0-or-later.

Architecture and release guidance live in the root [docs](../../docs/).
