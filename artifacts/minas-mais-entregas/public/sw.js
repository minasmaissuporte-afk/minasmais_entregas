const CACHE_NAME = "minas-mais-static-v1";
const PRECACHE_URLS = [
  "/manifest.webmanifest",
  "/pwa-icon.svg",
  "/pwa-icon-180.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/offline.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("minas-mais-static-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
    return;
  }

  if (
    url.pathname.startsWith("/assets/") ||
    [
      "/favicon.svg",
      "/logo.svg",
      "/pwa-icon.svg",
      "/pwa-icon-180.png",
      "/pwa-icon-192.png",
      "/pwa-icon-512.png",
      "/manifest.webmanifest",
    ].includes(url.pathname)
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
  }
});
