const text = (bytes, start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

function isoBmffBrand(bytes) {
  let offset = 0;
  const limit = Math.min(bytes.length, 4096);
  while (offset + 8 <= limit) {
    const size = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
    const type = text(bytes, offset + 4, 4);
    if (type === "ftyp" || type === "styp") return text(bytes, offset + 8, 4).trim().toLowerCase();
    if (size < 8 || offset + size > limit) break;
    offset += size;
  }
  return "";
}

export function sniffMedia(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { family: "video", mime: "video/webm", extension: ".webm", label: "WebM" };
  }
  const brand = isoBmffBrand(bytes);
  if (brand === "avif" || brand === "avis") return { family: "image", mime: "image/avif", extension: ".avif", label: "AVIF" };
  if (brand) return { family: "video", mime: "video/mp4", extension: ".mp4", label: "MP4" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { family: "image", mime: "image/jpeg", extension: ".jpg", label: "JPEG" };
  }
  if (bytes[0] === 0x89 && text(bytes, 1, 3) === "PNG") {
    return { family: "image", mime: "image/png", extension: ".png", label: "PNG" };
  }
  if (text(bytes, 0, 6) === "GIF87a" || text(bytes, 0, 6) === "GIF89a") {
    return { family: "image", mime: "image/gif", extension: ".gif", label: "GIF" };
  }
  if (text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WEBP") {
    return { family: "image", mime: "image/webp", extension: ".webp", label: "WebP" };
  }
  return null;
}

export function validateMediaBytes(bytes, { kind, contentType = "" } = {}) {
  const detected = sniffMedia(bytes);
  const expectedFamily = /^imag/i.test(String(kind || "")) ? "image" : "video";
  if (!detected) {
    const prefix = new TextDecoder().decode(bytes.subarray(0, 96)).trim().toLowerCase();
    const looksLikePage = prefix.startsWith("<!doctype") || prefix.startsWith("<html") || prefix.startsWith("{") || prefix.startsWith("[");
    if (looksLikePage) throw new Error("El servidor devolvió una página o datos, no un archivo multimedia reproducible.");
    throw new Error(`El recurso no contiene un ${expectedFamily === "video" ? "vídeo MP4/WebM" : "archivo de imagen"} completo y compatible${contentType ? ` (${contentType})` : ""}.`);
  }
  if (detected.family !== expectedFamily) {
    throw new Error(`El recurso anunciado como ${kind || "multimedia"} contiene realmente un archivo ${detected.label}.`);
  }
  return detected;
}

const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

/**
 * Recorre las cajas de primer nivel de un MP4 sin cargarlo en memoria y comprueba que el fichero está completo:
 * cada caja cabe dentro del archivo y existe el índice (moov) o fragmentos (moof). Detecta los "tramos" parciales
 * que sirven algunas plataformas (p. ej. Instagram con bytestart/byteend) y las descargas cortadas.
 */
export async function inspectMp4(blob) {
  const boxes = [];
  let offset = 0;
  let guard = 0;
  while (offset + 8 <= blob.size && guard++ < 10000) {
    const head = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer());
    let size = u32(head, 0);
    const type = text(head, 4, 4);
    if (size === 1 && head.length >= 16) size = u32(head, 8) * 2 ** 32 + u32(head, 12);
    else if (size === 0) size = blob.size - offset;
    if (size < 8) return { complete: false, boxes, reason: "Estructura MP4 corrupta." };
    boxes.push({ type, offset, size });
    if (offset + size > blob.size) return { complete: false, boxes, reason: `La caja «${type}» declara ${size} bytes pero el archivo termina antes: descarga incompleta o tramo parcial.` };
    offset += size;
  }
  const types = boxes.map((b) => b.type);
  if (!types.includes("moov") && !types.includes("moof")) return { complete: false, boxes, reason: "El MP4 no contiene índice (moov) ni fragmentos (moof): no es un vídeo reproducible." };
  return { complete: true, boxes, reason: "" };
}
