export const APPLE_URL = "https://www.apple.com/uk/shop/retail/pickup-message";
export const BUY_URL = "https://www.apple.com/uk/shop/buy-iphone/iphone-duo";
// The two stores watched, matched by name in Apple's answer so nothing depends on knowing their store numbers.
export const WATCH_NAMES = /trafford|arndale/i;

export const PART_NAMES = {
  "MK2D4QN/A": "iPhone Duo 256GB Star White",
  "MK2E4QN/A": "iPhone Duo 256GB Night Sky",
  "MK2F4QN/A": "iPhone Duo 512GB Star White",
  "MK2G4QN/A": "iPhone Duo 512GB Night Sky",
  "MK2H4QN/A": "iPhone Duo 1TB Star White",
  "MK2J4QN/A": "iPhone Duo 1TB Night Sky",
  "MK2K4QN/A": "iPhone Duo 2TB Star White",
  "MK2L4QN/A": "iPhone Duo 2TB Night Sky",
};

export function list(s) {
  return String(s || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function buildUrl(parts, location) {
  const url = new URL(APPLE_URL);
  url.searchParams.set("pl", "true");
  url.searchParams.set("mts.0", "regular");
  parts.forEach((p, i) => url.searchParams.set(`parts.${i}`, p));
  url.searchParams.set("location", location);
  return url.toString();
}

// pickup-message answers with body.stores; the retired fulfillment-messages used body.content.pickupMessage.stores.
function storesOf(data) {
  return data?.body?.stores ?? data?.body?.content?.pickupMessage?.stores ?? [];
}

export function summarise(data, parts, stores) {
  const all = storesOf(data);
  const results = [];
  for (const s of all) {
    if (!stores.includes(s.storeNumber)) continue;
    for (const p of parts) {
      const pa = s.partsAvailability?.[p];
      if (!pa) continue;
      results.push({
        store: s.storeNumber,
        storeName: s.storeName || s.storeNumber,
        part: p,
        name: PART_NAMES[p] || p,
        available: pa.pickupDisplay === "available",
        display: pa.pickupDisplay || "",
        quote:
          pa.pickupSearchQuote ||
          pa.messageTypes?.regular?.storePickupQuote ||
          pa.messageTypes?.compact?.storePickupQuote ||
          "",
      });
    }
  }
  return { results, storesInResponse: all.map((s) => s.storeNumber) };
}

// Every store Apple returns near the searched location, with each requested part's pickup status.
export function summariseNearby(data, parts) {
  const all = storesOf(data);
  return all.map((s) => ({
    store: s.storeNumber,
    storeName: s.storeName || s.storeNumber,
    parts: Object.fromEntries(
      parts.map((p) => {
        const pa = s.partsAvailability?.[p];
        if (!pa) return [p, null];
        const quote =
          pa.pickupSearchQuote || pa.messageTypes?.regular?.storePickupQuote || pa.messageTypes?.compact?.storePickupQuote || "";
        return [p, { available: pa.pickupDisplay === "available", quote: stripTags(quote) }];
      })
    ),
  }));
}

function stripTags(s) {
  return String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

export function decide(prev, r, now, realertMs) {
  if (r.available) {
    const fresh = !prev || !prev.available;
    const due = prev && prev.available && now - prev.lastAlert >= realertMs;
    if (fresh || due) {
      return {
        alert: { level: "urgent", title: `Duo in stock: ${r.storeName}`, body: `${r.name} — ${r.quote || "available for pickup"}` },
        next: { available: true, since: fresh ? now : prev.since, lastAlert: now },
      };
    }
    return { alert: null, next: prev };
  }
  if (prev && prev.available) {
    return {
      alert: { level: "low", title: `Gone: ${r.storeName}`, body: `${r.name} no longer showing for pickup` },
      next: { available: false, since: now, lastAlert: 0 },
    };
  }
  return { alert: null, next: prev || { available: false, since: now, lastAlert: 0 } };
}
