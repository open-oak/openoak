# Database architecture

The hosted OpenOak suite uses one PostgreSQL database with four independently
owned schemas:

| Application | Runtime schema | Migration URL schema |
| --- | --- | --- |
| Account | `auth` | `?schema=auth` |
| OpenTodo | `todo` | `?schema=todo` |
| OpenKanban | `kanban` | `?schema=kanban` |
| OpenOutline | `outline` | `?schema=outline` |

Each application retains its own Prisma client and migration history. Prisma's
runtime PostgreSQL adapter receives the schema name explicitly, while the
direct migration URL uses Prisma's `schema` query parameter. This keeps each
application's `_prisma_migrations` table isolated in its own schema.

## Environment variables

- Account: `DATABASE_URL`, `DIRECT_URL`, `DATABASE_SCHEMA=auth`
- Todo: `DATABASE_URL`, `DIRECT_URL`, `DATABASE_SCHEMA=todo`, plus
  `ACCOUNT_DATABASE_URL` and `ACCOUNT_DATABASE_SCHEMA=auth`
- Kanban: `KANBAN_DATABASE_URL`, `KANBAN_DIRECT_URL`,
  `KANBAN_DATABASE_SCHEMA=kanban`, plus the account variables
- Outline: `DATABASE_URL`, `DIRECT_URL`, `DATABASE_SCHEMA=outline`, plus the
  account variables

Use pooled Neon URLs for runtime variables and unpooled URLs for migration
variables. Append the application's `?schema=<name>` parameter to each direct
migration URL (or `&schema=<name>` when the URL already has a query string).

For a traditional self-hosted setup, separate databases remain supported.
Omit the schema variables (or set them to `public`) and use the same connection
URL for both runtime and migrations.

## PostgreSQL TLS contract

Every Account, Todo, Kanban, Outline, and MCP database adapter uses the same
transport policy:

- `localhost`, `127.0.0.1`, and `::1` default to `POSTGRES_SSL_MODE=disable`.
- Every remote host defaults to `POSTGRES_SSL_MODE=verify-full`, which verifies
  both the certificate chain and the requested hostname.
- `POSTGRES_SSL_MODE=disable` is rejected for remote hosts.
- `POSTGRES_SSL_CA` optionally supplies a custom PEM certificate authority. It
  may contain real newlines or escaped `\\n` sequences.

The runtime adapter removes SSL query parameters before passing an explicit TLS
object to `pg`. Migration URLs are normalized to `sslmode=disable` or
`sslmode=verify-full`. This also upgrades legacy hosted URLs using
`sslmode=require` and avoids the ambiguous `pg` compatibility warning.

The local URLs in every `.env.example` need no TLS variables. To exercise a
local PostgreSQL server configured for TLS, set
`POSTGRES_SSL_MODE=verify-full` and, when it uses a private CA, set
`POSTGRES_SSL_CA`.

### Rollout and rollback

Deploy this code with both TLS variables unset first. Loopback development
keeps working, while hosted databases immediately use verified TLS. Add
`POSTGRES_SSL_CA` only for databases whose certificate is not rooted in the
host's system trust store.

To roll back the explicit override, unset `POSTGRES_SSL_MODE` and
`POSTGRES_SSL_CA`; the safe automatic policy resumes. Before rolling the
application itself back to an older release, keep hosted URLs on
`sslmode=verify-full` so the previous adapter cannot reinterpret a legacy
`sslmode=require` value.

## Release rule

Each Vercel Production project runs `prisma migrate deploy` for its owned schema
before building application code. Prisma migration deployment is idempotent, and
the four projects own separate migration histories and PostgreSQL schemas.
Preview deployments skip migrations unless `PREVIEW_DATABASE_ISOLATED=true` is
set after an isolated Preview database has been verified. Never run
schema-changing SQL from request handlers.

Every migration must be additive and compatible with the previously deployed
application version. A code rollback does not roll back an already-applied
database migration. CI replays every migration history twice against temporary
PostgreSQL to prove clean installation and retry safety.

For OpenTodo collaboration, apply
`20260820120000_add_todo_collaboration` before the application release. The
migration is expand-only: it creates custom/default list classification,
membership and personal-state tables, backfills creator flags, and retains the
legacy task columns for rollback. The application dual-writes creator
My Day/Important state throughout the compatibility window. Detailed
verification and rollback SQL live in
`apps/todo/docs/TODO_COLLABORATION_MIGRATION.md`.
