# OpenOak Account

Central account service for the OpenOak app ecosystem.

## Domains

- `openoak.org`: marketing hub and app landing pages
- `account.openoak.org`: login, signup, password reset, email verification, app overview
- `todo.openoak.org`: OpenTodo
- `outline.openoak.org`: OpenOutline (structured notes and outlines)
- `kanban.openoak.org`: OpenKanban

## Auth Model

This app owns Better Auth identity tables and sets the session cookie for `.openoak.org`.
Apps keep their own product data and key it by the central account `User.id`.

Account accepts login and signup redirects to the configured suite origins.
`AUTH_REDIRECT_HOSTS` overrides this allowlist when set. Account sends users
with disallowed redirects to `/apps`.

## Setup

Follow [Run the shared suite](../../docs/SELF_HOSTING.md#run-the-shared-suite)
for database migrations, browser origins, mail transport, and the Account start
command. For HTTPS and remote PostgreSQL, see
[Public deployment](../../docs/SELF_HOSTING.md#public-deployment).

## License

AGPL-3.0-or-later.

See [Contributing](../../CONTRIBUTING.md).
