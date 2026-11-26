# OpenOak

OpenOak is a productivity suite licensed under AGPL-3.0-or-later. This is the
single source repository for the apps, Account service, MCP server, and websites.
The earlier app and website repositories are historical archives.

## Applications

| Workspace | Product | Hosted service |
| --- | --- | --- |
| `apps/account` | OpenOak Account | https://account.openoak.org |
| `apps/todo` | OpenTodo | https://todo.openoak.org |
| `apps/kanban` | OpenKanban | https://kanban.openoak.org |
| `apps/outline` | OpenOutline | https://outline.openoak.org |
| `apps/mcp` | OpenOak MCP | https://mcp.openoak.org |

Each app can be deployed separately from this repository. Todo, Kanban and
Outline support local accounts and a dedicated PostgreSQL database. The hosted
suite uses shared Account authentication. Source availability does not grant
access to hosted accounts, data or infrastructure.

App installation, update notices and offline capabilities are described in
[PWA support](docs/PWA.md). Kanban supports saved boards and queued edits offline;
Todo and Outline require a connection to load and save their data.

## Run an app

Use Node.js 22.x (22.18.0 or later), npm, and PostgreSQL 17. Clone the complete
repository. The apps use `shared/` and the root npm lockfile.

Follow [Self-hosting](docs/SELF_HOSTING.md) for environment setup, installation,
migrations, build and startup. Self-hosting is community supported: one app on
its own is the simple path, the shared suite is advanced. Local app authentication does not require a
hosted OpenOak account, Neon, Vercel, or Resend.

For development after setup:

```sh
npm run dev:todo
npm run dev:kanban
npm run dev:outline
```

Run the command for the app you want. For Account and the connected apps, see
[Run the shared suite](docs/SELF_HOSTING.md#run-the-shared-suite).

## Websites

`websites/openoak`, `websites/opentodo`, `websites/openkanbanboard` and
`websites/openoutline` contain the static public websites. They deploy separately
from the applications. The production Vercel projects already use these paths.

## Contributing and releases

Read [Contributing](CONTRIBUTING.md), [Security](SECURITY.md),
[Code of conduct](CODE_OF_CONDUCT.md),
[Release and recovery](docs/RELEASE.md), and [Database architecture](docs/DATABASE.md).
Submit app, website, infrastructure and shared-code changes here.

Earlier per-app repositories are archived; their code lives here under `apps/`
and `websites/`. Independent app deployment remains supported.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE). This license applies to source code;
the hosted service has separate terms and infrastructure.

The bundled Inter font uses the SIL Open Font License 1.1. The
`@fontsource-variable/inter` package includes the font's license and attribution.
