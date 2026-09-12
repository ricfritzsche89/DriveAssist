/**
 * DRIVE CHECK — notify.js
 * Optionale PWA-Benachrichtigungen (Abschnitt 25). Wird nur aktiv, wenn der Nutzer
 * es in den Einstellungen ausdrücklich aktiviert UND der Browser Notifications
 * unterstützt. Die App funktioniert vollständig ohne diese Funktion.
 */

function isSupported() {
  return "Notification" in window;
}

async function requestPermission() {
  if (!isSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

function notify(title, body) {
  if (!isSupported() || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, icon: "./icons/icon-192.png" });
  } catch {
    // still — Benachrichtigungen sind ein Zusatz, kein Kernfeature
  }
}

/** Vergleicht zwei Statuswerte und benachrichtigt nur bei Verschlechterung. */
function notifyOnDegradation(routeName, previousStatus, currentStatus) {
  const rank = { free: 0, notice: 1, hindered: 2, closed: 3, unknown: -1 };
  if ((rank[currentStatus] ?? -1) > (rank[previousStatus] ?? -1) && rank[currentStatus] >= 2) {
    notify("Drive Check", `Auf „${routeName}“ wurde eine Verkehrsbehinderung erkannt.`);
  }
}

window.DriveCheckNotify = { isSupported, requestPermission, notify, notifyOnDegradation };
