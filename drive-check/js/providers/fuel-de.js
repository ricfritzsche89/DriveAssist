/**
 * DRIVE CHECK — fuel-de.js
 * Provider für deutsche Kraftstoffpreise über die Tankerkönig-API.
 *
 * Quelle:    Tankerkönig (creativecommons.tankerkoenig.de) — offizieller,
 *            kostenloser Zugang zu den MTS-K-Daten des Bundeskartellamts.
 * API-Key:   ERFORDERLICH, aber kostenlos — der Nutzer fordert ihn selbst per
 *            E-Mail-Registrierung unter https://creativecommons.tankerkoenig.de an
 *            und trägt ihn in den Einstellungen dieser App ein. Diese App liefert
 *            und kennt keinen eigenen Schlüssel.
 * Lizenz:    Nutzung gemäß Tankerkönig-Nutzungsbedingungen (Attribution "Tankerkönig"
 *            + Link erforderlich, siehe README).
 * Rate-Limit: von Tankerkönig nicht fest dokumentiert, aber "angemessene Nutzung"
 *            gefordert — wir cachen daher pro Tankstelle für mehrere Minuten.
 */

const TANKERKOENIG_BASE = "https://creativecommons.tankerkoenig.de/json";
const FUEL_DE_CACHE_TTL_MS = 5 * 60 * 1000;

async function getApiKey() {
  if (!window.DriveCheckDB) return null;
  return window.DriveCheckDB.getSetting("tankerkoenigApiKey", null);
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Tankstellen im Umkreis suchen. rad in km (Tankerkönig-Einheit). */
async function searchStations(lat, lng, rad = 5) {
  const key = await getApiKey();
  if (!key) {
    return { available: false, stations: [], reason: "Kein Tankerkönig-API-Key in den Einstellungen hinterlegt." };
  }
  try {
    const url = `${TANKERKOENIG_BASE}/list.php?lat=${lat}&lng=${lng}&rad=${rad}&sort=dist&type=all&apikey=${encodeURIComponent(key)}`;
    const data = await fetchJson(url);
    if (!data.ok) {
      return { available: false, stations: [], reason: data.message || "Tankerkönig-Anfrage fehlgeschlagen." };
    }
    return { available: true, stations: data.stations || [] };
  } catch (err) {
    return { available: false, stations: [], reason: `Tankerkönig nicht erreichbar: ${err.message}` };
  }
}

/** Aktuelle Preise für eine Liste von Tankstellen-IDs (max. 10 pro Aufruf laut API). */
async function getPrices(stationIds) {
  if (!stationIds || stationIds.length === 0) return { available: true, prices: {} };
  const key = await getApiKey();
  if (!key) {
    return { available: false, prices: {}, reason: "Kein Tankerkönig-API-Key in den Einstellungen hinterlegt." };
  }

  const now = Date.now();
  const toFetch = [];
  const prices = {};

  for (const id of stationIds) {
    const cacheKey = `fuel_de_${id}`;
    const cached = window.DriveCheckDB
      ? await window.DriveCheckDB.get(window.DriveCheckDB.STORES.trafficCache, cacheKey)
      : null;
    if (cached && now - new Date(cached.lastUpdated).getTime() < FUEL_DE_CACHE_TTL_MS) {
      prices[id] = cached.price;
    } else {
      toFetch.push(id);
    }
  }

  if (toFetch.length === 0) return { available: true, prices };

  try {
    // Tankerkönig erlaubt bis zu 10 IDs pro Aufruf
    for (let i = 0; i < toFetch.length; i += 10) {
      const batch = toFetch.slice(i, i + 10);
      const url = `${TANKERKOENIG_BASE}/prices.php?ids=${batch.join(",")}&apikey=${encodeURIComponent(key)}`;
      const data = await fetchJson(url);
      if (!data.ok) continue;
      for (const id of batch) {
        const p = data.prices?.[id];
        if (p) {
          prices[id] = p;
          if (window.DriveCheckDB) {
            await window.DriveCheckDB.put(window.DriveCheckDB.STORES.trafficCache, {
              id: `fuel_de_${id}`,
              country: "DE",
              price: p,
              lastUpdated: new Date().toISOString(),
            });
          }
        }
      }
    }
    return { available: true, prices };
  } catch (err) {
    return { available: Object.keys(prices).length > 0, prices, reason: `Tankerkönig nicht erreichbar: ${err.message}` };
  }
}

window.FuelProviderDE = {
  searchStations,
  getPrices,
};
