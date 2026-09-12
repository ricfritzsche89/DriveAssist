# Drive Check — DriveAssist

**Progressive Web App für Strecken, Verkehr und Tankstellenpreise in Deutschland und Tschechien.**
Läuft vollständig kostenlos, ohne eigenen Server, ohne Konto und ohne Tracking — gehostet
auf GitHub Pages, installierbar als App auf Smartphones und Tablets.

> Dieses Repository (`ricfritzsche89/DriveAssist`) enthält die App „Drive Check“ als
> funktionierende erste Version. Alle Daten liegen ausschließlich lokal auf dem Gerät
> (IndexedDB). Sämtliche Online-Aufrufe gehen direkt aus dem Browser zu kostenlosen,
> öffentlichen Diensten — ein eigener Server ist nie nötig.

**Status: Funktionierende erste Version.**
Alle 12 Entwicklungsphasen sind umgesetzt und automatisiert geprüft (siehe Abschnitt 14).

---

## 1. Funktionen im Überblick

| Bereich | Was die App kann |
|---|---|
| **Dashboard** | Standardstrecke mit Live-Verkehrsstatus (🟢 frei · 🟡 Hinweis · 🟠 behindert · 🔴 gesperrt · ⚪ unbekannt), Fahrzeit, Distanz, Zeitpunkt der letzten Prüfung und Tankstellen-Favoriten mit Preisen. |
| **Meine Strecken** | Strecken anlegen, bearbeiten und löschen. Orts-Autovervollständigung (OpenStreetMap/Nominatim), Routenberechnung (OSRM), Kartenvorschau, einstellbarer Verkehrskorridor (250–2000 m). |
| **Karte** | Alle Strecken, Start-/Zielpunkte und Tankstellen-Favoriten auf einer OpenStreetMap-Karte. „Mein Standort“ per GPS (nur nach expliziter Freigabe). |
| **Tanken** | DE: Tankstellensuche in der Nähe (Tankerkönig) mit Favoriten und Live-Preisen (E10/E5/Diesel). CZ: Favoriten manuell mit Preisen anlegen und **jederzeit nachbearbeiten**. |
| **Einstellungen** | Standardstrecke, Verkehrskorridor, Tankerkönig-API-Key, Einheiten (km/mi), Benachrichtigungen, Datenexport/-import (JSON-Backup), Cache leeren. |
| **Offline** | App-Shell vollständig offline nutzbar. Ohne Verbindung wird der Status ehrlich als „⚪ unbekannt – Offline“ angezeigt statt veralteter Daten als aktuell auszugeben. |

---

## 2. Installation (lokal)

Kein Build-Prozess nötig. Im Projektordner einen statischen Webserver starten:

```bash
npx serve .
# oder
python3 -m http.server 8080
```

Dann `http://localhost:8080` im Browser öffnen.
Service Worker und IndexedDB benötigen `http://localhost` oder `https://` — **nicht** `file://`.

---

## 3. GitHub Pages bereitstellen

```bash
git init
git add .
git commit -m "Drive Check – funktionierende erste Version"
git branch -M main
git remote add origin https://github.com/<benutzername>/<repo>.git
git push -u origin main
```

1. Im Repository: **Settings → Pages**
2. **Source**: „Deploy from a branch“
3. **Branch**: `main`, Ordner `/ (root)`
4. Speichern — die App ist danach unter `https://<benutzername>.github.io/<repo>/` erreichbar.

Alle Pfade sind relativ (`./`), die App funktioniert daher auch in einem Unterordner.

---

## 4. PWA auf Smartphone installieren

1. Die GitHub-Pages-URL im (Chrome/Edge/Safari-)Browser öffnen. Möglichst über `https://` — nötig für Service Worker, IndexedDB und ggf. GPS.
2. **Android**: Menü (⋮) → „App installieren“ (bzw. „Zum Startbildschirm hinzufügen“).
3. **iOS**: Teilen → „Zum Home-Bildschirm“.
4. Die App startet danach mit eigenem Icon und ohne Browser-UI. Beim ersten Öffnen wird die App-Shell automatisch für den Offline-Start gecacht.

---

## 5. API-Konfiguration

| Was | Wo eintragen | Pflicht? |
|---|---|---|
| Tankerkönig-API-Key (DE-Kraftstoffpreise) | App → Einstellungen → API-Zugänge | Nur für DE-Tankstellensuche/-preise |

Den kostenlosen Key selbst anfordern: **https://creativecommons.tankerkoenig.de/**
(einfaches Formular, keine Kreditkarte). Die App kennt und liefert keinen eigenen Schlüssel.

Alle übrigen Dienste (Autobahn GmbH, Nominatim, OSRM, OpenStreetMap-Kacheln, Leaflet-CDN)
benötigen **keinen** API-Key.

---

## 6. Tschechien: aktueller Stand zu Live-Daten

Das Projekt behandelt Tschechien bewusst ehrlich statt zu „faken“:

**Verkehr (CZ):**
Der offizielle tschechische Feed (NDIC, `registr.dopravniinfo.cz`) liefert DATEX-II-/DDR-XML-Daten
nur nach Registrierung **und** per Push an einen selbst betriebenen, öffentlich erreichbaren
Server. Das widerspricht der Kernvorgabe „kein eigener Server“ und ist aus einer statischen
GitHub-Pages-PWA nicht per GET-Call nutzbar. Es wird deshalb **keine** ersatzweise,
ungeprüfte Quelle eingebunden (`js/providers/traffic-cz.js` dokumentiert den Stand und
belieferbare Alternativen für später).

**Kraftstoff (CZ):**
Fuelo.net bietet einen kostenlosen API-Key an, doch eine veröffentlichte, verlässliche
Dokumentation des Endpunkt-/Antwortformats war zum Zeitpunkt der Umsetzung nicht auffindbar.
BenzinMapa.cz und mBenzin.cz bieten keine offizielle freie REST-API (nur Scraping, was
ausdrücklich verboten ist). Daher:
- **Fallback:** CZ-Favoriten werden manuell mit Preisen angelegt und können jederzeit
  bearbeitet werden (Tanken → 🇨🇿 CZ-Favorit manuell anlegen → Liste → „Preise“).
- **Nachrüstbar:** `js/providers/fuel-cz.js` hat eine Primär/Fallback-Provider-Architektur
  (`FueloProvider` ist vorbereitet, aber deaktiviert). Sobald ein echter Key + verifizierte
  Doku vorliegen, wird nur diese eine Datei reaktiviert — App, UI und Datenmodell bleiben unverändert.

---

## 7. Datenquellen & Lizenzen

| Bereich | Anbieter | URL | API-Key | CORS | Attribution |
|---|---|---|---|---|---|
| Verkehr DE | Autobahn GmbH | `verkehr.autobahn.de/o/autobahn` | nein | ja | amtliche Daten, freie Nutzung |
| Verkehr CZ | NDIC | `registr.dopravniinfo.cz` | Registrierung | n/a (Push) | **nicht angebunden**, siehe Abschnitt 6 |
| Kraftstoff DE | Tankerkönig / MTS-K | `creativecommons.tankerkoenig.de` | ja (kostenlos) | ja | „Tankerkönig“ + Link |
| Kraftstoff CZ | Fuelo.net (geplant) | `fuelo.net` | ja (kostenlos, auf Anfrage) | n/a | **deaktiviert** — manuelle Erfassung als Fallback |
| Geocoding | Nominatim (OSM) | `nominatim.openstreetmap.org` | nein | ja | © OpenStreetMap-Mitwirkende; max. 1 Req/s, kein Bulk |
| Routing | OSRM Public Demo | `router.project-osrm.org` | nein | ja | nur geringe/private Nutzung, keine SLA |
| Kartenkacheln | OpenStreetMap | `tile.openstreetmap.org` | nein | ja | © OpenStreetMap-Mitwirkende |
| Kartenbibliothek | Leaflet | `cdnjs.cloudflare.com` | nein | ja | BSD-2-Clause |

Alle Aufrufe erfolgen clientseitig direkt aus dem Browser — kein Server, keine Cloud.

---

## 8. Projektstruktur

```
drive-check/
├── index.html                 # Einzel-Seiten-App (alle Views, Navigation)
├── manifest.json              # PWA-Manifest (Icons, Theme, Standalone)
├── service-worker.js          # Offline-App-Shell-Cache + Update-Erkennung
├── css/
│   └── styles.css             # Design-Tokens und Layout (dunkles Automotive-Theme)
├── js/
│   ├── app.js                 # Router, Dashboard, Strecken-, Karten-, Tanken-, Einstellungs-Logik
│   ├── db.js                  # IndexedDB-Wrapper (routes, waypoints, fuelStations,
│   │                          #   fuelFavorites, trafficCache, settings) + Backup/Import
│   ├── geo.js                 # Haversine, Punkt-zu-Route-Distanz, Korridor-, Status-Berechnung
│   ├── routing.js             # Geocoding (Nominatim) + Routing (OSRM)
│   ├── map.js                 # Leaflet-Wrapper (lazy-loaded), Emoji-Marker, Routen-Zeichnung
│   ├── notify.js              # Optionale PWA-Benachrichtigungen bei Status-Verschlechterung
│   └── providers/
│       ├── traffic-de.js      # Autobahn GmbH API (Roadworks/Warnings/Closures, gecacht)
│       ├── traffic-cz.js      # dokumentierter Stub (keine Live-Quelle verfügbar)
│       ├── fuel-de.js         # Tankerkönig API (Suche + Preise, gecacht)
│       └── fuel-cz.js         # Primär/Fallback-Stub + manuelle Preise
└── icons/                     # PWA-Icons 72–512 px
```

---

## 9. Funktionsdetails

**Strecken-Statusberechnung** (`geo.js`, `app.js`): Die für die Route bekannten
Autobahnen werden gegen die Autobahn-GmbH-API geprüft. Ereignisse, deren Koordinate
innerhalb des eingestellten Verkehrskorridors (Standard 500 m) der berechneten Route
liegt, bestimmen den Gesamtstatus. Eine **Sperrung direkt auf der Route ergibt immer
mindestens ROT**. Bundes-/Landstraßen (B-, S-Straßen) liefert die API nicht — die App
meldet dann ehrlich „keine DE-Autobahn-Abschnitte bekannt“, statt „frei“ vorzutäuschen.

**Benachrichtigungen** (`notify.js`): Nur wenn in den Einstellungen aktiviert. Es wird
nur bei einer **Verschlechterung** auf mindestens „behindert“ benachrichtigt — nicht bei
Besserung und nicht bei jedem Dashboard-Besuch.

**Backup** (`db.js`): Export erzeugt eine JSON-Datei mit allen Stores. Import ist ein
echter **Restore**, d. h. die betroffenen Stores werden vorher geleert, damit keine
alten Daten mit dem Backup vermischt werden.

**Offline** (`service-worker.js`): Nur die App-Shell (eigene Server-Origin) wird gecacht.
Externe API-/Kartenaufrufe laufen ohne Service-Worker-Eingriff, damit niemals veraltete
Live-Daten fälschlich als aktuell ausgegeben werden.

---

## 10. Datenschutz

- **Kein Konto, keine Cloud, kein Tracking.**
- Alle Daten (Strecken, Favoriten, Einstellungen, Cache) liegen in IndexedDB **auf dem Gerät**.
- Ausgehende Anfragen gehen ausschließlich an die in Abschnitt 7 genannten Dienste —
  Tankerkönig-Adressdaten werden nur für die Suche an Tankerkönig selbst gesendet.
- GPS wird nur nach expliziter Freigabe genutzt („Mein Standort“ / „In meiner Nähe suchen“).

---

## 11. Bekannte Einschränkungen

- **CZ-Verkehr & CZ-Kraftstoffpreise sind nicht live** verfügbar (Begründung siehe
  Abschnitt 6). CZ-Tankpreise lassen sich manuell pflegen.
- Der **öffentliche OSRM-Demo-Server** ist nur für geringe/private Nutzung gedacht —
  Antwortzeiten können schwanken. Für eine private App ist das die einzige bekannte
  kostenlose Option ohne eigenen Server (im Rahmen der Kostenregel).
- Die **Autobahn-GmbH-API** deckt nur Bundesautobahnen ab.
- **Benachrichtigungen** funktionieren nur, solange die App geöffnet ist — es gibt keinen
  Hintergrund-Server, der proaktiv pusht (bewusst, passend zur Kostenregel).
- Icons sind ein einfacher Tacho-Platzhalter.

---

## 12. Entwicklung

- Kein Framework, kein Bundler — einzelne Skripte in fester Reihenfolge in `index.html`.
- Die komplexe Status-/Provider-Logik wird über ein headless Smoke-Test-Skript automatisiert
  geprüft (DB-, Geo-, Routing-, Provider- und App-Integrationstests mit gemockten API-Antworten).
- Empfohlene Prüfungen vor Änderungen:
  ```bash
  node --check js/app.js && node --check js/db.js    # synaktischer Check
  ```

---

## 13. Definition of Done — Phasenstatus

- [x] **Phase 1.0** Grundgerüst — PWA, Navigation, Design, IndexedDB, GitHub-Pages-tauglich
- [x] **Phase 2.0** Karte — Leaflet + OpenStreetMap, Marker, Routen-Zeichnung, lazy-loaded
- [x] **Phase 3.0** Eigene Strecken — CRUD, Ortssuche, Routenberechnung
- [x] **Phase 4.0** Verkehr Deutschland — Autobahn GmbH API, Caching, Korridor-Filterung
- [x] **Phase 5.0** Verkehr Tschechien — Recherche dokumentiert; keine nutzbare
      kostenlose Quelle ohne eigenen Server gefunden → ehrlicher Stub
- [x] **Phase 6.0** Tankstellen Deutschland — Tankerkönig, Suche, Favoriten, Preise, Caching
- [x] **Phase 7.0** Tankstellen Tschechien — Recherche dokumentiert; Fallback manuelle
      Preiserfassung inkl. Bearbeiten; Provider-Architektur für spätere Fuelo-Anbindung
- [x] **Phase 8.0** Dashboard — Gesamtstatus-Berechnung, Favoriten mit Preisen
- [x] **Phase 9.0** Offline/PWA — Service Worker, App-Shell-Cache, Offline-Kennzeichnung
- [x] **Phase 10.0** Backup — Export/Import (echter Restore) inkl. Einstellungen
- [x] **Phase 11.0** Performance & UX — Leaflet lazy-loaded, Nominatim-debounced, schlanker Start
- [x] **Phase 12.0** Finale Version — Ende-zu-Ende mit gemockten echten API-Schemata getestet;
      Feinschliff: Benachrichtigungen angebunden, CZ-Preis-Edit, HTML-Escaping, Import-Restore

---

## 14. Version / Changelog

**v1.0 (funktionierende erste Version)**
- Alle Kernfunktionen umgesetzt (Status auf 12 Phasen, siehe oben).
- Automatisierter Smoke-Test: DB-, Geo-, Routing-, Traffic-, Fuel- und App-Integration
  laufen fehlerfrei durch.
- Letzte Korrekturdurchsicht: Benachrichtigung bei Verkehrsverschlechterung aktiv,
  CZ-Favoriten bearbeitbar, bessere Tschechien-Erkennung für Routen-Label,
  HTML-Escaping aller Nutzer-/Fremdeingaben, Import als echte Wiederherstellung,
  Stundenformat bei langen Fahrzeiten, Preisformat geputzt.

**v1.0.1 (Verkehrs-Erkennung repariert)**
- Autobahn-Erkennung robuster: OSRM-Straßennamen werden jetzt aus `ref` und `name`
  extrahiert und Toleranz für Schreibweisen wie „A 17“ berücksichtigt.
- Bereits gespeicherte Strecken werden beim Status-Check automatisch über OSRM
  aktualisiert, wenn keine Autobahn erkannt wurde — alte Strecken finden Baustellen
  damit ebenfalls.

**v1.0.2 (Verkehrs-Detailinfos)**
- Das Dashboard zeigt zu jeder relevanten Meldung **wo genau** (Titel + Abschnitt,
  Abstand zur Route), **was** los ist (Untertitel/Beschreibung) und **wie lange**
  (Start-/Endzeitpunkt bzw. Dauer aus den API-Zeitstempeln der Autobahn GmbH),
  sofern die API die Daten liefert.

**v1.1 (Dashboard-Übersicht & Preis-Anzeige)**
- **Dashboard als Hauptseite**: Alle Strecken erscheinen als übersichtliche Karten
  mit Verkehrsstatus-Pille (Strecke frei / Hinweis / behindert / gesperrt) sowie
  Fahrzeit, Distanz und Meldungsanzahl; Klick auf eine Karte öffnet den
  Strecken-Tab. Der Hero zeigt weiterhin die Standardstrecke.
- **Preise überall sichtbar**: Die Tanken-Ansicht zeigt zu jedem Favoriten jetzt
  ebenfalls die Preise (DE: E10/E5/Diesel live über Tankerkönig; CZ: Natural 95
  und Diesel aus der manuellen Erfassung) — nicht mehr nur Namen.
- Tschechische Preise bleiben bewusst manuell gepflegt: Die recherchierte
  Fuelo.net-API sendet keine CORS-Header, ein direkter Browserabruf ohne eigenen
  Server ist daher nicht möglich. Das Dashboard zeigt in so einem Fall klar den
  Pflege-Hinweis statt Live-Daten vorzutäuschen.