# OpenOak Website

Static site for `openoak.org`. No build step, no cookies, no analytics, no
tracking scripts.

Suite source: https://github.com/open-oak/openoak

## Contents

- `index.html`, `styles.css`, `main.js` — the OpenOak hub page
- `todo/`, `outline/`, `kanban/` — product landing pages served at
  `openoak.org/todo/`, `/outline/`, and `/kanban/`, each with its own
  `index.html`, `style.css`, `main.js`, and `public/` assets
- `legal/` — privacy policy and terms (`privacy.html` and `terms.html` at the
  root are the older standalone versions)
- `llms.txt`, `robots.txt`, `sitemap.xml`, `favicon.ico`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `assets/`

The product pages also ship on their own domains from
[`websites/opentodo`](../opentodo/), [`websites/openoutline`](../openoutline/), and
[`websites/openkanbanboard`](../openkanbanboard/). Apply shared copy changes to
both versions and run `npm run check:sites` from the repository root.

## Local preview

Open `index.html` directly in a browser, or serve the directory with any static
file server:

```bash
python3 -m http.server 8000
```

The website is deployed independently from the `websites/openoak` workspace in
the OpenOak monorepo.
