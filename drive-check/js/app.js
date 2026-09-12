/**
 * DRIVE CHECK — app.js
 * Orchestriert Router, Views und alle Provider (Phase 2–12 zusammengeführt).
 */

const VIEWS = ["dashboard", "routes", "map", "fuel", "settings"];

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
    el.textContent = navigator.onLine ? "online" : "offline";
    el.classList.toggle("offline", !navigator.onLine);
  }
  window.addEventListener("online", () => { update(); renderDashboard(); });
  window.addEventListener("offline", () => { update(); renderDashboard(); });
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

  const deRoads = (route.roadNames || []).filter((r) => /^A\d+/i.test(r));
  if (deRoads.length > 0) {
    const { events, errors } = await window.TrafficProviderDE.getEventsForRoads(deRoads);
    allEvents.push(...events);
    errors.forEach((e) => notes.push(`DE (${e.roadId}): ${e.message}`));
  }

  const czResult = await window.TrafficProviderCZ.getEventsForRoute(route);
  if (!czResult.available && route.crossesCZ) {
    notes.push(czResult.reason);
  }

  const filtered = window.DriveCheckGeo.filterEventsByCorridor(allEvents, route.polyline, corridor);
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
 * Dashboard
 * -------------------------------------------------------------------- */
function statusPillHtml(status, label) {
  return `<span class="status-pill"><span class="dot ${status}"></span>${label}</span>`;
}

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

async function renderDashboard() {
  const routes = await DriveCheckDB.getAll(DriveCheckDB.STORES.routes);
  const heroEl = document.getElementById("dashboard-hero");
  const favEl = document.getElementById("dashboard-fuel-favs");
  const defaultRouteId = await DriveCheckDB.getSetting("defaultRouteId", null);

  if (!routes.length) {
    heroEl.innerHTML = `
      <div class="empty-state">
        <p>Noch keine Strecke angelegt.<br>Lege deine erste Strecke an, um sofort ihren Verkehrsstatus zu sehen.</p>
        <button class="btn primary" id="dash-add-route">+ Strecke anlegen</button>
      </div>`;
    document.getElementById("dash-add-route")?.addEventListener("click", () => showView("routes"));
  } else {
    const route = routes.find((r) => r.id === defaultRouteId) || routes[0];
    heroEl.innerHTML = `<div class="hero"><div class="detail">Prüfe Verkehrslage …</div></div>`;
    const result = await computeRouteStatus(route);
    const now = new Date();
    const timeStr = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

    // Benachrichtigung nur bei Verschlechterung und nur, wenn der Nutzer sie
    // in den Einstellungen aktiviert hat (siehe notify.js).
    const notifyEnabled = await DriveCheckDB.getSetting("notifyEnabled", false);
    if (notifyEnabled) {
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

    heroEl.innerHTML = `
      <div class="hero">
        <div class="route-line">🏠 ${esc(route.startLabel) || "Start"} <span class="sep">→</span> 🏁 ${esc(route.endLabel) || "Ziel"}</div>
        ${statusPillHtml(result.status, STATUS_LABEL[result.status])}
        <div class="detail">${esc(result.reason)}</div>
        ${result.notes?.length ? `<div class="detail" style="color:var(--status-hindered)">${esc(result.notes.join(" · "))}</div>` : ""}
        <div class="meta-row">
          <div><span class="num">${route.durationSeconds ? fmtDuration(route.durationSeconds) : "—"}</span>Fahrzeit</div>
          <div><span class="num">${route.distanceMeters ? Math.round(route.distanceMeters / 1000) + " km" : "—"}</span>Distanz</div>
          <div><span class="num">${timeStr}</span>Letzte Prüfung</div>
        </div>
      </div>`;
  }

  const favs = await DriveCheckDB.getAll(DriveCheckDB.STORES.fuelFavorites);
  if (!favs.length) {
    favEl.innerHTML = `<div class="empty-state"><p>Noch keine Tankstellen-Favoriten gespeichert.</p></div>`;
  } else {
    const rows = await Promise.all(favs.map(async (f) => {
      let priceText = "Preise werden geladen …";
      if (f.country === "DE") {
        const r = await window.FuelProviderDE.getPrices([f.stationId]);
        const p = r.prices?.[f.stationId];
        priceText = p ? `E10 ${fmtPriceEUR(p.e10)} · E5 ${fmtPriceEUR(p.e5)} · Diesel ${fmtPriceEUR(p.diesel)}` : (r.reason || "Preise nicht verfügbar");
      } else {
        const r = await window.FuelProviderCZ.getPrices(f.id);
        priceText = r.available ? formatCzPrices(r.prices) : (r.reason || "Preise nicht verfügbar");
      }
      return `<div class="row-card">
        <span class="dot ${f.country === 'DE' ? 'free' : 'unknown'}"></span>
        <div>
          <div class="rc-title">${f.country === "CZ" ? "🇨🇿" : "🇩🇪"} ${esc(f.label)}</div>
          <div class="rc-sub">${esc(priceText)}</div>
        </div>
      </div>`;
    }));
    favEl.innerHTML = `<div class="card-list">${rows.join("")}</div>`;
  }
}

function formatCzPrices(prices) {
  if (!prices) return "keine Preise hinterlegt";
  const parts = [];
  if (prices.natural95) parts.push(`Natural 95 ${prices.natural95} Kč`);
  if (prices.diesel) parts.push(`Diesel ${prices.diesel} Kč`);
  return parts.join(" · ") || "keine Preise hinterlegt";
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
  if (!favs.length) {
    listEl.innerHTML = `<div class="empty-state"><p>Noch keine Favoriten. Suche unten eine Tankstelle oder lege einen CZ-Favoriten manuell an.</p></div>`;
  } else {
    listEl.innerHTML = `<div class="card-list">${favs.map((f) => {
      const editBtn = f.country === "CZ"
        ? `<button class="btn ghost" data-czedit="${esc(f.id)}" style="padding:6px 10px;width:auto;font-size:0.72rem;">Preise</button>`
        : "";
      return `
      <div class="row-card">
        <span class="dot ${f.country === 'DE' ? 'free' : 'unknown'}"></span>
        <div><div class="rc-title">${f.country === "CZ" ? "🇨🇿" : "🇩🇪"} ${esc(f.label)}</div></div>
        <div class="rc-value" style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
          ${editBtn}
          <button class="btn danger" data-favdel="${esc(f.id)}" style="padding:6px 10px;width:auto;font-size:0.72rem;">Entfernen</button>
        </div>
      </div>`;
    }).join("")}</div>`;
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
        });
        toast("CZ-Favorit aktualisiert");
      } else {
        await DriveCheckDB.put(DriveCheckDB.STORES.fuelFavorites, {
          id: `fav_cz_${Date.now()}`,
          country: "CZ",
          label,
          manualPrices: { natural95, diesel },
          createdAt: new Date().toISOString(),
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
  initSettingsForm();
  registerServiceWorker();

  await renderDashboard();
  await renderRoutes();
  await renderFuelView();
  await renderSettings();
}

document.addEventListener("DOMContentLoaded", init);
