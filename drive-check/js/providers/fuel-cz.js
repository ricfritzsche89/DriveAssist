/**
 * DRIVE CHECK — fuel-cz.js
 * Provider-Schnittstelle für tschechische Kraftstoffpreise (Abschnitt 7, Phase 7.0).
 *
 * RECHERCHE-ERGEBNIS (Stand: Erstellung dieser App):
 * - Fuelo.net bietet laut eigener Aussage einen kostenlosen API-Key auf Anfrage
 *   (Registrierungsseite: https://fuelo.net/about/api_key_request). Eine öffentlich
 *   einsehbare, verlässliche Dokumentation des JSON-Antwortformats für Tankstellen-
 *   Preise ließ sich zum Zeitpunkt der Erstellung dieser App nicht auffinden.
 * - BenzinMapa.cz und mBenzin.cz veröffentlichen keine offiziell dokumentierte,
 *   freie REST-API; ein Zugriff wäre nur per Scraping möglich, was Abschnitt 7
 *   ausdrücklich verbietet ("NIEMALS einfach eine fremde Website ungeprüft
 *   aggressiv scrapen").
 *
 * KONSEQUENZ (gemäß Abschnitt 33: "Niemals eine Datenquelle vortäuschen"):
 * Es wird HIER keine erfundene Endpunkt-Struktur implementiert. Stattdessen steht
 * eine saubere Primär-/Fallback-Provider-Architektur bereit:
 *
 *   CzechFuelProvider
 *   ├── primary:  FueloProvider   (deaktiviert, bis ein echter API-Key + echtes,
 *   │                              verifiziertes Antwortformat vorliegen)
 *   └── fallback: ManualCzProvider (Nutzer trägt CZ-Favoriten-Preise manuell ein,
 *                                   siehe Tankstellen-Ansicht → CZ-Favorit bearbeiten)
 *
 * Sobald ein Nutzer einen gültigen Fuelo-API-Key UND die tatsächliche, verifizierte
 * Endpunkt-Doku hat, kann `primary.enabled` auf true gesetzt und `primary.fetch`
 * unten implementiert werden — ohne dass App, UI oder Datenmodell sich ändern müssen.
 */

const FueloProvider = {
  enabled: false, // bewusst deaktiviert — siehe Kommentar oben
  async fetch(/* stationId */) {
    throw new Error("Fuelo-Integration ist deaktiviert: keine verifizierte API-Dokumentation vorhanden.");
  },
};

/**
 * Fallback: manuell erfasste Preise aus fuelFavorites (vom Nutzer selbst gepflegt,
 * siehe Abschnitt 9 „Tankstellen Favoriten“). Das ist ehrlich, funktioniert offline
 * und täuscht keine Live-Daten vor.
 */
async function getManualPrice(favoriteId) {
  if (!window.DriveCheckDB) return null;
  const fav = await window.DriveCheckDB.get(window.DriveCheckDB.STORES.fuelFavorites, favoriteId);
  return fav?.manualPrices || null;
}

async function getPrices(favoriteId) {
  if (FueloProvider.enabled) {
    try {
      return { available: true, prices: await FueloProvider.fetch(favoriteId), source: "Fuelo.net" };
    } catch (err) {
      // fällt bewusst durch zum Fallback
    }
  }
  const manual = await getManualPrice(favoriteId);
  if (manual) {
    return { available: true, prices: manual, source: "manuell erfasst", manual: true };
  }
  return {
    available: false,
    prices: null,
    reason:
      "Keine automatische CZ-Preisquelle angebunden (siehe fuel-cz.js). Preis kann in den " +
      "Favoriten manuell hinterlegt werden.",
  };
}

window.FuelProviderCZ = {
  getPrices,
  FueloProvider,
};
