/* Health Buddy service worker – offline shell, network for API */
const CACHE_NAME = "healthbuddy-pwa-v3";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.svg",
  "./icon-512.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isApiRequest(url) {
  try {
    const u = new URL(url);
    return (
      u.pathname.includes("/check") ||
      u.pathname.includes("/api/") ||
      u.pathname.includes("/health") ||
      u.pathname.includes("/run/") ||
      u.pathname.includes("/call/") ||
      u.pathname.includes("/gradio_api/")
    );
  } catch {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  const url = request.url;

  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((res) => {
            if (res && res.ok) {
              caches.open(CACHE_NAME).then((c) => c.put(request, res.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      return fetch(request)
        .then((res) => {
          if (res && res.ok && request.url.startsWith(self.location.origin)) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
