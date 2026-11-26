# OpenTodo Website

Static marketing and legal website for OpenTodo, served at https://opentodo.org/.

Application source: https://github.com/open-oak/openoak/tree/main/apps/todo

The page also ships from [`websites/openoak/todo`](../openoak/todo/)
at https://openoak.org/todo/. Keep shared copy in sync and run
`npm run check:sites` from the repository root.

## Contents

- Responsive landing page in `index.html`
- Legacy `/legal` and `/legal.html` routes redirect to the canonical OpenOak policy
- Shared styling in `style.css`, browser behavior in `main.js`
- SEO/PWA metadata via `robots.txt`, `sitemap.xml`, `site.webmanifest`, `llms.txt`
- Screenshots, icons, and wallpaper assets in `public/`

No build step, no cookies, no analytics, no tracking scripts.

## Local preview

```bash
python3 -m http.server 8000
```

## License

AGPL-3.0-or-later

The website is deployed independently from the `websites/opentodo` workspace
in the OpenOak monorepo.
