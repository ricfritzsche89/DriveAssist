/**
 * DRIVE CHECK — app.js
 * Orchestriert Router, Views und alle Provider (Phase 2–12 zusammengeführt).
 */

const VIEWS = ["dashboard", "routes", "map", "fuel", "settings", "warnungen"];

const STATUS_LABEL = {
  free: "STRECKE FREI",
  notice: "HINWEIS",
  hindered: "VERKEHRSBEHINDERUNG",
  closed: "GESPERRT",
  unknown: "STATUS UNBEKANNT",
};

let mainMap = null;      // Karte-View (Übersicht)
let routeFormMap = null; // Mini-Karte im Strecken-Formular
let editingRouteId = null;
let startPoint = null;   // {lat, lon, label}
let endPoint = null;
let editingCzFavId = null;

/** Entfernt HTML-Sonderzeichen aus Nutzer-/Fremddaten vor innerHTML-Einsatz. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Erkennt Routen, die (zumindest laut Adress-Labeln) Tschechien berühren. */
function labelLooksCzech(label) {
  if (!label) return false;
  return /(?:^|[^a-z])(?:praha|prag|brno|ostrava|liberec|plze[nň]|hradec|pardubice|olomouc|zl[ií]n|u[stš][tí]|teplice|jablonec|karlovy|cesk[eáy]|česk|tschech|czech|tsjech|cz)(?=$|[^a-z])/i.test(
    String(label)
  );
}

/* --------------------------------------------------------------------
 * Router
 * -------------------------------------------------------------------- */
function showView(name) {
  for (const v of VIEWS) {
    const el = document.getElementById(`view-${v}`);
    if (el) el.hidden = v !== name;
  }
  document.querySelectorAll("nav.tabbar button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === name);
  });
  window.location.hash = name;
  document.querySelector("main.view:not([hidden])")?.scrollTo(0, 0);

  // Ansichten beim Betreten frisch rendern, damit Änderungen aus anderen Tabs
  // (z. B. neuer Tankstellen-Favorit) sofort sichtbar sind.
  if (name === "map") initMainMap();
  if (name === "dashboard") renderDashboard();
  if (name === "routes") renderRoutes();
  if (name === "fuel") renderFuelView();
  if (name === "settings") renderSettings();
  if (name === "warnungen") renderWarnings();
}
window.showView = showView;

function initRouter() {
  document.querySelectorAll("nav.tabbar button").forEach((btn) => {
    btn.addEventListener("click", () => showView(btn.dataset.view));
  });
  const initial = (window.location.hash || "#dashboard").slice(1);
  showView(VIEWS.includes(initial) ? initial : "dashboard");
}

/* --------------------------------------------------------------------
 * Online/Offline
 * -------------------------------------------------------------------- */
function initConnectionState() {
  const el = document.getElementById("conn-state");
  function update() {
    if (!el) return;
    el.textContent = navigator.onLine ? "LIVE" : "OFFLINE";
    el.classList.toggle("offline", !navigator.onLine);
  }
  window.addEventListener("online", () => { update(); renderDashboard(); renderWarnings(); });
  window.addEventListener("offline", () => { update(); renderDashboard(); renderWarnings(); });
  update();
}

/* --------------------------------------------------------------------
 * Streckenstatus berechnen (Abschnitt 22: Routen-Check)
 * -------------------------------------------------------------------- */
async function computeRouteStatus(route) {
  if (!route.polyline || route.polyline.length === 0) {
    return { status: "unknown", reason: "Für diese Strecke liegt noch keine berechnete Route vor.", events: [] };
  }
  if (!navigator.onLine) {
    return { status: "unknown", reason: "Offline – Daten möglicherweise nicht aktuell.", events: [], offline: true };
  }

  const corridor = route.corridorMeters || (await DriveCheckDB.getSetting("corridorMeters", 500));
  const notes = [];
  let allEvents = [];

  // Für bereits gespeicherte Strecken ggf. die Straßen-Referenzen aktualisieren:
  // ältere Versionen haben Autobahnen oft nicht erkannt (siehe routing.js).
  let polyline = route.polyline;
  let roadNames = route.roadNames || [];
  const hasAutoRoad = roadNames.some((r) => /^A\d+/i.test(r));
  if (!hasAutoRoad && route.startCoord && route.endCoord) {
    const fresh = await window.RoutingProvider.getRoute([route.startCoord, route.endCoord]);
    if (fresh.available) {
      polyline = fresh.polyline;
      roadNames = fresh.roadNames;
      if (
        route.roadNames?.join("|") !== fresh.roadNames.join("|") ||
        route.distanceMeters !== fresh.distanceMeters ||
        route.durationSeconds !== fresh.durationSeconds
      ) {
        await DriveCheckDB.put(DriveCheckDB.STORES.routes, {
          ...route,
          polyline: fresh.polyline,
          roadNames: fresh.roadNames,
          distanceMeters: fresh.distanceMeters,
          durationSeconds: fresh.durationSeconds,
        });
      }
    }
  }

  const deRoads = roadNames.filter((r) => /^A\d+/i.test(r));
  if (deRoads.length > 0) {
    const { events, errors } = await window.TrafficProviderDE.getEventsForRoads(deRoads);
    allEvents.push(...events);
    errors.forEach((e) => notes.push(`DE (${e.roadId}): ${e.message}`));
  }

  const czResult = await window.TrafficProviderCZ.getEventsForRoute(route);
  if (!czResult.available && route.crossesCZ) {
    notes.push(czResult.reason);
  }

  const filtered = window.DriveCheckGeo.filterEventsByCorridor(allEvents, polyline, corridor);
  filtered.forEach((ev) => {
    ev.distanceToRoute = Math.round(
      window.DriveCheckGeo.pointToPolylineDistanceMeters({ lat: ev.latitude, lon: ev.longitude }, polyline)
    );
  });
  const status = filtered.length > 0 ? window.DriveCheckGeo.computeOverallStatus(filtered) : (deRoads.length > 0 ? "free" : "unknown");

  return {
    status,
    events: filtered,
    reason: filtered.length > 0
      ? filtered.map((e) => e.title).slice(0, 2).join(" · ")
      : (deRoads.length > 0 ? "Keine relevanten Verkehrsbehinderungen" : "Für diese Strecke sind keine DE-Autobahn-Abschnitte bekannt"),
    notes,
  };
}

/* --------------------------------------------------------------------
 * Ereignis-Details („wo genau · was · wie lange“)
 * -------------------------------------------------------------------- */
function fmtEventDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString("de-DE", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtEventTime(e) {
  if (!e) return "";
  const parts = [];
  if (e.endTime) {
    parts.push(`bis ${fmtEventDateTime(e.endTime)}`);
    if (e.startTime && Number.isFinite(e.endTime - e.startTime) && e.endTime - e.startTime > 0) {
      const ms = e.endTime - e.startTime;
      const h = Math.floor(ms / 3600000);
      const m = Math.round((ms % 3600000) / 60000);
      parts.push(m > 0 ? `Dauer ca. ${h} h ${m} min` : `Dauer ca. ${h} h`);
    }
  } else if (e.startTime) {
    parts.push(`seit ${fmtEventDateTime(e.startTime)}`);
  }
  return parts.join(" · ");
}

function incidentIcon(sev) {
  if (sev === "closed") return "🚫";
  if (sev === "hindered") return "🚧";
  if (sev === "notice") return "⚠️";
  return "ℹ️";
}

function timeAgo(ts) {
  if (!ts) return "";
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60000) return "gerade eben";
  if (diff < 3600000) return `vor ${Math.floor(diff / 60000)} min`;
  if (diff < 86400000) return `vor ${Math.floor(diff / 3600000)} h`;
  return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function incidentCardHtml(ev) {
  const sev = ev.severity || "notice";
  const metaParts = [];
  if (Number.isFinite(ev.distanceToRoute)) metaParts.push(`ca. ${ev.distanceToRoute} m neben der Route`);
  const dauer = fmtEventTime(ev);
  if (dauer) metaParts.push(dauer);
  return `
    <div class="incident-card">
      <span class="incident-ico ${sev}">${incidentIcon(sev)}</span>
      <div class="incident-body">
        <div class="incident-head ${sev}">
          <span class="incident-title">${esc(ev.title)}</span>
          <span class="incident-time">${esc(timeAgo(ev.startTime || ev.lastUpdated))}</span>
        </div>
        <div class="incident-sub">${esc(ev.description || ev.subtitle || "")}</div>
        ${metaParts.length ? `<div class="incident-meta">${esc(metaParts.join(" · "))}</div>` : ""}
      </div>
    </div>`;
}

/* --------------------------------------------------------------------
 * Dashboard
 * -------------------------------------------------------------------- */
function fmtDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  const min = Math.round(seconds / 60);
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${min} min`;
}

function fmtPriceEUR(v) {
  if (typeof v !== "number") return "–";
  const s = v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${s} €`;
}

function greetingText() {
  const h = new Date().getHours();
  if (h < 5) return "Gute Nacht";
  if (h < 11) return "Guten Morgen";
  if (h < 18) return "Guten Tag";
  return "Guten Abend";
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function updateCockpitClock() {
  const el = document.getElementById("cockpit-live-timestamp");
  if (el) {
    const now = new Date();
    const opts = { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" };
    el.textContent = now.toLocaleDateString("de-DE", opts).replace(",", " ·");
  }
  const g = document.getElementById("dash-greeting");
  if (g) g.textContent = greetingText();
}

function fmtEta(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  return new Date(Date.now() + seconds * 1000).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function progressAlongRoute(polyline, point) {
  if (!Array.isArray(polyline) || polyline.length < 2 || !point || !Number.isFinite(point.latitude)) return null;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const p = polyline[i];
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const dLat = p.lat - point.latitude;
    const dLon = (p.lon - point.longitude) * Math.cos((p.lat * Math.PI) / 180);
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best / (polyline.length - 1);
}

function flowCardHtml(route, events) {
  const poly = route?.polyline;
  const hasPoly = Array.isArray(poly) && poly.length >= 2;
  const segs = [];
  const seen = new Set();
  if (hasPoly) {
    for (const ev of events || []) {
      if (!ev || !Number.isFinite(ev.latitude) || !Number.isFinite(ev.longitude)) continue;
      const t = progressAlongRoute(poly, { latitude: ev.latitude, longitude: ev.longitude });
      if (t === null || seen.has(t)) continue;
      seen.add(t);
      segs.push({ t, sev: ev.severity || "notice" });
    }
  }
  const segHtml = segs.map((s) => {
    const left = clamp01(s.t) * 95;
    return `<span class="flow-seg ${s.sev}" style="left:${left.toFixed(1)}%;width:5%;"></span>`;
  }).join("");
  const start = (route?.startLabel || "Start").split(",")[0];
  const end = (route?.endLabel || "Ziel").split(",")[0];
  return `
    <div class="flow-card">
      <div class="flow-bar">${segHtml}<span class="flow-pos"></span></div>
      <div class="flow-labels">
        <span class="flow-start">${esc(start)}</span>
        <span class="flow-end">${esc(end)}</span>
      </div>
      <div class="flow-legend">
        <span><i class="free"></i>frei</span>
        <span><i class="notice"></i>Hinweis</span>
        <span><i class="hindered"></i>behindert</span>
        <span><i class="closed"></i>gesperrt</span>
      </div>
      ${!hasPoly ? `<div class="flow-empty">Keine Routenpositionsdaten – Verteilung nur schematisch.</div>` : ""}
    </div>`;
}

async function dashboardFuelPrices(f) {
  if (f.country === "DE") {
    const r = await window.FuelProviderDE.getPrices([f.stationId]);
    const p = r.prices?.[f.stationId];
    if (p && (Number.isFinite(p.diesel) || Number.isFinite(p.e10))) {
      return { live: true, diesel: p.diesel, e10: p.e10 };
    }
    return { live: false, note: r.reason || "Preise nicht verfügbar" };
  }
  const r = await window.FuelProviderCZ.getPrices(f.id);
  if (r.available) return { manual: true, prices: r.prices };
  return { manual: true, note: r.reason || "keine Preise hinterlegt" };
}

function fuelCardHtml(f, prices, bestStationId) {
  const flag = f.country === "CZ" ? "🇨🇿" : "🇩🇪";
  const isBest = f.country === "DE" && !!bestStationId && f.stationId === bestStationId;
  const badges = [];
  if (isBest) badges.push('<span class="pf-badge best">Bestpreis</span>');
  if (prices.live) badges.push('<span class="pf-badge live">Live</span>');
  else if (prices.manual) badges.push('<span class="pf-badge manual">manuell</span>');
  const sub = f.country === "CZ"
    ? (prices.manual && prices.prices ? "Manuell gepflegte Preise" : prices.note || "keine Preise hinterlegt")
    : (prices.live ? "Live-Preise via Tankerkönig" : prices.note || "Preise nicht verfügbar");
  let grid = "";
  if (prices.live && Number.isFinite(prices.diesel) && Number.isFinite(prices.e10)) {
    grid = `
      <div class="price-grid">
        <div class="price-cell ${isBest ? "best" : ""}"><span class="price-label">Diesel</span><span class="price-val">${esc(fmtPriceEUR(prices.diesel))}</span></div>
        <div class="price-cell"><span class="price-label">E10</span><span class="price-val">${esc(fmtPriceEUR(prices.e10))}</span></div>
      </div>`;
  } else if (prices.manual && prices.prices) {
    const cells = [];
    if (Number.isFinite(prices.prices.natural95)) cells.push(['<span class="price-label">Natural 95</span>', `${esc(String(prices.prices.natural95))} Kč`]);
    if (Number.isFinite(prices.prices.diesel)) cells.push(['<span class="price-label">Diesel</span>', `${esc(String(prices.prices.diesel))} Kč`]);
    if (cells.length) {
      grid = `<div class="price-grid">${cells.map(([lab, val]) => `<div class="price-cell"><div>${lab}</div><span class="price-val">${val}</span></div>`).join("")}</div>`;
    }
  }
  return `
    <div class="fuel-card">
      <div class="fuel-card-head">
        <div>
          <div class="fuel-card-name">${flag} ${esc(f.label)}</div>
          <div class="fuel-card-badges">${badges.join("")}</div>
          <div class="fuel-card-sub">${esc(sub)}</div>
        </div>
        <button class="fuel-mini fuel-card-cta" data-go="fuel">Preise</button>
      </div>
      ${grid}
    </div>`;
}

function bindQuickAccess() {
  document.querySelectorAll("#view-dashboard .quick-item").forEach((el) => {
    if (el.dataset.bound) return;
    el.addEventListener("click", () => showView(el.dataset.go));
    el.dataset.bound = "1";
  });
}

function startNavigation(route) {
  const s = route?.startCoord;
  const e = route?.endCoord;
  if (s && e && Number.isFinite(s.lat) && Number.isFinite(e.lat)) {
    if (!navigator.onLine) {
      toast("Offline – Navigation ist ohne Verbindung nicht möglich.");
      return;
    }
    const o = `${s.lat},${s.lon}`;
    const d = `${e.lat},${e.lon}`;
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=driving`, "_blank", "noopener");
    return;
  }
  toast("Für diese Strecke liegen keine Koordinaten vor.");
}

async function renderDashboard() {
  updateCockpitClock();
  const routes = await DriveCheckDB.getAll(DriveCheckDB.STORES.routes);
  const favs = await DriveCheckDB.getAll(DriveCheckDB.STORES.fuelFavorites);
  const listEl = document.getElementById("dash-pairs");
  const addBtn = document.getElementById("dash-add-route");
  const favCountEl = document.getElementById("dash-fav-count");

  if (favCountEl) favCountEl.textContent = `${favs.length} Favorit${favs.length === 1 ? "" : "en"}`;
  if (addBtn && !addBtn.dataset.bound) {
    addBtn.dataset.bound = "1";
    addBtn.addEventListener("click", () => showView(favs.length ? "fuel" : "routes"));
  }

  const resultsByRouteId = {};
  if (routes.length) {
    await Promise.all(routes.map(async (r) => { resultsByRouteId[r.id] = await computeRouteStatus(r); }));
  }

  dashboardWarnings = routes.map((r) => ({
    routeName: r.name,
    status: resultsByRouteId[r.id]?.status || "unknown",
    offline: resultsByRouteId[r.id]?.offline || !navigator.onLine,
    reason: resultsByRouteId[r.id]?.reason || "",
    events: resultsByRouteId[r.id]?.events || [],
  }));

  const notifyEnabled = await DriveCheckDB.getSetting("notifyEnabled", false);
  if (notifyEnabled) {
    for (const route of routes) {
      const result = resultsByRouteId[route.id];
      if (!result) continue;
      const prev = await DriveCheckDB.get(DriveCheckDB.STORES.settings, `routeStatus_${route.id}`);
      const prevStatus = prev?.value?.status || null;
      if (prevStatus && prevStatus !== result.status) {
        window.DriveCheckNotify.notifyOnDegradation(route.name, prevStatus, result.status);
      }
      await DriveCheckDB.setSetting(`routeStatus_${route.id}`, {
        status: result.status,
        at: new Date().toISOString(),
      });
    }
  }

  if (!routes.length) {
    listEl.innerHTML = `
      <div class="pair-empty">
        <span class="material-symbols-outlined">alt_route</span>
        <p><strong>Noch keine Strecke.</strong><br>Lege deine erste Strecke an, um Live-Status und Bestpreis direkt nebeneinander zu sehen.</p>
        <button class="btn primary" data-go-add="1">Strecke anlegen</button>
      </div>`;
    listEl.querySelector("[data-go-add]")?.addEventListener("click", () => showView("routes"));
    return;
  }

  const favRows = await Promise.all(favs.map(async (f) => ({ f, prices: await dashboardFuelPrices(f) })));
  const assigned = new Set();
  const pairs = routes.map((route) => {
    let favRow = null;
    const priceCands = favRows
      .filter((r) => !assigned.has(r.f.id) && favPriceMetric(r) != null)
      .sort((a, b) => favPriceMetric(a) - favPriceMetric(b));
    if (priceCands.length) {
      favRow = priceCands[0];
    } else {
      const distCands = favRows
        .filter((r) => !assigned.has(r.f.id) && Number.isFinite(r.f.lat) && Number.isFinite(r.f.lon))
        .map((r) => ({ r, d: favDistanceToRoute(r, route) ?? Infinity }))
        .sort((a, b) => a.d - b.d);
      if (distCands.length) favRow = distCands[0].r;
    }
    if (favRow) assigned.add(favRow.f.id);
    return { route, favRow };
  });

  listEl.innerHTML = pairs.map(({ route, favRow }) => {
    const result = resultsByRouteId[route.id] || { status: "unknown" };
    const chip = statusChip(result.status, result.offline || !navigator.onLine);
    const metaBits = [];
    if (route.distanceMeters) metaBits.push(fmtKm(route.distanceMeters));
    if (route.durationSeconds) metaBits.push(fmtDuration(route.durationSeconds));
    const reason = result.reason || (result.status === "unknown" ? "Status unbekannt – Strecke erneut berechnen" : "Keine Behinderungen");
    const subtitle = `${shortLabel(route.startLabel)} → ${shortLabel(route.endLabel)}`;
    let alertLine = "";
    if (result.events?.length) {
      const icons = { notice: "⚠️", hindered: "🚧", closed: "🚫" };
      alertLine = `<span class="route-alerts">${icons[result.status] || "ℹ️"} ${result.events.length} Meldung(en) auf der Strecke</span>`;
    }
    return `
      <div class="pair-card">
        <div class="pair-head">
          <span class="pair-ico material-symbols-outlined ${chip.cls}">${chip.icon}</span>
          <div class="pair-titles">
            <span class="pair-title">${esc(route.name)}</span>
            <span class="pair-sub">${esc(subtitle)}</span>
          </div>
          <span class="status-chip ${chip.cls}">${chip.text}</span>
        </div>
        <div class="pair-body">
          <div class="pair-col col-route">
            <span class="pair-caption"><span class="material-symbols-outlined">alt_route</span>Stre&shy;cke</span>
            <div class="route-metrics">
              ${metaBits.map((m) => `<span class="route-metric">${esc(m)}</span>`).join("")}
            </div>
            <span class="route-reason">${esc(reason)}</span>
            ${alertLine}
          </div>
          <div class="pair-col col-station">
            <span class="pair-caption"><span class="material-symbols-outlined">local_gas_station</span>Bestpreis</span>
            ${favRow ? stationBlockHtml(favRow, route) : `<div class="station-empty">Kein Favorit in der Nähe – <a href="#" data-go-fuel="1">Favorit hinzufügen</a></div>`}
          </div>
        </div>
      </div>`;
  }).join("");

  listEl.querySelectorAll("[data-go-fuel]").forEach((el) =>
    el.addEventListener("click", (e) => { e.preventDefault(); showView("fuel"); })
  );
}

/* --------------------------------------------------------------------
 * Dashboard-Helfer (v1.4)
 * -------------------------------------------------------------------- */
let dashboardWarnings = [];

function shortLabel(label) {
  return String(label || "").split(",")[0].trim() || "?";
}

function fmtKm(meters) {
  if (!Number.isFinite(meters)) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1).replace(/\.0$/, "")} km`;
}

function statusChip(status, offline) {
  const map = {
    free: { cls: "status-free", icon: "check_circle", text: "FREI" },
    notice: { cls: "status-notice", icon: "info", text: "HINWEIS" },
    hindered: { cls: "status-hindered", icon: "warning_amber", text: "BEHINDERT" },
    closed: { cls: "status-closed", icon: "block", text: "GESPERRT" },
    unknown: { cls: "status-unknown", icon: "help", text: offline ? "OFFLINE" : "UNBEKANNT" },
  };
  return map[status] || map.unknown;
}

function favPriceMetric(r) {
  if (r.f.country === "DE") {
    if (Number.isFinite(r.prices.diesel)) return r.prices.diesel;
    if (Number.isFinite(r.prices.e10)) return r.prices.e10;
    return null;
  }
  if (r.prices.manual) {
    if (Number.isFinite(r.prices.prices?.natural95)) return r.prices.prices.natural95;
    if (Number.isFinite(r.prices.prices?.diesel)) return r.prices.prices.diesel;
  }
  return null;
}

function favDistanceToRoute(r, route) {
  const lat = r.f.lat, lon = r.f.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const poly = route.polyline;
  if (Array.isArray(poly) && poly.length) {
    const d = window.DriveCheckGeo.pointToPolylineDistanceMeters({ lat, lon }, poly);
    return Number.isFinite(d) ? d : null;
  }
  const s = route.startCoord;
  if (s && Number.isFinite(s.lat)) return window.DriveCheckGeo.haversineDistance(s.lat, s.lon, lat, lon);
  return null;
}

function stationBlockHtml(fr, route) {
  const f = fr.f;
  const live = f.country === "DE";
  const dist = favDistanceToRoute(fr, route);
  let priceVal = null, priceSub = "";
  if (live && Number.isFinite(fr.prices.diesel)) { priceVal = fmtPriceEUR(fr.prices.diesel); priceSub = "Diesel"; }
  else if (live && Number.isFinite(fr.prices.e10)) { priceVal = fmtPriceEUR(fr.prices.e10); priceSub = "E10"; }
  else if (fr.prices.manual && Number.isFinite(fr.prices.prices?.natural95)) { priceVal = `${fr.prices.prices.natural95} Kč`; priceSub = "Natural 95"; }
  else if (fr.prices.manual && Number.isFinite(fr.prices.prices?.diesel)) { priceVal = `${fr.prices.prices.diesel} Kč`; priceSub = "Diesel"; }
  const badgeText = fr.prices.live ? "Live" : (live ? "keine Live-Preise" : "manuell");
  const badgeCls = fr.prices.live ? "live" : "manual";
  return `
    <div class="station-card">
      <div class="station-head">
        <span class="station-flag">${live ? "🇩🇪" : "🇨🇿"}</span>
        <span class="station-name">${esc(f.label)}</span>
      </div>
      <div class="station-price">
        <span class="station-price-val">${priceVal != null ? esc(String(priceVal)) : "—"}</span>
        <span class="station-price-sub">${esc(priceSub)}</span>
      </div>
      <div class="station-meta">
        <span class="pf-badge ${badgeCls}">${esc(badgeText)}</span>
        ${dist != null ? `<span class="station-dist">${esc(fmtKm(dist))} neben der Route</span>` : ""}
      </div>
    </div>`;
}

/* --------------------------------------------------------------------
 * Warnungen-View (v1.4)
 * -------------------------------------------------------------------- */
function renderWarnings() {
  const listEl = document.getElementById("warnings-list");
  const chipEl = document.getElementById("warnings-chip");
  const active = dashboardWarnings.filter((w) => w.status === "hindered" || w.status === "closed").length;
  if (chipEl) chipEl.textContent = active === 1 ? "1 AKTIVE WARNUNG" : `${active} AKTIVE WARNUNGEN`;
  if (!dashboardWarnings.length) {
    if (listEl) listEl.innerHTML = `
      <div class="warning-empty">
        <span class="material-symbols-outlined">verified_user</span>
        <p>Keine Streckenmeldungen. Öffne die Übersicht, um deine Strecken auf Behinderungen zu prüfen.</p>
      </div>`;
    return;
  }
  if (listEl) listEl.innerHTML = dashboardWarnings.map((w) => {
    const chip = statusChip(w.status, w.offline);
    return `
      <div class="warning-group ${chip.cls}">
        <div class="warning-head">
          <span class="status-chip ${chip.cls}">${chip.text}</span>
          <span class="warning-route">${esc(w.routeName)}</span>
        </div>
        <div class="warning-reason">${esc(w.reason)}</div>
        ${w.events?.length ? `<div class="warning-events">${w.events.map(incidentCardHtml).join("")}</div>` : ""}
      </div>`;
  }).join("");
}

/* --------------------------------------------------------------------
 * Strecken-Ansicht: Liste + CRUD
 * -------------------------------------------------------------------- */
async function renderRoutes() {
  const listEl = document.getElementById("routes-list");
  const routes = await DriveCheckDB.getAll(DriveCheckDB.STORES.routes);
  const defaultRouteId = await DriveCheckDB.getSetting("defaultRouteId", null);

  if (!routes.length) {
    listEl.innerHTML = `<div class="empty-state"><p>Noch keine Strecken angelegt.</p></div>`;
    return;
  }
  listEl.innerHTML = `<div class="card-list">${routes.map((r) => `
    <div class="row-card">
      <span class="dot ${r.id === defaultRouteId ? 'free' : 'unknown'}"></span>
      <div>
        <div class="rc-title">${esc(r.name)}${r.id === defaultRouteId ? " ★" : ""}</div>
        <div class="rc-sub">${esc(r.startLabel) || "?"} → ${esc(r.endLabel) || "?"}${r.distanceMeters ? ` · ${Math.round(r.distanceMeters/1000)} km` : ""}</div>
      </div>
      <div class="rc-value">
        <button class="btn ghost" data-edit="${esc(r.id)}" style="padding:6px 10px;width:auto;font-size:0.72rem;">Bearbeiten</button>
        <button class="btn danger" data-del="${esc(r.id)}" style="padding:6px 10px;width:auto;font-size:0.72rem;margin-top:4px;">Löschen</button>
      </div>
    </div>`).join("")}</div>`;

  listEl.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await DriveCheckDB.delete(DriveCheckDB.STORES.routes, btn.dataset.del);
      toast("Strecke gelöscht");
      await renderRoutes();
      await renderDashboard();
    });
  });
  listEl.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => loadRouteIntoForm(btn.dataset.edit));
  });
}

async function loadRouteIntoForm(routeId) {
  const route = await DriveCheckDB.get(DriveCheckDB.STORES.routes, routeId);
  if (!route) return;
  editingRouteId = routeId;
  document.getElementById("route-name").value = route.name;
  document.getElementById("route-start-search").value = route.startLabel || "";
  document.getElementById("route-end-search").value = route.endLabel || "";
  document.getElementById("route-corridor").value = String(route.corridorMeters || 500);
  startPoint = route.startCoord ? { ...route.startCoord, label: route.startLabel } : null;
  endPoint = route.endCoord ? { ...route.endCoord, label: route.endLabel } : null;
  document.getElementById("route-form-title").textContent = "Strecke bearbeiten";
  document.getElementById("route-cancel-edit").hidden = false;
  updateRouteFormPreview();
}

function resetRouteForm() {
  editingRouteId = null;
  startPoint = null;
  endPoint = null;
  document.getElementById("route-form").reset();
  document.getElementById("route-form-title").textContent = "Neue Strecke";
  document.getElementById("route-cancel-edit").hidden = true;
  document.getElementById("route-preview").innerHTML = "";
}

function attachGeocodeSearch(inputId, resultsId, onSelect) {
  const input = document.getElementById(inputId);
  const results = document.getElementById(resultsId);
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    const q = input.value;
    timer = setTimeout(async () => {
      if (q.trim().length < 3) { results.innerHTML = ""; return; }
      try {
        const matches = await window.RoutingProvider.geocode(q);
        results.innerHTML = matches.map((m, i) =>
          `<button type="button" class="btn ghost" data-i="${i}" style="text-align:left;font-size:0.78rem;padding:9px 12px;margin-top:4px;">${esc(m.label)}</button>`
        ).join("");
        results.querySelectorAll("button").forEach((b, i) => {
          b.addEventListener("click", () => {
            const m = matches[i];
            input.value = m.label;
            results.innerHTML = "";
            onSelect(m);
          });
        });
      } catch {
        results.innerHTML = `<div style="font-size:0.72rem;color:var(--text-low);margin-top:4px;">Ortssuche momentan nicht erreichbar.</div>`;
      }
    }, 500);
  });
}

async function updateRouteFormPreview() {
  const previewEl = document.getElementById("route-preview");
  if (!startPoint || !endPoint) {
    previewEl.innerHTML = "";
    return;
  }
  previewEl.innerHTML = `<div class="detail">Route wird berechnet …</div>`;
  const result = await window.RoutingProvider.getRoute([startPoint, endPoint]);
  if (!result.available) {
    previewEl.innerHTML = `<div class="detail" style="color:var(--status-hindered)">${result.reason}</div>`;
    document.getElementById("route-form").dataset.route = "";
    return;
  }
  document.getElementById("route-form").dataset.route = JSON.stringify(result);
  previewEl.innerHTML = `<div class="detail">${Math.round(result.distanceMeters/1000)} km · ${fmtDuration(result.durationSeconds)}${result.roadNames.length ? " · über " + result.roadNames.slice(0,4).join(", ") : ""}</div>`;

  const mapEl = document.getElementById("route-map");
  if (mapEl) {
    try {
      if (!routeFormMap) routeFormMap = await window.DriveCheckMap.createMap("route-map", { center: [startPoint.lat, startPoint.lon], zoom: 8 });
      routeFormMap.clearMarkers();
      routeFormMap.addMarker(startPoint.lat, startPoint.lon, { category: "start", popup: "Start" });
      routeFormMap.addMarker(endPoint.lat, endPoint.lon, { category: "end", popup: "Ziel" });
      routeFormMap.drawRoute(result.polyline);
    } catch {
      mapEl.innerHTML = `<div class="empty-state" style="padding:16px"><p style="margin:0">Kartenvorschau momentan nicht verfügbar.</p></div>`;
    }
  }
}

function initRouteForm() {
  const form = document.getElementById("route-form");
  if (!form) return;

  attachGeocodeSearch("route-start-search", "route-start-results", (m) => {
    startPoint = m; updateRouteFormPreview();
  });
  attachGeocodeSearch("route-end-search", "route-end-results", (m) => {
    endPoint = m; updateRouteFormPreview();
  });

  document.getElementById("route-cancel-edit")?.addEventListener("click", resetRouteForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = document.getElementById("route-name").value.trim();
    const startLabel = document.getElementById("route-start-search").value.trim();
    const endLabel = document.getElementById("route-end-search").value.trim();
    const corridorMeters = Number(document.getElementById("route-corridor").value);
    if (!name || !startLabel || !endLabel) return;

    if (!startPoint || !endPoint) {
      toast("Bitte Start- und Zielpunkt aus den Suchvorschlägen wählen");
      return;
    }

    let routeData = {};
    if (form.dataset.route) {
      try { routeData = JSON.parse(form.dataset.route); } catch { routeData = {}; }
    }

    const record = {
      id: editingRouteId || `route_${Date.now()}`,
      name,
      startLabel,
      endLabel,
      startCoord: startPoint ? { lat: startPoint.lat, lon: startPoint.lon } : null,
      endCoord: endPoint ? { lat: endPoint.lat, lon: endPoint.lon } : null,
      corridorMeters,
      polyline: routeData.polyline || null,
      distanceMeters: routeData.distanceMeters || null,
      durationSeconds: routeData.durationSeconds || null,
      roadNames: routeData.roadNames || [],
      crossesCZ: labelLooksCzech(`${startLabel} ${endLabel}`),
      createdAt: new Date().toISOString(),
    };

    await DriveCheckDB.put(DriveCheckDB.STORES.routes, record);
    toast(editingRouteId ? "Strecke aktualisiert" : "Strecke gespeichert");
    resetRouteForm();
    await renderRoutes();
    await renderDashboard();
    showView("dashboard");
  });
}

/* --------------------------------------------------------------------
 * Karte-Ansicht
 * -------------------------------------------------------------------- */
async function initMainMap() {
  const canvas = document.getElementById("map-canvas");
  if (!canvas) return;
  try {
    if (!mainMap) {
      mainMap = await window.DriveCheckMap.createMap("map-canvas", { center: [50.5, 14.5], zoom: 6 });
    } else {
      mainMap.invalidateSize();
      mainMap.clearMarkers();
    }
  } catch (err) {
    canvas.innerHTML = `<div class="empty-state"><p>Karte momentan nicht verfügbar (kein Internetzugriff auf die Kartenkacheln). Gespeicherte Strecken und Favoriten bleiben trotzdem erhalten.</p></div>`;
    return;
  }

  const routes = await DriveCheckDB.getAll(DriveCheckDB.STORES.routes);
  for (const r of routes) {
    if (r.startCoord) mainMap.addMarker(r.startCoord.lat, r.startCoord.lon, { category: "start", popup: `${esc(r.name)}: Start` });
    if (r.endCoord) mainMap.addMarker(r.endCoord.lat, r.endCoord.lon, { category: "end", popup: `${esc(r.name)}: Ziel` });
    if (r.polyline) mainMap.drawRoute(r.polyline);
  }

  const favs = await DriveCheckDB.getAll(DriveCheckDB.STORES.fuelFavorites);
  for (const f of favs) {
    if (f.lat && f.lon) mainMap.addMarker(f.lat, f.lon, { category: "favorite", popup: esc(f.label) });
  }

  if (!routes.length && !favs.length) mainMap.fitToMarkers();
}

function initGeolocateButton() {
  document.getElementById("map-locate")?.addEventListener("click", () => {
    if (!navigator.geolocation) { toast("Standort wird von diesem Gerät nicht unterstützt"); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (mainMap) {
          mainMap.raw.setView([pos.coords.latitude, pos.coords.longitude], 13);
          mainMap.addMarker(pos.coords.latitude, pos.coords.longitude, { category: "waypoint", popup: "Mein Standort" });
        }
      },
      () => toast("Standort konnte nicht ermittelt werden"),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  });
}

/* --------------------------------------------------------------------
 * Tankstellen-Ansicht
 * -------------------------------------------------------------------- */
async function renderFuelView() {
  const favs = await DriveCheckDB.getAll(DriveCheckDB.STORES.fuelFavorites);
  const listEl = document.getElementById("fuel-favorites-list");
  const segEl = document.getElementById("fuel-mode");
  const mode = (await DriveCheckDB.getSetting("fuelViewMode", "diesel")) === "benzin" ? "benzin" : "diesel";
  segEl?.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));

  if (!favs.length) {
    listEl.innerHTML = `<div class="empty-state"><p>Noch keine Favoriten. Suche unten eine Tankstelle oder lege einen CZ-Favoriten manuell an.</p></div>`;
    return;
  }

  const rate = await getEurCzkRate();
  const tiles = (await Promise.all(favs.map(async (f) => {
    const row = await loadFuelFavData(f);
    const isCz = f.country === "CZ";
    const primaryKey = isCz ? (mode === "benzin" ? "natural95" : "diesel") : (mode === "benzin" ? "e5" : "diesel");
    const primary = Number.isFinite(row.prices?.[primaryKey]) ? row.prices[primaryKey] : null;
    return {
      f, row, isCz, mode,
      primary,
      primaryEur: isCz && primary != null && rate ? primary / rate : null,
      hasMissing: !row.source || (primary == null),
    };
  }))).sort((a, b) => (a.primary ?? Infinity) - (b.primary ?? Infinity));

  listEl.innerHTML = `<div class="fuel-list">${tiles.map(fuelTileHtml).join("")}</div>`;

  listEl.querySelectorAll("[data-favdel]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await DriveCheckDB.delete(DriveCheckDB.STORES.fuelFavorites, btn.dataset.favdel);
      toast("Favorit entfernt");
      renderFuelView();
      renderDashboard();
    });
  });
  listEl.querySelectorAll("[data-czedit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const fav = favs.find((f) => f.id === btn.dataset.czedit);
      if (fav) editCzFavorite(fav);
    });
  });
}

function fuelTileHtml(t) {
  const { f, row, isCz, primary, primaryEur, hasMissing } = t;
  const fuelLabel = isCz
    ? { natural95: "Natural 95", diesel: "Diesel" }
    : { e5: "E5", e10: "E10", diesel: "Diesel" };
  const unit = isCz ? "Kč" : "€";
  const metaParts = [];
  if (isCz) {
    if (Number.isFinite(row.prices?.natural95)) metaParts.push(`${fuelLabel.natural95} ${fmtPricePlain(row.prices.natural95)} Kč`);
    if (Number.isFinite(row.prices?.diesel)) metaParts.push(`${fuelLabel.diesel} ${fmtPricePlain(row.prices.diesel)} Kč`);
  } else {
    if (Number.isFinite(row.prices?.e5)) metaParts.push(`${fuelLabel.e5} ${fmtPricePlain(row.prices.e5)} €`);
    if (Number.isFinite(row.prices?.e10)) metaParts.push(`${fuelLabel.e10} ${fmtPricePlain(row.prices.e10)} €`);
    if (Number.isFinite(row.prices?.diesel)) metaParts.push(`${fuelLabel.diesel} ${fmtPricePlain(row.prices.diesel)} €`);
  }

  const editBtn = isCz
    ? `<button class="fuel-mini" data-czedit="${esc(f.id)}">Preise eintragen</button>`
    : "";
  const missingNote = hasMissing
    ? (isCz ? "Manuell pflegen" : "Preise derzeit nicht verfügbar")
    : (row.source === "manuell" ? "Manuell gepflegt" : "");

  return `
    <div class="fuel-tile">
      <span class="dot ${f.country === 'DE' ? 'free' : 'unknown'}"></span>
      <div class="fuel-info">
        <div class="fuel-name">${f.country === "CZ" ? "🇨🇿" : "🇩🇪"} ${esc(f.label)}</div>
        <div class="fuel-meta">${metaParts.length ? esc(metaParts.join(" · ")) : "–"}</div>
        <div class="fuel-adds">
          ${missingNote ? `<span class="fuel-note">${esc(missingNote)}</span>` : `<span class="fuel-live">Live</span>`}
          ${row.freshness ? `<span class="fuel-time">vor ${esc(row.freshness)}</span>` : ""}
          <span style="flex:1"></span>
          ${editBtn}
          <button class="fuel-mini danger" data-favdel="${esc(f.id)}">×</button>
        </div>
      </div>
      <div class="fuel-price">
        ${hasMissing
          ? `<div class="fuel-num muted">–</div><div class="fuel-sub">kein Preis</div>`
          : `<div class="fuel-num">${fmtPricePlain(primary)}<small> ${unit}</small></div>${primaryEur ? `<div class="fuel-sub">≈ ${fmtPriceEUR(primaryEur)}</div>` : ""}`}
      </div>
    </div>`;
}

function fmtPricePlain(v) {
  if (!Number.isFinite(v)) return "–";
  return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function fmtRelative(ts) {
  const ms = Date.now() - (new Date(ts).getTime() || 0);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return new Date(ts).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

/** Strukturierte Preis-Daten für einen Favoriten (DE live, CZ manuell + Freshness). */
async function loadFuelFavData(f) {
  let prices = null;
  let source = null;
  let freshness = "";
  if (f.country === "DE") {
    const r = await window.FuelProviderDE.getPrices([f.stationId]);
    const p = r.prices?.[f.stationId];
    if (p) {
      prices = { e5: p.e5, e10: p.e10, diesel: p.diesel };
      source = "live";
      if (p.lastUpdated) freshness = fmtRelative(p.lastUpdated);
    }
  } else {
    const r = await window.FuelProviderCZ.getPrices(f.id);
    if (r.available) {
      prices = { natural95: r.prices?.natural95 ?? null, diesel: r.prices?.diesel ?? null };
      source = "manuell";
      if (f.lastUpdated) freshness = fmtRelative(f.lastUpdated);
    }
  }
  return { f, prices, source, freshness };
}

/** Wechselkurs EUR→CZK (kostenloser ECB-Dienst via frankfurter.app, ohne Key, mit CORS). */
async function getEurCzkRate() {
  const CACHE_MS = 6 * 3600 * 1000;
  const cached = window.DriveCheckDB
    ? await window.DriveCheckDB.get(window.DriveCheckDB.STORES.trafficCache, "fx_eur_czk")
    : null;
  if (cached && Date.now() - new Date(cached.lastUpdated).getTime() < CACHE_MS && Number.isFinite(cached.rate)) {
    return cached.rate;
  }
  try {
    const res = await fetch("https://api.frankfurter.app/latest?base=EUR&symbols=CZK");
    if (res.ok) {
      const j = await res.json();
      const rate = Number(j.rates?.CZK);
      if (Number.isFinite(rate)) {
        if (window.DriveCheckDB) {
          await window.DriveCheckDB.put(window.DriveCheckDB.STORES.trafficCache, {
            id: "fx_eur_czk",
            rate,
            lastUpdated: new Date().toISOString(),
          });
        }
        return rate;
      }
    }
  } catch { /* offline */ }
  return cached && Number.isFinite(cached.rate) ? cached.rate : null;
}

function initFuelModeSegments() {
  document.getElementById("fuel-mode")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    await DriveCheckDB.setSetting("fuelViewMode", btn.dataset.mode);
    renderFuelView();
  });
}

function editCzFavorite(fav) {
  editingCzFavId = fav.id;
  document.getElementById("fuel-cz-label").value = fav.label || "";
  document.getElementById("fuel-cz-natural95").value = fav.manualPrices?.natural95 ?? "";
  document.getElementById("fuel-cz-diesel").value = fav.manualPrices?.diesel ?? "";
  document.getElementById("fuel-cz-form-title").textContent = "🇨🇿 CZ-FAVORIT BEARBEITEN";
  document.getElementById("fuel-cz-submit").textContent = "Favorit aktualisieren";
  document.getElementById("fuel-cz-cancel").hidden = false;
  document.getElementById("view-fuel")?.scrollTo(0, 0);
}

function resetCzForm() {
  editingCzFavId = null;
  document.getElementById("fuel-cz-form")?.reset();
  document.getElementById("fuel-cz-form-title").textContent = "🇨🇿 CZ-FAVORIT MANUELL ANLEGEN";
  document.getElementById("fuel-cz-submit").textContent = "Favorit speichern";
  document.getElementById("fuel-cz-cancel").hidden = true;
}

function initFuelSearchDE() {
  const btn = document.getElementById("fuel-search-de-btn");
  const resultsEl = document.getElementById("fuel-search-de-results");
  btn?.addEventListener("click", async () => {
    if (!navigator.geolocation) { toast("Standort wird nicht unterstützt"); return; }
    resultsEl.innerHTML = `<div class="detail">Suche Tankstellen in der Nähe …</div>`;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const r = await window.FuelProviderDE.searchStations(pos.coords.latitude, pos.coords.longitude, 8);
      if (!r.available) { resultsEl.innerHTML = `<div class="detail" style="color:var(--status-hindered)">${r.reason}</div>`; return; }
      resultsEl.innerHTML = `<div class="card-list">${r.stations.slice(0, 12).map((s) => `
        <div class="row-card">
          <span class="dot free"></span>
          <div><div class="rc-title">${s.brand || s.name}</div><div class="rc-sub">${s.street || ""} ${s.houseNumber || ""}, ${s.place || ""}</div></div>
          <div class="rc-value"><button class="btn ghost" data-addfav="${s.id}" style="padding:6px 10px;width:auto;font-size:0.72rem;">+ Favorit</button></div>
        </div>`).join("")}</div>`;
      resultsEl.querySelectorAll("[data-addfav]").forEach((b) => {
        b.addEventListener("click", async () => {
          const station = r.stations.find((s) => s.id === b.dataset.addfav);
          await DriveCheckDB.put(DriveCheckDB.STORES.fuelFavorites, {
            id: `fav_de_${station.id}`,
            country: "DE",
            stationId: station.id,
            label: station.brand || station.name,
            lat: station.lat,
            lon: station.lng,
            createdAt: new Date().toISOString(),
          });
          toast("Als Favorit gespeichert");
          renderFuelView();
        });
      });
    }, () => { resultsEl.innerHTML = `<div class="detail" style="color:var(--status-hindered)">Standort konnte nicht ermittelt werden.</div>`; });
  });
}

function initFuelFormCZ() {
  const form = document.getElementById("fuel-cz-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = document.getElementById("fuel-cz-label").value.trim();
    const natural95 = parseFloat(document.getElementById("fuel-cz-natural95").value) || null;
    const diesel = parseFloat(document.getElementById("fuel-cz-diesel").value) || null;
    if (!label) return;

    if (editingCzFavId) {
      const existing = await DriveCheckDB.get(DriveCheckDB.STORES.fuelFavorites, editingCzFavId);
      if (existing) {
        await DriveCheckDB.put(DriveCheckDB.STORES.fuelFavorites, {
          ...existing,
          label,
          manualPrices: { natural95, diesel },
          lastUpdated: new Date().toISOString(),
        });
        toast("CZ-Favorit aktualisiert");
      } else {
        await DriveCheckDB.put(DriveCheckDB.STORES.fuelFavorites, {
          id: `fav_cz_${Date.now()}`,
          country: "CZ",
          label,
          manualPrices: { natural95, diesel },
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
        });
        toast("CZ-Favorit gespeichert");
      }
    } else {
      await DriveCheckDB.put(DriveCheckDB.STORES.fuelFavorites, {
        id: `fav_cz_${Date.now()}`,
        country: "CZ",
        label,
        manualPrices: { natural95, diesel },
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      });
      toast("CZ-Favorit gespeichert");
    }

    resetCzForm();
    renderFuelView();
    renderDashboard();
  });

  document.getElementById("fuel-cz-cancel")?.addEventListener("click", () => {
    resetCzForm();
    renderFuelView();
  });
}

/* --------------------------------------------------------------------
 * Einstellungen
 * -------------------------------------------------------------------- */
async function renderSettings() {
  const corridor = await DriveCheckDB.getSetting("corridorMeters", 500);
  const apiKey = await DriveCheckDB.getSetting("tankerkoenigApiKey", "");
  const defaultRouteId = await DriveCheckDB.getSetting("defaultRouteId", "");
  const units = await DriveCheckDB.getSetting("units", "km");
  const notifyEnabled = await DriveCheckDB.getSetting("notifyEnabled", false);

  document.getElementById("settings-corridor").value = String(corridor);
  document.getElementById("settings-api-key").value = apiKey || "";
  document.getElementById("settings-units").value = units;
  document.getElementById("settings-notify").checked = !!notifyEnabled;

  const routes = await DriveCheckDB.getAll(DriveCheckDB.STORES.routes);
  const sel = document.getElementById("settings-default-route");
  sel.innerHTML = `<option value="">Erste Strecke (automatisch)</option>` +
    routes.map((r) => `<option value="${esc(r.id)}" ${r.id === defaultRouteId ? "selected" : ""}>${esc(r.name)}</option>`).join("");
}

function initSettingsForm() {
  document.getElementById("settings-corridor")?.addEventListener("change", async (e) => {
    await DriveCheckDB.setSetting("corridorMeters", Number(e.target.value));
    toast("Einstellung gespeichert");
    renderDashboard();
  });

  document.getElementById("settings-api-key")?.addEventListener("change", async (e) => {
    await DriveCheckDB.setSetting("tankerkoenigApiKey", e.target.value.trim());
    toast("API-Key gespeichert");
    renderDashboard();
  });

  document.getElementById("settings-default-route")?.addEventListener("change", async (e) => {
    await DriveCheckDB.setSetting("defaultRouteId", e.target.value || null);
    toast("Standardstrecke gespeichert");
    renderDashboard();
  });

  document.getElementById("settings-units")?.addEventListener("change", async (e) => {
    await DriveCheckDB.setSetting("units", e.target.value);
    toast("Einstellung gespeichert");
  });

  document.getElementById("settings-notify")?.addEventListener("change", async (e) => {
    if (e.target.checked) {
      const perm = await window.DriveCheckNotify.requestPermission();
      if (perm !== "granted") {
        e.target.checked = false;
        toast(perm === "unsupported" ? "Benachrichtigungen werden nicht unterstützt" : "Berechtigung nicht erteilt");
        return;
      }
    }
    await DriveCheckDB.setSetting("notifyEnabled", e.target.checked);
    toast("Einstellung gespeichert");
  });

  document.getElementById("export-data")?.addEventListener("click", async () => {
    const data = await DriveCheckDB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drive-check-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("import-data-input")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await DriveCheckDB.importAll(data);
      toast("Daten importiert");
      await renderDashboard();
      await renderRoutes();
      await renderSettings();
    } catch (err) {
      toast("Import fehlgeschlagen: ungültige Datei");
    }
  });

  document.getElementById("clear-cache")?.addEventListener("click", async () => {
    await DriveCheckDB.clear(DriveCheckDB.STORES.trafficCache);
    toast("Cache geleert");
  });
}

/* --------------------------------------------------------------------
 * Toast
 * -------------------------------------------------------------------- */
let toastTimer = null;
function toast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* --------------------------------------------------------------------
 * Service Worker
 * -------------------------------------------------------------------- */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").then((reg) => {
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) {
            toast("Neue Version verfügbar – bitte App neu laden");
          }
        });
      });
    }).catch(() => {});
  });
}

/* --------------------------------------------------------------------
 * Start
 * -------------------------------------------------------------------- */
async function init() {
  initRouter();
  initConnectionState();
  initRouteForm();
  initGeolocateButton();
  initFuelSearchDE();
  initFuelFormCZ();
  initFuelModeSegments();
  initSettingsForm();
  document.getElementById("btn-settings")?.addEventListener("click", () => showView("settings"));
  registerServiceWorker();
  setInterval(updateCockpitClock, 30000);

  await renderDashboard();
  await renderWarnings();
  await renderRoutes();
  await renderFuelView();
  await renderSettings();
}

document.addEventListener("DOMContentLoaded", init);
