/**
 * DRIVE CHECK — traffic-de.js
 * Provider für deutsche Autobahn-Verkehrsdaten.
 *
 * Quelle:   Autobahn GmbH – offene, kostenlose API (kein API-Key, CORS aktiviert)
 * Basis-URL: https://verkehr.autobahn.de/o/autobahn/
 * Lizenz:   Amtliche Verkehrsdaten des Bundes, freie Nutzung (siehe autobahn.api.bund.dev)
 * Rate-Limit: keines dokumentiert, wir cachen dennoch (siehe Abschnitt 21).
 *
 * Antwortformat der API (Beispiel "warning"):
 * { "warning": [ { identifier, title, subtitle, coordinate: {lat, long}, ... } ] }
 * Koordinaten kommen als STRINGS ("53.04") — werden hier zu Number geparst.
 */

const AUTOBAHN_BASE = "https://verkehr.autobahn.de/o/autobahn";
const AUTOBAHN_CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten – siehe Abschnitt 21 (API-Limits)

// Autobahnen grob nach Region, um nicht alle ~50 Straßen abfragen zu müssen.
// Für Phase 4 reicht eine bundesweite Liste; die Korridor-Filterung (geo.js)
// sortiert ohnehin alles Irrelevante aus.
let _roadListCache = null;

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getAllRoadIds() {
  if (_roadListCache) return _roadListCache;
  const data = await fetchJson(`${AUTOBAHN_BASE}/`);
  _roadListCache = data.roads || [];
  return _roadListCache;
}

function mapSeverity(serviceType, item) {
  // Sperrung => immer "closed" (Abschnitt 23: Sperrung auf Route => mind. ROT)
  if (serviceType === "closure") return "closed";
  if (serviceType === "roadworks") return "notice";
  if (serviceType === "warning") {
    // grobe Heuristik über Titel/Subtitel, da die API selbst keine feste
    // Ampel-Severity liefert
    const text = `${item.title || ""} ${item.subtitle || ""}`.toLowerCase();
    if (text.includes("vollsperrung") || text.includes("gesperrt")) return "closed";
    if (text.includes("stau") || text.includes("stockend")) return "hindered";
    return "notice";
  }
  return "notice";
}

function normalizeItem(serviceType, item, roadId) {
  const lat = parseFloat(item.coordinate?.lat);
  const long = parseFloat(item.coordinate?.long);
  const startTs = Number.isFinite(Number(item.startTimestamp)) ? Number(item.startTimestamp) : null;
  const endTs = Number.isFinite(Number(item.endTimestamp)) ? Number(item.endTimestamp) : null;
  return {
    id: item.identifier,
    country: "DE",
    type: serviceType,
    severity: mapSeverity(serviceType, item),
    title: item.title || roadId,
    subtitle: item.subtitle || "",
    description: Array.isArray(item.description) ? item.description.join(" · ") : (item.subtitle || ""),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(long) ? long : null,
    startTime: startTs,
    endTime: endTs,
    source: "Autobahn GmbH",
    lastUpdated: new Date().toISOString(),
  };
}

async function fetchServiceForRoad(roadId, serviceType) {
  const url = `${AUTOBAHN_BASE}/${encodeURIComponent(roadId)}/services/${serviceType}`;
  const data = await fetchJson(url);
  const list = data[serviceType] || [];
  return list.map((item) => normalizeItem(serviceType, item, roadId));
}

/**
 * Holt Ereignisse für eine bestimmte Menge von Autobahnen (z. B. die, die eine
 * Route kreuzt). roadIds z.B. ["A17", "B172"] — B-Straßen liefert die API nicht,
 * werden also automatisch leer zurückgegeben (kein Fake-Ergebnis).
 */
async function getEventsForRoads(roadIds, { useCache = true } = {}) {
  const now = Date.now();
  const results = [];
  const errors = [];

  for (const roadId of roadIds) {
    // Nur Autobahnen (A..) werden von dieser API unterstützt.
    if (!/^A\d+/i.test(roadId)) continue;

    const cacheKey = `de_${roadId}`;
    let cached = null;
    if (useCache && window.DriveCheckDB) {
      cached = await window.DriveCheckDB.get(window.DriveCheckDB.STORES.trafficCache, cacheKey);
    }
    if (cached && now - new Date(cached.lastUpdated).getTime() < AUTOBAHN_CACHE_TTL_MS) {
      results.push(...cached.events);
      continue;
    }

    try {
      const [roadworks, warnings, closures] = await Promise.all([
        fetchServiceForRoad(roadId, "roadworks"),
        fetchServiceForRoad(roadId, "warning"),
        fetchServiceForRoad(roadId, "closure"),
      ]);
      const events = [...roadworks, ...warnings, ...closures];
      results.push(...events);
      if (window.DriveCheckDB) {
        await window.DriveCheckDB.put(window.DriveCheckDB.STORES.trafficCache, {
          id: cacheKey,
          country: "DE",
          events,
          lastUpdated: new Date().toISOString(),
        });
      }
    } catch (err) {
      errors.push({ roadId, message: err.message });
      // Bei Fehler: alte gecachte Daten verwenden, falls vorhanden (Abschnitt 20)
      if (cached) results.push(...cached.events);
    }
  }

  return { events: results, errors };
}

window.TrafficProviderDE = {
  getAllRoadIds,
  getEventsForRoads,
};
