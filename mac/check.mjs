// Asks Apple from your home connection, which Apple blocks far less than Cloudflare's servers, and hands each answer
// to the Worker; the page and phone alerts then work as usual. While this runs the Worker doesn't ask Apple itself.
//
//   caffeinate -is node mac/check.mjs     (from the repo folder; keep the Mac plugged in and awake)
//
// mac/.report-key holds the same value as the Worker's REPORT_KEY secret (see README).
import { readFileSync } from "node:fs";
import { APPLE_HEADERS, PART_NAMES, buildUrl } from "../src/logic.js";

const WORKER = process.env.WORKER_URL || "https://duo-stock-alert.nbrown-io.workers.dev";
const LOCATION = process.env.LOCATION || "M4 3AQ";
const EVERY_MS = (Number(process.env.CHECK_EVERY_MINUTES) || 3) * 60 * 1000;
const BLOCK_PAUSES_MIN = [15, 30, 60];

let key;
try {
  key = readFileSync(new URL("./.report-key", import.meta.url), "utf8").trim();
} catch {
  console.error("mac/.report-key is missing: create it as the README says.");
  process.exit(1);
}

const log = (msg) => console.log(`${new Date().toLocaleTimeString()}  ${msg}`);
let blocks = 0;

for (;;) {
  let wait = EVERY_MS;
  try {
    const res = await fetch(buildUrl(Object.keys(PART_NAMES), LOCATION), { headers: APPLE_HEADERS });
    const text = await res.text();
    if (res.ok) {
      blocks = 0;
      const r = await fetch(`${WORKER}/api/report`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: text });
      if (!r.ok) log(`Worker refused the report: HTTP ${r.status} ${(await r.text()).trim()}`);
      else {
        const { results = [], error } = await r.json();
        const inStock = results.filter((x) => x.available).map((x) => `${x.name} at ${x.storeName}`);
        log(error ? `Worker couldn't use Apple's answer: ${error}` : inStock.length ? `IN STOCK: ${inStock.join("; ")}` : "nothing in stock");
      }
    } else if ([403, 429, 541].includes(res.status)) {
      wait = BLOCK_PAUSES_MIN[Math.min(blocks++, BLOCK_PAUSES_MIN.length - 1)] * 60 * 1000;
      log(`Apple blocked this connection (HTTP ${res.status}), trying again in ${wait / 60000} min`);
    } else {
      log(`Apple answered HTTP ${res.status}`);
    }
  } catch (e) {
    log(`error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, wait * (0.9 + Math.random() * 0.2)));
}
