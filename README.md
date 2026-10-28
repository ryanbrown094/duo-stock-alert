# duo-stock-alert

Personal iPhone Duo stock checker for the Apple Trafford Centre and Manchester Arndale stores, in the style of
iphonestockchecker.com, running as the `duo-stock-alert` Worker at https://duo-stock-alert.nbrown-io.workers.dev.

- `/` (`public/index.html`): every Duo model × both stores, with storage and colour filters, an "In stock now"
  banner with a Buy link, optional sound and an "(n) In stock!" tab title. It reads the monitor's latest answer from
  `GET /api/stock` every 20 s and never calls Apple itself. If the last check failed, it says "Stock unknown" rather
  than "Nothing in stock".
- The monitor (`src/`): a cron runs `StockMonitor.tick()` once a minute, which makes one request to Apple's
  `/uk/shop/retail/pickup-message` for all eight parts near `LOCATION` (default `M4 3AQ`). It keeps the stores whose
  names match Trafford or Arndale and alerts by web push (`public/sw.js`), Pushover and ntfy. Turn on push from the
  page; on iPhone, add the page to the Home Screen first.
- Apple blocks addresses that ask too often or look like bots, answering HTTP 541. After a 541 (or 403/429) the
  monitor pauses for 10 minutes, because retrying sooner only extends the block.

## Deploy

```sh
npm install
npx wrangler login
npm run deploy
```

Vars (`LOCATION`, `REALERT_MINUTES`, `NTFY_TOPIC`, …), the cron trigger and secrets aren't in `wrangler.toml`. The deploy keeps
whatever is live (`keep_vars = true`, no `[triggers]` table).

`PARTS`, `STORES` and `CHECKS_PER_MINUTE` are no longer read: the parts are in `src/logic.js` and the stores are matched by name.
