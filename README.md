# duo-stock-alert

Personal iPhone Duo stock checker for the Apple Trafford Centre and Manchester Arndale stores, in the style of
iphonestockchecker.com, running as the `duo-stock-alert` Worker at https://duo-stock-alert.nbrown-io.workers.dev.

- `/` (`public/index.html`): every Duo model × both stores, checked live with Apple every 30 s while the page is open.
  Storage and colour filters, an "In stock now" banner with a Buy link, optional sound, and an "(n) In stock!" tab
  title. If Apple's answer doesn't name either store, it shows every nearby store instead and says so.
- `GET /api/stock`: one Apple request for all eight parts near `LOCATION` (default `M4 3AQ`), shared by every caller
  for 20 s. Apple's error is passed through to the page.
- Phone alerts: the monitor in `src/` (recovered from the original deploy) runs on a cron, checks `PARTS` at `STORES`
  `CHECKS_PER_MINUTE` times a minute, and alerts by web push (`public/sw.js`), Pushover and ntfy. Turn on push from
  the page; on iPhone, add the page to the Home Screen first.

## Deploy

```sh
npm install
npx wrangler login
npm run deploy
```

Vars (`PARTS`, `STORES`, `LOCATION`, …), the cron trigger and secrets aren't in `wrangler.toml`. The deploy keeps
whatever is live (`keep_vars = true`, no `[triggers]` table).
