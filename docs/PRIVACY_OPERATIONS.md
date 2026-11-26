# Privacy operations

The canonical public policy is `websites/openoak/legal/index.html`. Review this
runbook whenever a processor, database region, logging setting, or deletion
behavior changes.

## Verified account-deletion request

1. Accept the request at `openoaksoftware@proton.me` from the email address on
   the account. If the sender cannot use that address, verify control of the
   account before continuing.
2. Record an internal request ID, receipt date, verification date, central user
   ID, and the 30-day completion deadline. Do not copy user content into the
   request record.
3. Confirm the current Neon backup state and record that the request may remain
   in protected backups until the configured retention expires.
4. Use the shared-suite deletion service, not a root-row-only SQL procedure.
   First run `npm run privacy:delete -- --user-id ID` with the verified central
   user ID and the operator environment configured as below. This runs the
   complete procedure in a transaction and rolls it back for review.
5. Review the account ID and the request. Then run the same command with
   `--confirm-delete ID` to commit. Record the returned result and timestamp.
   Stop on any error; the transaction rolls back. Do not disable Kanban's
   legacy fence or ignore foreign-key errors.
6. After committing, verify the user can no longer authenticate and no active
   product root records remain. Record only counts, time, request ID, and result.
7. Confirm completion to the requester. Do not promise deletion from provider
   backups earlier than their configured expiration.

Never identify the account by an unescaped email in ad-hoc SQL. Use a
parameterized query or the database console's bound-variable support.

## Shared-suite deletion setup

The self-service page is `/settings` on Account. It requires the current password
and typed account email, and limits password attempts to five per 15 minutes.
All Account sessions and OAuth access are revoked by deletion. MCP also checks
that both the account and client still exist on every authenticated request.

This atomic procedure supports the four schemas in one PostgreSQL database.
Install each app's current migrations first. In the operator environment, set:

```dotenv
ACCOUNT_DATABASE_URL="postgresql://.../suite"
ACCOUNT_DELETION_SCHEMAS='{"account":"auth","todo":"todo","outline":"outline","kanban":"kanban"}'
```

Run `npm run privacy:install-links`. This adds and validates cross-schema account
foreign keys. It does not delete content. The keys prevent an unfinished request
from recreating product data after its account is deleted. Installation fails
and rolls back if existing product owners do not match central accounts; resolve
that mismatch before enabling deletion. Do not invent replacement accounts.

After verification, set the same `ACCOUNT_DELETION_SCHEMAS` on the Account
deployment to enable the form. The service verifies the links before every
deletion. Separate databases require an installation-specific coordinated
procedure; leave this setting unset and use a verified support request there.

The service removes owned lists, created tasks (including those moved into
another person's list), notes, deleted-item recovery copies, owned Kanban
boards, retained identities, changes, receipts, rollback snapshots, transition
state, memberships, sessions and account tokens. It clears other users' selected
board references and removes the departing user's private flags from remaining
task recovery snapshots. Other owners' content and profiles remain.

Kanban cleanup holds the same owner advisory lock as normal writes. It removes
the owner's transition before deleting the compatibility document, so the
normal legacy fence remains enabled. All changes commit together.

## Signup abuse controls

- Account auth endpoints use database-backed rate limits (`RateLimit` table),
  so all serverless instances share one count per IP and path. Rules live in
  `apps/account/lib/signup-protection.ts`. Better Auth matches paths without
  the `/api/auth` prefix.
- Verification and password-reset email is limited to 3 per address per 10
  minutes. The cooldown key is a SHA-256 hash of the address, not the address.
- On Vercel, Vercel BotID checks sign-up, sign-in, password-reset requests and
  verification resends. Set `BOTID_ENABLED=false` to turn it off.
- A daily job (`/api/cron/cleanup-unverified`, `CRON_SECRET` bearer token)
  deletes accounts that stay unverified for 7 days, and expired tokens. The
  public policy states the 7-day rule; update both together.
