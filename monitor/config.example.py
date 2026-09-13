# Drive Check – Monitor-Konfiguration (Vorlage)
# Kopieren nach:  cp config.example.py config.py
# Du musst NTFY_TOPIC und ROADS ausfüllen. Ein guter Topic ist ein zufälliger
# Name (er ist dein Passwort, siehe https://ntfy.sh/docs/publish/#pick-a-topic):

# Öffentlicher ntfy-Server (oder deine eigene Instanz).
NTFY_SERVER = "https://ntfy.sh"

# Dein geheimer Topic – die ntfy-App abonniert genau diesen Namen.
NTFY_TOPIC = "drivecheck-ersatzein-geheimestopic-u7k2"

# Autobahnen, die überwacht werden: {"A9": "Zuhause → Nürnberg", ...}
# Nur Autobahnen (A..) werden von der API geliefert.
ROADS = {
    "A9": "Zuhause → Nürnberg",
}

# Kleinster Status, der gepusht wird:
#   "notice"  → auch Baustellen/Hinweise (laut, aber vollständig)
#   "hindered"→ nur Stau/stockend und Sperrungen
#   "closed"  → nur Sperrungen
MIN_SEVERITY = "notice"

# Entwarnung pushen, sobald eine Meldung verschwindet?
NOTIFY_CLEAR = True

# Wo der Zustand (bereits gemeldete IDs) gespeichert wird.
STATE_FILE = "/data/data/com.termux/files/home/.cache/drivecheck-alert/notified.json"

# Wie oft Meldungen bei jedem Durchlauf erneut als „weiterhin aktiv" gepusht
# werden sollen (in Minuten; 0 = nach Ersterstellung nie wieder).
REPEAT_ACTIVE_MINUTES = 180