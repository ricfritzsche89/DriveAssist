/**
 * DRIVE CHECK — routing.js
 * RoutingProvider (Abschnitt 19): Geocoding + Routenberechnung, beides OSM-basiert
 * und ohne API-Key.
 *
 * Geocoding: Nominatim (nominatim.openstreetmap.org)
 *   - kostenlos, aber mit Nutzungsrichtlinie: max. 1 Anfrage/Sekunde, kein Bulk,
 *     Attribution "© OpenStreetMap-Mitwirkende" erforderlich. Wir debouncen die
 *     Sucheingabe entsprechend (siehe app.js, Phase 11 Performance).
 *
 * Routing: OSRM Public Demo Server (router.project-osrm.org)
 *   - kostenlos, öffentlich, aber ausdrücklich nur für Test-/geringe Nutzung gedacht
 *     (keine harten Produktions-Garantien). Für eine private Fahrten-App im
 *     Eigenbedarf ist das im Rahmen der Kostenregel (Abschnitt 29) die einzige
 *     bekannte kostenlose Option ohne eigenen Server/Kreditkarte.
 */

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const OSRM_BASE = "https://router.project-osrm.org";

async function geocode(query) {
  if (!query || query.trim().length < 3) return [];
  const url = `${NOMINATIM_BASE}/search?format=jsonv2&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  return data.map((d) => ({
    label: d.display_name,
    lat: parseFloat(d.lat),
    lon: parseFloat(d.lon),
  }));
}

async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM_BASE}/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  return data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Extrahiert Straßen-Referenznummern ("A17", "A 17", "B6", "K1050") aus OSRM-Steps. */
function extractRoadRefs(route) {
  const refs = new Set();
  for (const leg of route.legs || []) {
    for (const step of leg.steps || []) {
      // OSRM liefert die amtliche Referenz meist in step.ref; step.name enthält
      // bei unbeschrifteten Strecken oft nur den Freitext. Beides auswerten.
      for (const raw of [step.ref, step.name]) {
        if (!raw || typeof raw !== "string") continue;
        // Erlaubt Schreibweisen wie "A17", "A 17", "A17a", "A 17 (Richtung Dresden)",
        // weist aber "Bruchsaler Straße" o. ä. korrekt ab.
        const re = /\b([A-ZÄÖÜ])(?:\s*)(\d{1,4}[a-z]?)\b/gi;
        let m;
        while ((m = re.exec(raw)) !== null) {
          refs.add(m[1].toUpperCase() + m[2]);
        }
      }
    }
  }
  return Array.from(refs);
}

/**
 * Route zwischen Punkten berechnen. points: [{lat, lon}, ...] (Start, Zwischen*, Ziel)
 * Rückgabe: { available, polyline: [{lat,lon}], distanceMeters, durationSeconds, roadNames }
 */
async function getRoute(points) {
  if (!points || points.length < 2) {
    return { available: false, reason: "Mindestens Start und Ziel werden benötigt." };
  }
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    const data = await res.json();
    if (data.code !== "Ok" || !data.routes?.length) {
      return { available: false, reason: "Route konnte nicht berechnet werden." };
    }
    const route = data.routes[0];
    const polyline = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));

    const roadNames = extractRoadRefs(route);

    return {
      available: true,
      polyline,
      distanceMeters: route.distance,
      durationSeconds: route.duration,
      roadNames,
    };
  } catch (err) {
    return { available: false, reason: `Routing-Dienst nicht erreichbar: ${err.message}` };
  }
}

window.RoutingProvider = {
  geocode,
  reverseGeocode,
  getRoute,
};
