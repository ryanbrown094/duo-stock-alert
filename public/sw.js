// Shows the monitor's web-push alerts; the payload is { title, body, url, tag } (see pushOne in src/index.js).
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(d.title || "Duo Stock", { body: d.body || "", tag: d.tag, data: { url: d.url || "/" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
