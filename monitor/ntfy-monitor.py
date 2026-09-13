#!/usr/bin/env python3
"""Drive Check – Strecken-Monitor (ntfy-Push).

Nutzt dieselbe öffentliche Autobahn-API wie die App:
  https://verkehr.autobahn.de/o/autobahn/{road}/services/{warning|roadworks|closure}

Bei neuen Behinderungen auf den konfigurierten Autobahnen wird per ntfy
eine Push-Nachricht an die Android-App geschickt. Nur Python-Standardbibliothek.

Konfiguration: config.py (siehe config.example.py).
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

try:
    import config
except ImportError:
    print("FEHLER: config.py fehlt – bitte 'cp config.example.py config.py' ausführen.", file=sys.stderr)
    sys.exit(2)

API_BASE = "https://verkehr.autobahn.de/o/autobahn"
SEVERITY_RANK = {"notice": 1, "hindered": 2, "closed": 3}
PRIORITY_BY_SEVERITY = {"notice": 3, "hindered": 4, "closed": 5}
TAG_BY_SEVERITY = {"notice": "triangle_", "hindered": "orange", "closed": "rot"}


def map_severity(service_type, item):
    """Spiegelt die Heuristik aus js/providers/traffic-de.js."""
    if service_type == "closure":
        return "closed"
    if service_type == "roadworks":
        return "notice"
    text = f"{item.get('title', '')} {item.get('subtitle', '')}".lower()
    if "vollsperrung" in text or "gesperrt" in text:
        return "closed"
    if "stau" in text or "stockend" in text:
        return "hindered"
    return "notice"


def fetch_services(road):
    out = {}
    for service_type in ("roadworks", "warning", "closure"):
        url = f"{API_BASE}/{urllib.parse.quote(road)}/services/{service_type}"
        try:
            with urllib.request.urlopen(url, timeout=25) as r:
                data = json.loads(r.read().decode("utf-8"))
            out[service_type] = data.get(service_type) or []
        except Exception as exc:  # noqa: BLE001 – API-Ausfall darf den Monitor nicht töten
            print(f"WARNUNG: {road}/{service_type} nicht abrufbar: {exc}")
            out[service_type] = []
    return out


def normalize(service_type, item, road):
    try:
        lat = float(item.get("coordinate", {}).get("lat"))
    except (TypeError, ValueError):
        lat = None
    try:
        lon = float(item.get("coordinate", {}).get("long"))
    except (TypeError, ValueError):
        lon = None
    return {
        "id": item.get("identifier") or f"{road}-{service_type}-{item.get('title')}",
        "type": service_type,
        "severity": map_severity(service_type, item),
        "title": item.get("title") or road,
        "subtitle": item.get("subtitle") or "",
        "lat": lat,
        "lon": lon,
    }


def load_state(path):
    if path.exists():
        try:
            return json.loads(path.read_text("utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), "utf-8")
    tmp.replace(path)


def send_ntfy(title, tags, priority, body, click=None):
    topic = urllib.parse.quote(config.NTFY_TOPIC, safe="")
    url = f"{config.NTFY_SERVER.rstrip('/')}/{topic}"
    headers = {
        "Title": title,
        "Tags": tags,
        "Priority": str(priority),
        "Content-Type": "text/plain; charset=utf-8",
    }
    if click:
        headers["Click"] = click
    req = urllib.request.Request(url, data=body.encode("utf-8"), method="POST", headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        r.read()
    print(f"PUSH: {title}")


def map_link(lat, lon):
    if lat is None or lon is None:
        return None
    q = urllib.parse.urlencode({"q": f"{lat:.5f},{lon:.5f}"})
    return f"https://maps.google.com/?{q}"


def format_event(road, label, ev):
    lines = [
        f"{ev['title']}",
    ]
    if ev["subtitle"]:
        lines.append(f"  {ev['subtitle']}")
    click = map_link(ev["lat"], ev["lon"])
    if click:
        lines.append(f"  Karte: {click}")
    return f"📍 {label} ({road})\n" + "\n".join(lines)


def main():
    now_ts = time.time()
    state = load_state(Path(config.STATE_FILE).expanduser())
    min_rank = SEVERITY_RANK.get(getattr(config, "MIN_SEVERITY", "notice"), 1)

    for road, label in config.ROADS.items():
        services = fetch_services(road)
        events = [normalize(t, item, road) for t, items in services.items() for item in items]
        active_ids = {ev["id"] for ev in events}

        prior = state.get(road, {}).get("ids", [])
        prior_by_id = {p["id"]: p for p in prior}

        for ev in events:
            severity_ok = SEVERITY_RANK.get(ev["severity"], 1) >= min_rank
            key = ev["id"]
            in_state = key in prior_by_id
            repeat_min = getattr(config, "REPEAT_ACTIVE_MINUTES", 0) or 0

            if not severity_ok:
                continue
            last_at = prior_by_id.get(key, {}).get("at", 0)
            repeat_due = repeat_min and (now_ts - last_at) >= repeat_min * 60
            if not in_state:
                send_ntfy(
                    "Drive Check – Behinderung",
                    TAG_BY_SEVERITY[ev["severity"]],
                    PRIORITY_BY_SEVERITY[ev["severity"]],
                    format_event(road, label, ev),
                    click=map_link(ev["lat"], ev["lon"]),
                )
            elif repeat_due:
                send_ntfy(
                    "Drive Check – weiterhin aktiv",
                    TAG_BY_SEVERITY[ev["severity"]],
                    PRIORITY_BY_SEVERITY[ev["severity"]],
                    format_event(road, label, ev),
                    click=map_link(ev["lat"], ev["lon"]),
                )

        # Zustand aktualisieren: gemeldete IDs behalten oder entfernen.
        keep = []
        notify_clear = getattr(config, "NOTIFY_CLEAR", True)
        for p in prior:
            if p["id"] in active_ids:
                keep.append(p)
            elif notify_clear:
                send_ntfy(
                    "Drive Check – Entwarnung",
                    "white_check_mark",
                    3,
                    f"✅ {label} ({road}):\n{p['title']} ist wieder frei.",
                )
        # Neu gemeldete Events eintragen.
        for ev in events:
            if ev["id"] not in {p["id"] for p in keep} and SEVERITY_RANK.get(ev["severity"], 1) >= min_rank:
                keep.append({"id": ev["id"], "title": ev["title"], "at": now_ts})
        state[road] = {"ids": keep}

    save_state(Path(config.STATE_FILE).expanduser(), state)
    print(f"Fertig: {len(config.ROADS)} Strecke(n) geprüft, {len(state)} Zustand(e) gespeichert.")


if __name__ == "__main__":
    main()