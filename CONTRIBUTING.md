# Contributing to OpenOak

Submit app, website, and shared-code changes to the
[OpenOak repository](https://github.com/open-oak/openoak). Keep each change
focused on the behavior it affects. Follow the
[Code of conduct](CODE_OF_CONDUCT.md).

## Fresh checkout

1. Clone the repository and enter its root.

   ```sh
   git clone https://github.com/open-oak/openoak.git
   cd openoak
   ```

2. Use Node.js 22.x (22.18.0 or later). If you use nvm, run `nvm install`
   and `nvm use` to select the major version in `.nvmrc`.

3. Install dependencies, generate Prisma clients, and install the Chromium
   browser for Playwright.

   ```sh
   npm ci
   npm run generate
   npx playwright install chromium
   ```

   If Chromium reports missing Linux libraries, use
   `npx playwright install --with-deps chromium`.

4. Run the repository checks from the root.

   ```sh
   npm run lint
   npm run typecheck
   npm test
   npm run check:sites
   npm run check:security
   ```

5. Follow [Self-hosting](docs/SELF_HOSTING.md) to configure and run an app.
   Use `npm run build --workspace=@openoak/kanban` for a production build of
   one workspace, or `npm run build` after configuring all the workspaces.
   Test changes to `shared/` in each app they affect.

## Optional database integration tests

Provision a dedicated test database using the [database setup steps](docs/SELF_HOSTING.md#quick-start-with-one-app).
Set the relevant test URL to that disposable database. For example, run
the Kanban migration and operation tests with:

```sh
export KANBAN_TEST_DATABASE_URL='postgresql://openoak_app:PASSWORD@127.0.0.1:5432/openoak_test'
npm run test:migration --workspace=@openoak/kanban
npm run test:operations --workspace=@openoak/kanban
```

These tests create and drop schemas. See the
[CI migration job](.github/workflows/ci.yml#L46) for more test commands and
the `ACCOUNT_TEST_DATABASE_URL` and `SUITE_TEST_DATABASE_URL` settings.
Use synthetic data and keep integration tests away from production databases.

## Pull requests

Describe the problem, the resulting behavior, and the checks you ran.
Include migration and rollback notes when applicable. Keep credentials,
production data, and database dumps outside the repository. Send security
reports through the [private reporting instructions](SECURITY.md).

Preserve authorization, account ownership, local drafts, retry behavior, and
recovery. Add behavior tests when these guarantees change. Document changes
to the public API. See [Release and recovery](docs/RELEASE.md) for deployment
steps.
