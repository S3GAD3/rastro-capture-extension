// src/lib/store.js · almacenamiento local (IndexedDB) del expediente
// Esquema v3: `evidence` (metadatos ligeros) · `blobs` (contenido) · `log` (registro de actividad) · `kv`.
// Separar los blobs evita cargar cientos de MB en memoria cada vez que se pinta la lista.
import { KIND_LABELS, codeOf, evidenceFilename, folderFor } from "./paths.js";

const DB_NAME = "rastro-capture";
const DB_VERSION = 3;

function promisify(request) {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error("Transacción cancelada.")); });

let dbPromise = null;
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains("evidence")) db.createObjectStore("evidence", { keyPath: "id" });
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs", { keyPath: "id" });
      if (!db.objectStoreNames.contains("log")) db.createObjectStore("log", { autoIncrement: true });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv", { keyPath: "key" });
      if (event.oldVersion === 2) migrateV2(tx);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); dbPromise = null; };
      resolve(request.result);
    };
    request.onerror = () => { dbPromise = null; reject(request.error); };
  });
  return dbPromise;
}

// v2 guardaba el blob dentro del registro; se mueve a su almacén y se asigna un correlativo.
function migrateV2(tx) {
  const evidence = tx.objectStore("evidence");
  const blobs = tx.objectStore("blobs");
  const kv = tx.objectStore("kv");
  const all = evidence.getAll();
  all.onsuccess = () => {
    const items = all.result.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    items.forEach((item, i) => {
      const seq = i + 1;
      if (item.blob) blobs.put({ id: item.id, blob: item.blob });
      const { blob, ...rest } = item;
      const code = codeOf(seq);
      const ext = (item.filename || "").match(/\.[a-z0-9]+$/i)?.[0] || ".bin";
      evidence.put({ ...rest, seq, code, kind: rest.kind || legacyKind(item), hasBlob: Boolean(blob), zipPath: `${folderFor(legacyKind(item))}/${evidenceFilename(code, String(item.filename || "").replace(/\.[a-z0-9]+$/i, ""), ext)}` });
    });
    kv.put({ key: "seq", value: items.length });
  };
}
function legacyKind(item) {
  const t = String(item.type || "");
  if (/visible/i.test(t)) return "screenshot-visible";
  if (/completa/i.test(t)) return /p[áa]gina/i.test(t) ? "screenshot-page" : "screenshot-post";
  if (/v[ií]deo descargado/i.test(t)) return "media-video";
  if (/imagen/i.test(t)) return "media-image";
  if (/grabaci/i.test(t)) return "recording";
  return "source-data";
}

/**
 * Añade una evidencia. Asigna código correlativo (EV-0001…), nombre de archivo único y ruta en el paquete
 * dentro de una única transacción, de modo que dos guardados simultáneos nunca comparten número.
 */
export async function addEvidence(meta, blob = null) {
  const db = await openDb();
  const tx = db.transaction(["evidence", "blobs", "kv"], "readwrite");
  const kv = tx.objectStore("kv");
  const current = (await promisify(kv.get("seq")))?.value || 0;
  const seq = current + 1;
  const code = codeOf(seq);
  const ext = meta.extension || ".bin";
  const filename = evidenceFilename(code, meta.slug || meta.kind, ext);
  const folder = folderFor(meta.kind, { platform: meta.source?.platform || "", username: meta.source?.username || "", postId: meta.details?.postId || "" });
  const record = {
    id: crypto.randomUUID(), seq, code, createdAt: new Date().toISOString(), external: false, type: KIND_LABELS[meta.kind] || meta.kind,
    ...meta, filename, zipPath: `${folder}/${filename}`, hasBlob: Boolean(blob), size: blob?.size ?? meta.size ?? 0, mime: blob?.type || meta.mime || ""
  };
  delete record.slug; delete record.extension;
  tx.objectStore("evidence").put(record);
  if (blob) tx.objectStore("blobs").put({ id: record.id, blob });
  kv.put({ key: "seq", value: seq });
  await done(tx);
  return record;
}

export async function listEvidence() {
  const db = await openDb();
  const all = await promisify(db.transaction("evidence").objectStore("evidence").getAll());
  return all.sort((a, b) => (a.seq || 0) - (b.seq || 0));
}
export async function getEvidence(id) {
  const db = await openDb();
  return promisify(db.transaction("evidence").objectStore("evidence").get(id));
}
export async function getBlob(id) {
  const db = await openDb();
  return (await promisify(db.transaction("blobs").objectStore("blobs").get(id)))?.blob || null;
}
export async function updateEvidence(id, patch) {
  const db = await openDb();
  const tx = db.transaction("evidence", "readwrite");
  const store = tx.objectStore("evidence");
  const current = await promisify(store.get(id));
  if (!current) throw new Error("La evidencia ya no existe.");
  const next = { ...current, ...patch, details: { ...(current.details || {}), ...(patch.details || {}) } };
  store.put(next);
  await done(tx);
  return next;
}
export async function deleteEvidence(id) {
  const db = await openDb();
  const tx = db.transaction(["evidence", "blobs"], "readwrite");
  tx.objectStore("evidence").delete(id);
  tx.objectStore("blobs").delete(id);
  await done(tx);
}
export async function clearAll() {
  const db = await openDb();
  const tx = db.transaction(["evidence", "blobs", "log", "kv"], "readwrite");
  for (const name of ["evidence", "blobs", "log", "kv"]) tx.objectStore(name).clear();
  await done(tx);
}

export async function addLog(action, detail = {}) {
  const db = await openDb();
  const tx = db.transaction("log", "readwrite");
  tx.objectStore("log").add({ at: new Date().toISOString(), action, ...detail });
  await done(tx);
}
export async function listLog() {
  const db = await openDb();
  return promisify(db.transaction("log").objectStore("log").getAll());
}

export async function kvGet(key) {
  const db = await openDb();
  return (await promisify(db.transaction("kv").objectStore("kv").get(key)))?.value;
}
export async function kvSet(key, value) {
  const db = await openDb();
  const tx = db.transaction("kv", "readwrite");
  tx.objectStore("kv").put({ key, value });
  await done(tx);
}
