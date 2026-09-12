/**
 * DRIVE CHECK — geo.js
 * Reine Geometrie-/Status-Hilfsfunktionen ohne externe Abhängigkeiten.
 * Wird von den Verkehrs-Providern und dem Dashboard genutzt (Abschnitte 3, 22, 23).
 */

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Haversine-Distanz zwischen zwei Punkten in Metern. */
function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

/**
 * Näherungsweise kürzeste Distanz eines Punktes zu einem Liniensegment,
 * über eine lokale equirectangular-Projektion (ausreichend genau für
 * Korridor-Radien von 250–2000 m, siehe Abschnitt 3).
 */
function pointToSegmentDistanceMeters(p, a, b) {
  const latRef = toRad((a.lat + b.lat) / 2);
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(latRef);

  const ax = a.lon * mPerDegLon, ay = a.lat * mPerDegLat;
  const bx = b.lon * mPerDegLon, by = b.lat * mPerDegLat;
  const px = p.lon * mPerDegLon, py = p.lat * mPerDegLat;

  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Kürzeste Distanz eines Punktes zu einer gesamten Route (Array von {lat,lon}). */
function pointToPolylineDistanceMeters(point, polyline) {
  if (!polyline || polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return haversineDistance(point.lat, point.lon, polyline[0].lat, polyline[0].lon);
  }
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentDistanceMeters(point, polyline[i], polyline[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/** Filtert Ereignisse (mit lat/lon) auf jene innerhalb des Korridors um die Route. */
function filterEventsByCorridor(events, polyline, corridorMeters) {
  return events.filter((ev) => {
    if (typeof ev.latitude !== "number" || typeof ev.longitude !== "number") return false;
    const dist = pointToPolylineDistanceMeters({ lat: ev.latitude, lon: ev.longitude }, polyline);
    return dist <= corridorMeters;
  });
}

/**
 * Gesamtstatus aus einer Liste gefilterter Ereignisse berechnen (Abschnitt 23).
 * severity je Ereignis: "free" | "notice" | "hindered" | "closed"
 * Eine Sperrung direkt auf der Route => Gesamtstatus mindestens ROT.
 */
const SEVERITY_RANK = { free: 0, notice: 1, hindered: 2, closed: 3, unknown: -1 };

function computeOverallStatus(events) {
  if (!events || events.length === 0) return "free";
  let worst = "free";
  for (const ev of events) {
    const sev = ev.severity || "notice";
    if ((SEVERITY_RANK[sev] ?? 1) > (SEVERITY_RANK[worst] ?? 0)) worst = sev;
  }
  return worst;
}

window.DriveCheckGeo = {
  haversineDistance,
  pointToPolylineDistanceMeters,
  filterEventsByCorridor,
  computeOverallStatus,
  SEVERITY_RANK,
};
