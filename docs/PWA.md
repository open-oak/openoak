# OpenOak progressive web apps

Todo, Kanban, Outline and Account each install from their own origin with a
stable manifest ID, standalone display, emoji launcher icons, a separate
maskable icon and an Apple touch icon. Their existing emoji SVG favicons remain
the browser icons: ✅ Todo, 📋 Kanban, 📝 Outline and 🌳 Account.

`shared/pwa/` owns the app metadata, install controls, offline templates and
service-worker behavior. Run `npm run generate:pwa` after changing the worker,
app descriptions or offline templates. Generated workers and public offline
pages are checked in so normal workspace builds and deployments need no extra
generation step. `npm run test:pwa` checks freshness, manifests, icon dimensions,
Chromium installation criteria, offline navigation, cache isolation and updates.
After building all four app workspaces, `npm run test:pwa:apps` checks their
production pages, HTTP headers, automatic registration, install controls,
iOS instructions and offline fallback accessibility. CI runs both suites.

Run `npm run generate:pwa:icons` with Playwright Chromium and the Noto Color Emoji
font installed to regenerate the PNGs. Maskable icons keep the glyph within the
central safe area and Apple icons use an opaque background. Existing Todo icon
URLs are updated too, for installed apps that retain older manifest metadata.

Service workers register in production on public and authenticated app pages.
Installation controls use the browser's install prompt where supported, with
Share / Add to Home Screen instructions on iOS. Standalone windows hide these
controls, and dismissals last for the browser session.
Account hides installation prompts, including the browser's automatic prompt.
Users can still install Account from their browser menu.

The worker cache contains public offline pages, icons and versioned static
assets. Account data, authenticated HTML, API responses, server actions and
mutation requests use the network. Legacy Todo HTML caches are removed when
the new worker activates. Runtime asset caches have a 96-entry limit. Worker
scripts use stable URLs with HTTP caching disabled and `updateViaCache: none`.

Kanban retains its public offline shell and device-persisted board/edit queue
in modular mode. The shell's scripts are cached before replacing its HTML.
Todo, Outline and Account provide a reconnect page for offline navigation;
their server-action editing and account management require a connection.
Open editors stay open through connection changes. Durable offline task/note
editing requires separate data synchronization work.

Updates install in the background and wait for existing app windows to close.
A notice asks users to finish their changes and close all windows for that app.
Workers never force a reload or skip the waiting phase. Updates are also checked
when an app returns to the foreground with a connection.

The marketing websites retain their separate landing-page manifests. MCP is a
backend service and has no installable UI.
