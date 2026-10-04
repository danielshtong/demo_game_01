const DB_NAME = 'lumina';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS = {
  id: 'settings',
  screenName: '',
  locationLabel: '',
  latitude: null,
  longitude: null,
  units: 'celsius',
  showTime: true,
  showDate: true,
  showWeather: true,
  hour12: false,
  overlay: 'bottom-left',
  fit: 'contain',
  sound: false,
  transitionMs: 600,
  defaultDuration: 12,
};

const OVERLAYS = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

let dbPromise = null;
let channel = null;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

export function normalizeSettings(input = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...input, id: 'settings' };
  if (!OVERLAYS.has(settings.overlay)) settings.overlay = DEFAULT_SETTINGS.overlay;
  settings.fit = settings.fit === 'cover' ? 'cover' : 'contain';
  settings.units = settings.units === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  settings.showTime = settings.showTime !== false;
  settings.showDate = settings.showDate !== false;
  settings.showWeather = settings.showWeather !== false;
  settings.hour12 = Boolean(settings.hour12);
  settings.sound = Boolean(settings.sound);
  settings.screenName = String(settings.screenName || '').slice(0, 60);
  settings.locationLabel = String(settings.locationLabel || '').slice(0, 120);
  const latitude = input.latitude ?? settings.latitude;
  const longitude = input.longitude ?? settings.longitude;
  settings.latitude = latitude == null || latitude === '' ? null : Number(latitude);
  settings.longitude = longitude == null || longitude === '' ? null : Number(longitude);
  if (!Number.isFinite(settings.latitude)) settings.latitude = null;
  if (!Number.isFinite(settings.longitude)) settings.longitude = null;
  settings.transitionMs = clamp(settings.transitionMs, 0, 1500, DEFAULT_SETTINGS.transitionMs);
  settings.defaultDuration = clamp(settings.defaultDuration, 1, 3600, DEFAULT_SETTINGS.defaultDuration);
  return settings;
}

function waitRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function waitTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function bus() {
  if (channel || !('BroadcastChannel' in globalThis)) return channel;
  channel = new BroadcastChannel('lumina');
  return channel;
}

export function notify(message) {
  bus()?.postMessage(message);
}

export function onRemote(handler) {
  bus()?.addEventListener('message', (event) => handler(event.data));
}

async function putDoc(doc) {
  const db = await openDb();
  const transaction = db.transaction('docs', 'readwrite');
  transaction.objectStore('docs').put(doc);
  await waitTransaction(transaction);
}

async function getDoc(id) {
  const db = await openDb();
  const transaction = db.transaction('docs', 'readonly');
  return waitRequest(transaction.objectStore('docs').get(id));
}

export async function getAllMedia() {
  const db = await openDb();
  const transaction = db.transaction('media', 'readonly');
  return waitRequest(transaction.objectStore('media').getAll());
}

export async function getMedia(id) {
  const db = await openDb();
  const transaction = db.transaction('media', 'readonly');
  return waitRequest(transaction.objectStore('media').get(id));
}

export async function putMedia(record, { silent = false } = {}) {
  const db = await openDb();
  const transaction = db.transaction('media', 'readwrite');
  transaction.objectStore('media').put(record);
  await waitTransaction(transaction);
  if (!silent) notify({ type: 'media' });
}

export async function deleteMedia(id, { silent = false } = {}) {
  const db = await openDb();
  const transaction = db.transaction('media', 'readwrite');
  transaction.objectStore('media').delete(id);
  await waitTransaction(transaction);
  if (!silent) notify({ type: 'media' });
}

export async function getSettings() {
  const doc = await getDoc('settings');
  return normalizeSettings(doc || {});
}

export async function saveSettings(input) {
  const settings = normalizeSettings(input);
  await putDoc(settings);
  notify({ type: 'settings' });
  return settings;
}

export async function getPlaylist() {
  const doc = await getDoc('playlist');
  if (!doc || !Array.isArray(doc.items)) return [];
  return doc.items.filter((item) => item && item.id && item.mediaId);
}

export async function savePlaylist(items) {
  await putDoc({ id: 'playlist', items });
  notify({ type: 'playlist' });
}

export async function clearLibrary() {
  const db = await openDb();
  const transaction = db.transaction(['media', 'docs'], 'readwrite');
  transaction.objectStore('media').clear();
  transaction.objectStore('docs').delete('playlist');
  await waitTransaction(transaction);
  notify({ type: 'playlist' });
}
