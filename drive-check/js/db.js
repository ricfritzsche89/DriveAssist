/**
 * DRIVE CHECK — db.js
 * Kapselt sämtlichen IndexedDB-Zugriff. Kein Server, keine Cloud.
 * Stores: routes, waypoints, fuelStations, fuelFavorites, trafficCache, settings
 */
const DB_NAME = "drive-check-db";
const DB_VERSION = 1;

const STORES = {
  routes: "routes",
  waypoints: "waypoints",
  fuelStations: "fuelStations",
  fuelFavorites: "fuelFavorites",
  trafficCache: "trafficCache",
  settings: "settings",
};

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.routes)) {
        const s = db.createObjectStore(STORES.routes, { keyPath: "id" });
        s.createIndex("createdAt", "createdAt");
      }
      if (!db.objectStoreNames.contains(STORES.waypoints)) {
        const s = db.createObjectStore(STORES.waypoints, { keyPath: "id" });
        s.createIndex("routeId", "routeId");
      }
      if (!db.objectStoreNames.contains(STORES.fuelStations)) {
        db.createObjectStore(STORES.fuelStations, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORES.fuelFavorites)) {
        const s = db.createObjectStore(STORES.fuelFavorites, { keyPath: "id" });
        s.createIndex("country", "country");
      }
      if (!db.objectStoreNames.contains(STORES.trafficCache)) {
        const s = db.createObjectStore(STORES.trafficCache, { keyPath: "id" });
        s.createIndex("country", "country");
        s.createIndex("lastUpdated", "lastUpdated");
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(storeName, mode = "readonly") {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const DriveCheckDB = {
  STORES,

  async put(storeName, value) {
    const store = await tx(storeName, "readwrite");
    return wrap(store.put(value));
  },

  async get(storeName, key) {
    const store = await tx(storeName, "readonly");
    return wrap(store.get(key));
  },

  async getAll(storeName) {
    const store = await tx(storeName, "readonly");
    return wrap(store.getAll());
  },

  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, "readonly");
    return wrap(store.index(indexName).getAll(value));
  },

  async delete(storeName, key) {
    const store = await tx(storeName, "readwrite");
    return wrap(store.delete(key));
  },

  async clear(storeName) {
    const store = await tx(storeName, "readwrite");
    return wrap(store.clear());
  },

  // Einstellungen als einfache Key/Value-Helfer
  async getSetting(key, fallback = null) {
    const row = await this.get(STORES.settings, key);
    return row ? row.value : fallback;
  },
  async setSetting(key, value) {
    return this.put(STORES.settings, { key, value });
  },

  // Export/Import (Phase 10 nutzt dies vollständig; Grundfunktion schon jetzt verfügbar)
  async exportAll() {
    const data = {};
    for (const name of Object.values(STORES)) {
      data[name] = await this.getAll(name);
    }
    data._meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
    return data;
  },

  async importAll(data) {
    // Echter Restore: vorhandene Daten der betroffenen Stores erst leeren,
    // damit ein Backup nicht still mit Altbeständen vermischt wird.
    for (const name of Object.values(STORES)) {
      if (!Array.isArray(data[name])) continue;
      await this.clear(name);
    }
    for (const name of Object.values(STORES)) {
      if (!Array.isArray(data[name])) continue;
      for (const item of data[name]) {
        await this.put(name, item);
      }
    }
  },
};

window.DriveCheckDB = DriveCheckDB;
