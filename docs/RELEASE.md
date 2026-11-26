# Release and recovery

This monorepo is the only maintained source for hosted and self-hosted releases.
The earlier app and website repositories are historical archives. A release never
requires a sibling repository. See [self-hosting](SELF_HOSTING.md).

## Normal release

1. Open a pull request to `main` and wait for the required CI and migration
   checks.
2. Review the Vercel Preview. Preview migrations remain disabled until its
   database is proven isolated.
3. Merge the pull request. Vercel deploys each affected project from `main`.
   Database-owning projects apply their own additive migrations before build.
4. Confirm the GitHub Production health workflow and the relevant Vercel
   deployment are green.
5. Check the affected `/health` endpoint and one representative read flow.
6. For an authenticated app, confirm an anonymous request is redirected to the
   Account login page and then complete one normal sign-in.

The Production health workflow runs after deployments or by manual request.
It has no schedule. A Vercel build or a local check is not a substitute for a
green CI run.

## Manual rollback

Use rollback only after confirming the current deployment is the failing one.
Migrations are not reversed; the previous build must remain compatible with
every applied migration.

```sh
vercel rollback
vercel rollback status
```

Run the commands from the linked project directory with the correct Vercel
scope. Afterward, check its `/health` endpoint and the affected user flow. Do
not use `git reset`, delete migration rows, or run down migrations during an
incident.

## Outline Folder migration verification

Before closing the migration incident, confirm
`20260824120000_add_note_folders` is recorded in the Outline schema's
`_prisma_migrations` table and that the `Folder` table and nullable
`Note.folderId` column exist. Then test folder create, rename, note movement,
and deletion against the deployed application.

## Backups

Recovery is best effort; OpenOak does not promise a numerical RPO or RTO. In
the Neon console, record the active plan, backup/restore-window setting, oldest
available restore point, database region, and the date checked. Keep the
restoration procedure with the service credentials. Use a disposable database
for restore rehearsals.
