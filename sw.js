// RTF – RoadToFTP Service Worker: App offline verfügbar machen (API-Aufrufe gehen immer ins Netz)
const CACHE = "rtf-v9";
const FILES = ["./", "index.html", "app.js", "planner.js", "charts.js", "analysis.js", "calendar.js", "manifest.webmanifest",
               "icon-192.png", "icon-512.png", "apple-touch-icon.png", "logo.svg"];

self.addEventListener("install", e => {
  // "reload": beim Installieren frische Dateien vom Server holen, nicht aus dem Browser-Cache
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // Netzwerk zuerst und immer beim Server nachfragen ("no-cache"), damit nie alte und neue Dateien gemischt werden;
  // ohne Netz aus dem Cache. Seitenaufrufe (navigate) dürfen nicht mit Optionen kopiert werden -> über die URL anfragen.
  const req = e.request.mode === "navigate" ? new Request(url.href, { cache: "no-cache" }) : new Request(e.request, { cache: "no-cache" });
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(m => m || caches.match("index.html"))));
});
