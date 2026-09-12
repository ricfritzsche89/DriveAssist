/**
 * DRIVE CHECK — traffic-cz.js
 * Provider-Schnittstelle für tschechische Verkehrsdaten (Abschnitt 5, Phase 5.0).
 *
 * RECHERCHE-ERGEBNIS (Stand: Erstellung dieser App):
 * Der tschechische Verkehrsdatendienst (NDIC / Národní dopravní informační centrum)
 * stellt seine DATEX-II- und DDR-XML-Feeds ausschließlich nach kostenloser,
 * aber PFLICHTIGER Registrierung bereit — und liefert die Daten per Push an einen
 * eigenen Server, den man selbst betreiben und öffentlich erreichbar machen muss
 * (siehe registr.dopravniinfo.cz). Das widerspricht der Kernvorgabe dieses Projekts
 * ("kein Server", Abschnitt 1) und kann daher NICHT direkt aus einer statischen
 * GitHub-Pages-PWA heraus abgefragt werden (kein einfacher GET-Endpunkt, kein CORS
 * für Browser-Zugriff dokumentiert).
 *
 * Gemäß Abschnitt 33 ("Wenn eine Datenquelle rechtlich/technisch unklar ist:
 * nicht verwenden und dokumentiere eine Alternative") wird hier daher KEINE
 * Verkehrsdaten-Quelle angebunden. Diese Datei hält nur die Provider-Schnittstelle
 * bereit, damit sie später (z. B. über eine private Zwischen-API, die selbst
 * gehostet würde) ausgetauscht werden kann, ohne den Rest der App anzufassen.
 *
 * Denkbare zukünftige Alternativen (jeweils vor Nutzung erneut zu prüfen):
 *  - Ein selbst gehosteter kleiner Proxy-Server, der die NDIC-Registrierung nutzt
 *    (verstößt gegen die "kein Server"-Vorgabe, daher aktuell nicht umgesetzt)
 *  - Waze/TomTom/HERE-Verkehrs-APIs (i. d. R. kostenpflichtig oder Kreditkarte nötig)
 *  - Eine künftige offene, GET-fähige CORS-API der tschechischen Behörden
 */

async function getEventsForRoute() {
  return {
    available: false,
    events: [],
    reason:
      "CZ-Verkehrsdaten momentan nicht verfügbar: Der offizielle NDIC-Feed erfordert " +
      "eine Registrierung und einen eigenen Empfangsserver, was der Kostenregel " +
      "„kein Server“ widerspricht. Es wurde bewusst keine Ersatzquelle ungeprüft " +
      "eingebunden (siehe Quellcode-Kommentar in traffic-cz.js).",
  };
}

window.TrafficProviderCZ = {
  getEventsForRoute,
};
