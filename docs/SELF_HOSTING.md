# Self-host OpenOak

Self-hosting is community supported. Running one app on its own is the
supported path. The shared suite with OpenOak Account is advanced. Ask
questions and report problems in GitHub issues.

Use Node.js 22.x, version 22.18.0 or later, npm, PostgreSQL 17, and OpenSSL.
The test setup used Node.js 22.18.0 and npm 10.9.3. Run `nvm use` from the
repository root if you use nvm. The first install needs access to the npm
registry. The app builds use bundled fonts.

## Quick start with one app

Todo, Kanban, and Outline can run with their own local accounts. Each
standalone app needs a dedicated database. Local signup needs no mail service.

1. Clone the complete repository. Run the commands from its root.

   ```sh
   git clone https://github.com/open-oak/openoak.git
   cd openoak
   ```

2. Open `psql` as a PostgreSQL administrator. Create a login role and give it
   ownership of an empty database. Use `open_kanban` or `open_outline` in place
   of `open_todo` for the other apps.

   ```sql
   CREATE ROLE openoak_app LOGIN;
   \password openoak_app
   CREATE DATABASE open_todo OWNER openoak_app;
   ```

3. Run the [bootstrap script](../scripts/self-host.sh) from Bash. Enter a direct
   URL such as `postgresql://openoak_app:PASSWORD@127.0.0.1:5432/open_todo`.
   Percent-encode any reserved URL characters in the password.

   ```bash
   read -r -s -p 'PostgreSQL connection URL: ' OPENOAK_DATABASE_URL
   printf '\n'
   export OPENOAK_DATABASE_URL
   ./scripts/self-host.sh todo 3000
   ```

   The script writes the app's `.env` with a generated secret. It installs
   dependencies, applies migrations, builds, and starts the app on loopback.
   If the file already exists, check its database, auth mode, and
   `BETTER_AUTH_URL` before you run the script. The script reuses the file and
   its secret. For independent accounts, leave `ACCOUNT_DATABASE_URL`,
   `ACCOUNT_DATABASE_SCHEMA`, `NEXT_PUBLIC_ACCOUNT_URL`, and
   `AUTH_COOKIE_DOMAIN` unset.

4. Open <http://localhost:3000/login>. Select Sign up, create an account, and
   save a task. Reload the page to check that the task is still there. To run
   another app, pass `kanban` or `outline` and choose an available port.

Use `.env` in each workspace. Prisma loads this file for migrations. You can
also set the values in the process environment. Next.js reads `.env.local`
during build and startup, while Prisma skips that file.

## Run the shared suite

This setup is advanced and best effort. It is how openoak.org runs, so the
steps are tested, but we cannot help with your domains, cookies or mail
provider. Start with one app if you only need your own tasks, boards or notes.

1. Provision a new database, such as `openoak_suite`, with the SQL above.
   Its migration role must be able to create schemas. Each app keeps its own
   migration history in its own schema.

2. Copy each workspace's `.env.example` to `.env`. Set the values in the table.
   Replace `BASE` with the full database URL, including credentials. Leave
   app-specific database aliases unset when you use the generic variables.

   | Workspace | `DATABASE_URL` | `DIRECT_URL` | `DATABASE_SCHEMA` | `BETTER_AUTH_URL` | `ACCOUNT_DATABASE_URL` | `ACCOUNT_DATABASE_SCHEMA` |
   | --- | --- | --- | --- | --- | --- | --- |
   | `apps/account` | BASE | BASE?schema=auth | auth | `http://localhost:3003` | unset | unset |
   | `apps/todo` | BASE | BASE?schema=todo | todo | `http://localhost:3000` | BASE | auth |
   | `apps/kanban` | BASE | BASE?schema=kanban | kanban | `http://localhost:3001` | BASE | auth |
   | `apps/outline` | BASE | BASE?schema=outline | outline | `http://localhost:3002` | BASE | auth |

   `DATABASE_SCHEMA` selects the runtime schema. Append `?schema=NAME` to
   `DIRECT_URL` for migrations outside `public`. Use `&schema=NAME` if the
   URL already has a query string. The migration command uses the URL
   parameter, so set both values. `ACCOUNT_DATABASE_URL` turns on shared auth
   in the product apps. See [Database architecture](DATABASE.md).

3. Generate one secret with `openssl rand -base64 32`. Set it as
   `BETTER_AUTH_SECRET` in all four workspaces and add these settings to each.

   ```dotenv
   AUTH_COOKIE_PREFIX="my-openoak"
   OPENOAK_HOME_URL="http://localhost:3003"
   OPENOAK_ACCOUNT_URL="http://localhost:3003"
   OPENOAK_TODO_URL="http://localhost:3000"
   OPENOAK_KANBAN_URL="http://localhost:3001"
   OPENOAK_OUTLINE_URL="http://localhost:3002"
   NEXT_PUBLIC_ACCOUNT_URL="http://localhost:3003"
   MCP_RESOURCE_URL="http://localhost:3004"
   ```

   Set `NEXT_PUBLIC_ACCOUNT_URL` before the build. Use `localhost` in every
   browser URL and leave `AUTH_COOKIE_DOMAIN` unset. The browser can share the
   host-only cookie across ports. Leave `AUTH_REDIRECT_HOSTS` unset on Account.
   If present, it replaces the allowlist derived from the configured origins.
   A redirect to an origin outside the allowlist goes to Account's `/apps`.
   The MCP URL reserves a port for a separate service.

4. Configure Account mail. Account requires email verification. Set
   `RESEND_API_KEY` and set `RESEND_FROM` to a sender on a domain you verified
   with Resend. If the server has no mail transport, signup returns
   “Email is not configured on this server.”

   For a local test, you can use `EMAIL_TRANSPORT=log` with the Account
   development server. It prints verification and reset links to the server
   terminal. Use a loopback bind and keep these links private. Account refuses
   the log transport in production mode.

5. Install, migrate, and build. Run these commands from the root.

   ```sh
   npm ci
   for app in account todo kanban outline; do
     npm run migrate:deploy --workspace="@openoak/$app" || exit 1
     npm run build --workspace="@openoak/$app" || exit 1
   done
   ```

6. Start each service in a separate terminal. With Resend configured, use:

   ```sh
   npm run start --workspace=@openoak/account -- --port 3003 --hostname 127.0.0.1
   npm run start --workspace=@openoak/todo -- --port 3000 --hostname 127.0.0.1
   npm run start --workspace=@openoak/kanban -- --port 3001 --hostname 127.0.0.1
   npm run start --workspace=@openoak/outline -- --port 3002 --hostname 127.0.0.1
   ```

   For the local log transport, use this Account command instead:

   ```sh
   EMAIL_TRANSPORT=log npm run dev --workspace=@openoak/account -- --port 3003 --hostname 127.0.0.1
   ```

7. Open <http://localhost:3000/tasks> and follow the prompts to create a shared
   account. Open the verification link from your email or the Account
   terminal. Sign in and check that Account returns you to Todo. Open Kanban
   and Outline in the same browser to check that both apps share the session.

## Public deployment

1. Put an HTTPS reverse proxy in front of the app servers. Forward the public
   host and protocol. Set each `BETTER_AUTH_URL` to its public HTTPS origin
   and update the suite URLs before you build. For shared auth, use subdomains
   of one parent domain and set the same `AUTH_COOKIE_DOMAIN` on Account and
   the apps, for example `.example.org`. Keep preview data separate.

2. Set `NEXT_PUBLIC_LEGAL_URL` before building Todo, Kanban, or Outline to link
   to your own terms and privacy information. If you leave it unset, the apps
   link to `https://openoak.org/legal/`.

3. Use verified TLS for remote PostgreSQL connections. This includes Compose
   hosts such as `db`. The database certificate must match the hostname.
   Use `POSTGRES_SSL_CA` for a private certificate authority. Only loopback
   hosts can use `POSTGRES_SSL_MODE=disable`. See the
   [PostgreSQL TLS policy](DATABASE.md#postgresql-tls-contract).

4. Set `CRON_SECRET` on Account. Once a day, send a
   `GET /api/cron/cleanup-unverified` request with the
   `Authorization: Bearer $CRON_SECRET` header. It deletes accounts that
   remain unverified for seven days. Vercel schedules this request and runs
   BotID on its platform. Other hosts use the database rate limits.

## MCP

Self-hosting MCP is an advanced setup and is currently unsupported. The
[MCP server](../apps/mcp/README.md) is a separate OAuth resource. It needs
an Account issuer and access to the product databases. The hosted MCP
service only accesses the hosted suite.

## Upgrade and recovery

1. Back up PostgreSQL and keep the previous source revision and configuration
   in a secure location. Rehearse restoration against a disposable database.
   Item exports are useful for individual records. Take a full database backup
   for an upgrade.

2. Check the app's migration notes. Install the locked dependencies, apply
   `migrate:deploy` for each affected workspace, build, and restart. Use
   `migrate:deploy` for production migrations. A code rollback leaves applied
   migrations in place. See [Kanban recovery and legacy migration](../apps/kanban/docs/SELF_HOSTING.md).

3. Check login and persistence after restart. See
   [Contributing](../CONTRIBUTING.md) for source checks and disposable
   database tests.

Todo and Outline have a Deleted items view in Settings. Restore keeps the
original item ID and checks current access. In a shared Todo list, editors
can restore tasks and the owner can permanently remove recovery copies.
Deleting a list removes its task recovery copies. If you delete an Outline
folder, you can restore its deleted notes as unfiled notes. Recovery copies
have no automatic purge schedule. Account deletion includes them.

Outline's JSON export includes settings, folders, active and deleted notes,
their stored bodies, and a Markdown representation. Keep exports private.
Outline currently provides export only. For shared account deletion, follow
[Privacy operations](PRIVACY_OPERATIONS.md) and install the validated account
foreign keys before enabling the form.
