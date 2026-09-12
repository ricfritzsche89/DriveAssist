/**
 * DRIVE CHECK — map.js
 * MapProvider (Abschnitt 19): Leaflet + OpenStreetMap-Tiles.
 * Leaflet wird erst bei Bedarf nachgeladen (Phase 11 Performance), damit der
 * initiale App-Start schlank bleibt.
 */

const LEAFLET_CSS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css";
const LEAFLET_JS = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";

let _leafletLoading = null;

function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (_leafletLoading) return _leafletLoading;

  _leafletLoading = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    document.head.appendChild(link);

    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Leaflet konnte nicht geladen werden (offline?)"));
    document.head.appendChild(script);
  });
  return _leafletLoading;
}

const CATEGORY_EMOJI = {
  traffic: "🚧",
  fuel: "⛽",
  favorite: "⭐",
  start: "🏠",
  end: "🏁",
  waypoint: "📍",
};

function emojiIcon(category) {
  return window.L.divIcon({
    html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))">${CATEGORY_EMOJI[category] || "📍"}</div>`,
    className: "dc-emoji-marker",
    iconSize: [24, 24],
    iconAnchor: [12, 20],
  });
}

/**
 * Erstellt (oder liefert bestehende) Karteninstanz in einem Container.
 * Gibt ein kleines Wrapper-Objekt mit Hilfsfunktionen zurück.
 */
async function createMap(containerId, { center = [51.0, 13.7], zoom = 7 } = {}) {
  await loadLeaflet();
  const L = window.L;

  const el = document.getElementById(containerId);
  // Bereits initialisierte Leaflet-Instanz auf demselben Element wiederverwenden
  if (el._dcMap) {
    el._dcMap.remove();
    el._dcMap = null;
  }

  const map = L.map(containerId, { zoomControl: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende',
  }).addTo(map);

  const markersLayer = L.layerGroup().addTo(map);
  let routeLine = null;

  el._dcMap = map;

  return {
    raw: map,

    addMarker(lat, lon, { category = "waypoint", popup = "" } = {}) {
      const marker = L.marker([lat, lon], { icon: emojiIcon(category) }).addTo(markersLayer);
      if (popup) marker.bindPopup(popup);
      return marker;
    },

    clearMarkers() {
      markersLayer.clearLayers();
    },

    drawRoute(polyline, color = "#2ed58a") {
      if (routeLine) map.removeLayer(routeLine);
      if (!polyline || polyline.length === 0) return;
      routeLine = L.polyline(
        polyline.map((p) => [p.lat, p.lon]),
        { color, weight: 5, opacity: 0.85 }
      ).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [24, 24] });
    },

    fitToMarkers() {
      const bounds = markersLayer.getBounds?.();
      if (bounds && bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32] });
    },

    onClick(handler) {
      map.on("click", (e) => handler(e.latlng.lat, e.latlng.lng));
    },

    invalidateSize() {
      map.invalidateSize();
    },

    destroy() {
      map.remove();
      el._dcMap = null;
    },
  };
}

window.DriveCheckMap = { createMap };
