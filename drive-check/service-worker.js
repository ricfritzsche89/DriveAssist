/**
 * DRIVE CHECK — service-worker.js
 * Cacht die App-Shell für Offline-Start (Abschnitt 14/16).
 * Externe API-Aufrufe (Autobahn GmbH, Tankerkönig, Nominatim, OSRM, Leaflet-CDN,
 * OSM-Kacheln) sind bewusst NICHT hier gecacht — sie laufen cross-origin und
 * werden vom fetch-Handler unten automatisch durchgereicht (kein Eingriff),
 * damit nie veraltete Live-Daten fälschlich als aktuell angezeigt werden
 * (Abschnitt 20).
 */
const CACHE_VERSION = "drive-check-v5";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/db.js",
  "./js/geo.js",
  "./js/routing.js",
  "./js/map.js",
  "./js/notify.js",
  "./js/providers/traffic-de.js",
  "./js/providers/traffic-cz.js",
  "./js/providers/fuel-de.js",
  "./js/providers/fuel-cz.js",
  "./icons/icon-72.png",
  "./icons/icon-96.png",
  "./icons/icon-128.png",
  "./icons/icon-144.png",
  "./icons/icon-152.png",
  "./icons/icon-192.png",
  "./icons/icon-384.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Nur Same-Origin-App-Shell-Dateien aus dem Cache bedienen (cache-first).
  // Externe API-/Kartenaufrufe laufen ganz normal ohne SW-Eingriff übers Netz.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
