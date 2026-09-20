// src/lib/zipWriter.js
// Escritor ZIP mínimo, propio y sin dependencias. Método STORE (sin compresión): auditable y
// determinista; el énfasis es la integridad verificable, no el tamaño.
// - createZip(entries)      -> Uint8Array   (entradas en memoria; usado por tests y paquetes pequeños)
// - createZipBlob(entries)  -> Promise<Blob> (entradas Blob o bytes; NO duplica en memoria los ficheros grandes)
// Fechas fijadas a 1980-01-01 para que el ZIP sea reproducible byte a byte. Las fechas reales de captura
// figuran en MANIFEST.json e INFORME.html.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32Update(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}
export function crc32(bytes) {
  return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}
export async function crc32Blob(blob) {
  let crc = 0xffffffff;
  const slice = 4 * 1024 * 1024;
  for (let offset = 0; offset < blob.size; offset += slice) {
    crc = crc32Update(crc, new Uint8Array(await blob.slice(offset, offset + slice).arrayBuffer()));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const encoder = new TextEncoder();

function headers(path, crc, size, offset) {
  const nameBytes = encoder.encode(path);
  const local = new Uint8Array([
    0x50, 0x4b, 0x03, 0x04, 20, 0, 0x00, 0x08, 0, 0,
    ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length), ...u16(0)
  ]);
  const central = new Uint8Array([
    0x50, 0x4b, 0x01, 0x02, 20, 0, 20, 0, 0x00, 0x08, 0, 0,
    ...u16(DOS_TIME), ...u16(DOS_DATE), ...u32(crc), ...u32(size), ...u32(size), ...u16(nameBytes.length),
    ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)
  ]);
  return { nameBytes, local, central };
}

function eocd(count, centralSize, centralStart) {
  return new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(centralSize), ...u32(centralStart), ...u16(0)]);
}

function assertLimits(count, total) {
  if (count > 65000) throw new Error("El paquete supera el número de entradas admitido por ZIP clásico. Exporta en varios lotes.");
  if (total > 0xf0000000) throw new Error("El paquete supera 3,75 GB (límite de ZIP clásico). Exporta en varios lotes.");
}

export function createZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { path, bytes } of entries) {
    const crc = crc32(bytes);
    const h = headers(path, crc, bytes.length, offset);
    parts.push(h.local, h.nameBytes, bytes);
    central.push(h.central, h.nameBytes);
    offset += h.local.length + h.nameBytes.length + bytes.length;
  }
  assertLimits(entries.length, offset);
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = eocd(entries.length, centralSize, offset);
  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...parts, ...central, end]) { out.set(part, cursor); cursor += part.length; }
  return out;
}

/**
 * @param {Array<{path:string, bytes?:Uint8Array, blob?:Blob}>} entries
 * @returns {Promise<{blob:Blob, files:Array<{path:string,size:number,crc32:number}>}>}
 */
export async function createZipBlob(entries, onProgress) {
  const parts = [];
  const central = [];
  const files = [];
  let offset = 0;
  let index = 0;
  for (const entry of entries) {
    const data = entry.blob || entry.bytes;
    const size = entry.blob ? entry.blob.size : entry.bytes.length;
    const crc = entry.blob ? await crc32Blob(entry.blob) : crc32(entry.bytes);
    const h = headers(entry.path, crc, size, offset);
    parts.push(h.local, h.nameBytes, data);
    central.push(h.central, h.nameBytes);
    files.push({ path: entry.path, size, crc32: crc });
    offset += h.local.length + h.nameBytes.length + size;
    onProgress?.(++index, entries.length);
  }
  assertLimits(entries.length, offset);
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  parts.push(...central, eocd(entries.length, centralSize, offset));
  return { blob: new Blob(parts, { type: "application/zip" }), files };
}

/** Lector de ZIP STORE producidos por este módulo (verificación en tests y comprobaciones locales). */
export function readZipEntries(zipBytes) {
  if (!(zipBytes instanceof Uint8Array)) throw new TypeError("El ZIP debe proporcionarse como Uint8Array.");
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const entries = [];
  let offset = 0;
  while (offset + 4 <= zipBytes.length) {
    if (entries.length >= 70000) throw new Error("El ZIP contiene demasiadas entradas.");
    if (dv.getUint32(offset, true) !== 0x04034b50) break;
    if (offset + 30 > zipBytes.length) throw new Error("Cabecera ZIP truncada.");
    const method = dv.getUint16(offset + 8, true);
    if (method !== 0) throw new Error("readZipEntries solo admite el método STORE (sin compresión).");
    const compSize = dv.getUint32(offset + 18, true);
    const nameLen = dv.getUint16(offset + 26, true);
    const extraLen = dv.getUint16(offset + 28, true);
    const crcHeader = dv.getUint32(offset + 14, true);
    const nameStart = offset + 30;
    if (nameStart + nameLen + extraLen > zipBytes.length) throw new Error("Nombre o campo extra ZIP truncado.");
    const path = new TextDecoder().decode(zipBytes.slice(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    if (dataStart + compSize > zipBytes.length) throw new Error("Entrada ZIP truncada.");
    if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..")) throw new Error("El ZIP contiene una ruta no segura.");
    if (entries.some((e) => e.path === path)) throw new Error("El ZIP contiene rutas duplicadas.");
    const bytes = zipBytes.slice(dataStart, dataStart + compSize);
    if (crc32(bytes) !== (crcHeader >>> 0)) throw new Error(`CRC-32 incorrecto en ${path}.`);
    entries.push({ path, bytes, crc32Header: crcHeader >>> 0 });
    offset = dataStart + compSize;
  }
  return entries;
}
