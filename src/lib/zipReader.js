// src/lib/zipReader.js · lector ZIP sobre Blob, sin dependencias y sin cargar el paquete entero en memoria.
// Lee el directorio central y entrega cada entrada bajo demanda. Admite STORE (método 0, el que produce
// RASTRO CAPTURE) y DEFLATE (método 8, por si el paquete se ha vuelto a comprimir con otra herramienta).
// No admite ZIP64, cifrado ni archivos multivolumen: en esos casos lanza un error explicativo.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX_ENTRIES = 70000;

async function bytesOf(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

export function isSafeZipPath(path) {
  return Boolean(path) && !path.startsWith("/") && !path.includes("\\") && !/^[a-zA-Z]:/.test(path) && !path.split("/").includes("..");
}

async function inflateRaw(blob) {
  if (typeof DecompressionStream !== "function") throw new Error("Este entorno no puede descomprimir entradas DEFLATE.");
  return new Response(blob.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

/**
 * @param {Blob} blob  Archivo ZIP.
 * @returns {Promise<Array<{path:string,size:number,compressedSize:number,method:number,crc32:number,read:()=>Promise<Blob>}>>}
 */
export async function openZip(blob) {
  if (!blob || typeof blob.slice !== "function") throw new TypeError("El ZIP debe proporcionarse como Blob o File.");
  if (blob.size < 22) throw new Error("El archivo es demasiado pequeño para ser un ZIP.");
  const tailStart = Math.max(0, blob.size - 65557);
  const tail = await bytesOf(blob, tailStart, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Error("No se ha encontrado el directorio central: el archivo no es un ZIP válido o está truncado.");
  const count = tv.getUint16(eocd + 10, true);
  const centralSize = tv.getUint32(eocd + 12, true);
  const centralStart = tv.getUint32(eocd + 16, true);
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new Error("ZIP64 no admitido por el verificador: extrae el paquete y verifica la carpeta.");
  if (count > MAX_ENTRIES) throw new Error("El ZIP contiene demasiadas entradas.");
  if (centralStart + centralSize > blob.size) throw new Error("Directorio central fuera del archivo: ZIP truncado o corrupto.");
  const central = await bytesOf(blob, centralStart, centralStart + centralSize);
  const cv = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const decoder = new TextDecoder("utf-8");
  const entries = [];
  const seen = new Set();
  let offset = 0;
  for (let n = 0; n < count; n++) {
    if (offset + 46 > central.length || cv.getUint32(offset, true) !== SIG_CENTRAL) throw new Error("Directorio central corrupto.");
    const flags = cv.getUint16(offset + 8, true);
    const method = cv.getUint16(offset + 10, true);
    const crc = cv.getUint32(offset + 16, true);
    const compressedSize = cv.getUint32(offset + 20, true);
    const size = cv.getUint32(offset + 24, true);
    const nameLen = cv.getUint16(offset + 28, true);
    const extraLen = cv.getUint16(offset + 30, true);
    const commentLen = cv.getUint16(offset + 32, true);
    const localOffset = cv.getUint32(offset + 42, true);
    const path = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLen));
    offset += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue; // directorio
    if (!isSafeZipPath(path)) throw new Error(`El ZIP contiene una ruta no segura: ${path.slice(0, 120)}`);
    if (seen.has(path)) throw new Error(`El ZIP contiene rutas duplicadas: ${path.slice(0, 120)}`);
    seen.add(path);
    if (flags & 1) throw new Error("El ZIP está cifrado; el verificador no admite paquetes cifrados.");
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error("ZIP64 no admitido por el verificador: extrae el paquete y verifica la carpeta.");
    entries.push({
      path, size, compressedSize, method, crc32: crc >>> 0,
      async read() {
        if (method !== 0 && method !== 8) throw new Error(`Método de compresión ${method} no admitido.`);
        const head = await bytesOf(blob, localOffset, localOffset + 30);
        if (head.length < 30 || new DataView(head.buffer).getUint32(0, true) !== SIG_LOCAL) throw new Error("Cabecera local corrupta.");
        const hv = new DataView(head.buffer);
        const dataStart = localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
        if (dataStart + compressedSize > blob.size) throw new Error("Entrada truncada.");
        const raw = blob.slice(dataStart, dataStart + compressedSize);
        if (method === 0) return raw;
        const out = await inflateRaw(raw);
        if (out.size !== size) throw new Error("El tamaño descomprimido no coincide con el declarado.");
        return out;
      }
    });
  }
  return entries;
}
