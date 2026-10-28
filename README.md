# duo-stock-alert

Personal iPhone Duo pickup-stock monitor for the Trafford Centre and Manchester Arndale Apple Stores, running as the
`duo-stock-alert` Worker at https://duo-stock-alert.nbrown-io.workers.dev.

- `src/`: the monitor, recovered byte-for-byte from the deployed Worker's source map. A cron runs `StockMonitor.tick()`,
  which checks Apple's UK pickup availability `CHECKS_PER_MINUTE` times a minute for `PARTS` at `STORES` and alerts by
  web push, Pushover and ntfy.
- `public/check.html`, served at `/check`: every Duo model × each watched store, read from `/api/status` every 15 s.
  It makes no Apple requests of its own. Optional sound alert and an "(n) In stock!" tab title.

## Before the first deploy from this repo

The live Worker also serves a page at `/` (with its service worker) that isn't in this repo yet. A deploy replaces all
static files, so **copy everything from your original project's assets folder into `public/`** first.
`npm run deploy` refuses to run while `public/index.html` is missing.

The `[[migrations]]` tag `v1` is a guess. Wrangler compares it with the live Worker's tag, and if they differ it
re-applies every migration listed here, re-declaring `StockMonitor`. So if you still have the original
`wrangler.toml`, copy its `[[migrations]]` block (and `compatibility_date`) over this one before deploying.

Vars (`PARTS`, `STORES`, `LOCATION`, …), the cron trigger and secrets aren't in `wrangler.toml`. The deploy keeps
whatever is live (`keep_vars = true`, no `[triggers]` table). `STORES` should hold the two stores' numbers and `PARTS`
all eight Duo part numbers in `src/logic.js`. `/check` shows whichever stores the monitor actually reports.

## Deploy

```sh
npm install
npx wrangler login
npm run deploy
```
