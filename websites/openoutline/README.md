# OpenOutline Website

Static product landing page for OpenOutline, served at https://openoutline.org/.

Application source: https://github.com/open-oak/openoak/tree/main/apps/outline

The page also ships from [`websites/openoak/outline`](../openoak/outline/)
at https://openoak.org/outline/. Keep shared copy in sync and run
`npm run check:sites` from the repository root.

No build step, no cookies, no analytics, no tracking scripts.

## Local preview

```bash
python3 -m http.server 8000
```

## License

AGPL-3.0-or-later

The website is deployed independently from the `websites/openoutline`
workspace in the OpenOak monorepo.
