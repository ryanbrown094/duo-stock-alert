import { DurableObject } from "cloudflare:workers";
import { buildPushPayload } from "@block65/webcrypto-web-push";
import { BUY_URL, buildUrl, decide, list, summarise } from "./logic.js";

const FAILURES_BEFORE_ALERT = 15;
const FAILURE_ALERT_GAP_MS = 60 * 60 * 1000;

export default {
  async scheduled(_event, env) {
    await monitor(env).tick();
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const m = monitor(env);
    const json = () => request.json().catch(() => null);

    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/status":
        return Response.json(await m.publicStatus());
      case "GET /api/vapid":
        return Response.json({ publicKey: env.VAPID_PUBLIC_KEY || null });
      case "POST /api/subscribe": {
        const sub = await json();
        if (!validSubscription(sub)) return new Response("bad subscription", { status: 400 });
        await m.addSubscription(sub);
        return new Response("ok\n");
      }
      case "POST /api/unsubscribe": {
        const body = await json();
        if (!body?.endpoint) return new Response("bad request", { status: 400 });
        await m.removeSubscription(body.endpoint);
        return new Response("ok\n");
      }
      case "POST /api/test": {
        const sub = await json();
        if (!validSubscription(sub)) return new Response("bad subscription", { status: 400 });
        await m.addSubscription(sub);
        const r = await m.pushOne(sub, { title: "Duo Stock Alert: test", body: "Notifications are working on this device.", url: BUY_URL, tag: "test" });
        return r.ok ? new Response("sent\n") : new Response(`push failed: ${r.status} ${r.detail}\n`, { status: 502 });
      }
      case "GET /api/check":
        if (!adminOk(env, url)) return new Response("forbidden", { status: 403 });
        return Response.json(await m.checkOnce());
      case "GET /api/test-all":
        if (!adminOk(env, url)) return new Response("forbidden", { status: 403 });
        await m.notify({ level: "urgent", title: "Duo Stock Alert: test", body: "Test alert to every channel." });
        return new Response("sent\n");
      default:
        return new Response("not found", { status: 404 });
    }
  },
};

function monitor(env) {
  return env.MONITOR.get(env.MONITOR.idFromName("singleton"));
}

function adminOk(env, url) {
  return !!env.ADMIN_KEY && url.searchParams.get("key") === env.ADMIN_KEY;
}

function validSubscription(sub) {
  return !!(sub && typeof sub.endpoint === "string" && sub.endpoint.startsWith("https://") && sub.keys?.p256dh && sub.keys?.auth);
}

export class StockMonitor extends DurableObject {
  async tick() {
    const n = Math.max(1, Number(this.env.CHECKS_PER_MINUTE || 3));
    const gap = Math.floor(60000 / n);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (i) await new Promise((r) => setTimeout(r, gap));
      out.push(await this.checkOnce());
    }
    return out;
  }

  async status() {
    return (await this.ctx.storage.get("state")) || {};
  }

  async publicStatus() {
    const s = await this.status();
    const subs = await this.subscriptions();
    return {
      lastCheck: s.lastCheck || null,
      lastResults: s.lastResults || [],
      missingStores: s.missingStores || [],
      failures: s.failures || 0,
      lastFailure: s.lastFailure || null,
      lastPushError: s.lastPushError || null,
      subscriptions: Object.keys(subs).length,
    };
  }

  async subscriptions() {
    return (await this.ctx.storage.get("subs")) || {};
  }

  async addSubscription(sub) {
    const subs = await this.subscriptions();
    subs[sub.endpoint] = { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, addedAt: Date.now() };
    await this.ctx.storage.put("subs", subs);
  }

  async removeSubscription(endpoint) {
    const subs = await this.subscriptions();
    delete subs[endpoint];
    await this.ctx.storage.put("subs", subs);
  }

  async checkOnce() {
    const parts = list(this.env.PARTS);
    const stores = list(this.env.STORES);
    const now = Date.now();
    const state = await this.status();
    state.last ||= {};

    let res, text;
    try {
      res = await fetch(buildUrl(parts, this.env.LOCATION || "M4 3AQ"), {
        headers: { Accept: "application/json", "User-Agent": "duo-stock-alert/1.0 (personal pickup-availability monitor)" },
      });
      text = await res.text();
    } catch (e) {
      return this.recordFailure(state, now, `fetch error: ${e.message}`);
    }
    if (!res.ok) return this.recordFailure(state, now, `HTTP ${res.status}: ${text.slice(0, 200)}`);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return this.recordFailure(state, now, `non-JSON response: ${text.slice(0, 200)}`);
    }

    const { results, storesInResponse } = summarise(data, parts, stores);
    const realertMs = Number(this.env.REALERT_MINUTES || 10) * 60 * 1000;

    for (const r of results) {
      const key = `${r.store}:${r.part}`;
      const { alert, next } = decide(state.last[key], r, now, realertMs);
      if (alert) await this.notify({ ...alert, tag: key });
      state.last[key] = next;
    }

    state.failures = 0;
    state.lastCheck = new Date(now).toISOString();
    state.lastResults = results;
    state.storesInResponse = storesInResponse;
    state.missingStores = stores.filter((s) => !storesInResponse.includes(s));
    await this.ctx.storage.put("state", state);
    return { checkedAt: state.lastCheck, results, missingStores: state.missingStores };
  }

  async recordFailure(state, now, reason) {
    state.failures = (state.failures || 0) + 1;
    state.lastFailure = { at: new Date(now).toISOString(), reason };
    if (state.failures >= FAILURES_BEFORE_ALERT && now - (state.lastFailureAlert || 0) >= FAILURE_ALERT_GAP_MS) {
      state.lastFailureAlert = now;
      await this.notify({ level: "low", title: "Duo monitor failing", body: reason.slice(0, 180), tag: "failure" });
    }
    await this.ctx.storage.put("state", state);
    return { error: reason, failures: state.failures };
  }

  async notify({ level, title, body, tag }) {
    await Promise.all([
      this.pushAll({ title, body, url: BUY_URL, tag: tag || title }, level),
      this.pushover(level, title, body),
      this.ntfy(level, title, body),
    ]);
  }

  async pushAll(data, level) {
    const subs = await this.subscriptions();
    const endpoints = Object.keys(subs);
    if (!endpoints.length) return;
    const results = await Promise.all(endpoints.map((e) => this.pushOne(subs[e], data, level)));
    let changed = false;
    results.forEach((r, i) => {
      if (r.gone) {
        delete subs[endpoints[i]];
        changed = true;
      }
    });
    if (changed) await this.ctx.storage.put("subs", subs);
  }

  async pushOne(sub, data, level = "urgent") {
    const env = this.env;
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return { ok: false, status: 0, detail: "VAPID keys not configured" };
    try {
      const payload = await buildPushPayload(
        { data, options: { ttl: level === "urgent" ? 600 : 300, urgency: level === "urgent" ? "high" : "normal" } },
        { endpoint: sub.endpoint, expirationTime: sub.expirationTime ?? null, keys: sub.keys },
        { subject: env.VAPID_SUBJECT || "https://nbrown.io", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      );
      const res = await fetch(sub.endpoint, payload);
      if (res.ok) return { ok: true, status: res.status };
      const detail = (await res.text()).slice(0, 200);
      const gone = res.status === 404 || res.status === 410;
      if (!gone) await this.noteError(`push ${res.status}: ${detail}`);
      return { ok: false, status: res.status, detail, gone };
    } catch (e) {
      await this.noteError(`push error: ${e.message}`);
      return { ok: false, status: 0, detail: e.message };
    }
  }

  async noteError(msg) {
    const state = await this.status();
    state.lastPushError = { at: new Date().toISOString(), reason: msg };
    await this.ctx.storage.put("state", state);
  }

  async pushover(level, title, body) {
    const env = this.env;
    if (!env.PUSHOVER_TOKEN || !env.PUSHOVER_USER) return;
    const form = new URLSearchParams({
      token: env.PUSHOVER_TOKEN,
      user: env.PUSHOVER_USER,
      title,
      message: body,
      url: BUY_URL,
      url_title: "Open Apple Store",
      priority: level === "urgent" ? "2" : "-1",
    });
    if (level === "urgent") {
      form.set("retry", "30");
      form.set("expire", "600");
      form.set("sound", "siren");
    }
    await fetch("https://api.pushover.net/1/messages.json", { method: "POST", body: form });
  }

  async ntfy(level, title, body) {
    const env = this.env;
    if (!env.NTFY_TOPIC) return;
    const server = (env.NTFY_SERVER || "https://ntfy.sh").replace(/\/$/, "");
    await fetch(`${server}/${env.NTFY_TOPIC}`, {
      method: "POST",
      body,
      headers: {
        Title: title,
        Priority: level === "urgent" ? "5" : "2",
        Tags: level === "urgent" ? "iphone,rotating_light" : "information_source",
        Click: BUY_URL,
      },
    });
  }
}
