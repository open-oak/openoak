# OpenKanban Website

Static product landing page for OpenKanban, served at
https://openkanbanboard.org/.

Application source: https://github.com/open-oak/openoak/tree/main/apps/kanban

The page also ships from [`websites/openoak/kanban`](../openoak/kanban/)
at https://openoak.org/kanban/. Keep shared copy in sync and run
`npm run check:sites` from the repository root.

No build step, no cookies, no analytics, no tracking scripts.

## Local preview

```bash
python3 -m http.server 8000
```

## License

AGPL-3.0-or-later

The website is deployed independently from the `websites/openkanbanboard`
workspace in the OpenOak monorepo.
