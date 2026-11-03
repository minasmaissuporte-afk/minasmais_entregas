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

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data?.text() || "" };
  }
  const title = typeof message.title === "string" && message.title.trim()
    ? message.title
    : "Minas Mais Entregas";
  const options = {
    body: typeof message.body === "string" ? message.body : "Há uma atualização nas suas entregas.",
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-180.png",
    data: { url: typeof message.url === "string" ? message.url : "/motoboy-pwa" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedUrl = event.notification.data?.url;
  let target = new URL("/motoboy-pwa", self.location.origin);
  if (typeof requestedUrl === "string") {
    try {
      const candidate = new URL(requestedUrl, self.location.origin);
      if (candidate.origin === self.location.origin) target = candidate;
    } catch {
      // Keep the PWA's same-origin fallback.
    }
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((client) => new URL(client.url).origin === target.origin);
      if (existing) {
        void existing.navigate(target.href);
        return existing.focus();
      }
      return self.clients.openWindow(target.href);
    }),
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
        const contentType = response.headers.get("content-type") || "";
        // SPA rewrites can return index.html with HTTP 200 for a missing JS chunk.
        // Never persist that HTML under a hashed asset URL in the PWA cache.
        if (response.ok && !contentType.toLowerCase().includes("text/html")) {
          await cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
});
