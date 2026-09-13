#!/data/data/com.termux/files/usr/bin/bash
# Drive Check – Strecken-Monitor (ntfy-Push)
# Läuft aus cron alle 5 Minuten und nutzt dieselbe öffentliche Autobahn-API
# wie die App (https://verkehr.autobahn.de/o/autobahn/).
#
# Einrichtung:
#   pkg install python cronie
#   cp config.example.py config.py   # ROADS + NTFY_TOPIC ausfüllen
#   ntfy-Android-App installieren und dem Topic folgen
#   ./monitor.sh   # einmal testen
#   crontab:  */5 * * * * /data/data/com.termux/files/home/DriveAssist/monitor/monitor.sh
#   crond starten/für Autostart: pkg install termux-services && sv-enable crond
set -e
cd "$(dirname "$0")"
exec python3 ntfy-monitor.py