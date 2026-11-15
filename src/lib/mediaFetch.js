// src/lib/mediaFetch.js · descarga de un recurso multimedia con validación forense
import { validateMediaBytes, inspectMp4 } from "./mediaValidation.js";

export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

const STATUS_HINT = {
  401: " (el servidor exige autenticación; la herramienta no elude controles de acceso)",
  403: " (acceso denegado o enlace caducado)",
  404: " (recurso no encontrado)",
  410: " (recurso retirado)",
  429: " (demasiadas peticiones; espera unos minutos y repite)",
  451: " (no disponible por motivos legales en esta ubicación)"
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Petición con un reintento ante fallos transitorios (corte de red o error 5xx). Nunca reintenta respuestas 4xx. */
async function requestWithRetry(url, { signal, fetchImpl, retryDelayMs }) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) throw new DOMException("Descarga cancelada.", "AbortError");
    try {
      const response = await fetchImpl(url, { credentials: "include", cache: "no-store", redirect: "follow", signal });
      if (response.status >= 500 && attempt === 0) { lastError = new Error(`El servidor multimedia respondió ${response.status}.`); await pause(retryDelayMs); continue; }
      return { response, attempts: attempt + 1 };
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = new Error(`No se pudo conectar con el servidor multimedia (${error?.message || "error de red"}). Comprueba la conexión, o usa la grabación de pestaña si el recurso exige la sesión de la página.`);
      if (attempt === 0) await pause(retryDelayMs);
    }
  }
  throw lastError;
}

/**
 * Descarga una URL como recurso multimedia y comprueba que es realmente imagen/vídeo, completo y del tipo esperado.
 * Devuelve el Blob (bytes recibidos, sin transformar) y los metadatos HTTP de la descarga (útiles como prueba de procedencia).
 * No crea nunca un archivo si el contenido no es válido.
 */
export async function fetchMedia(url, { kind, onProgress, signal, fetchImpl = globalThis.fetch, maxBytes = MAX_MEDIA_BYTES, retryDelayMs = 900 } = {}) {
  const { response, attempts } = await requestWithRetry(url, { signal, fetchImpl, retryDelayMs });
  if (!response.ok) throw new Error(`El servidor multimedia respondió ${response.status}${STATUS_HINT[response.status] || ""}.`);
  const total = Number(response.headers.get("content-length") || 0);
  if (total > maxBytes) throw new Error(`El recurso (${Math.round(total / 1048576)} MB) supera el límite operativo de ${Math.round(maxBytes / 1048576)} MB.`);
  const chunks = [];
  let received = 0;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (received > maxBytes) { await reader.cancel(); throw new Error(`El recurso supera el límite operativo de ${Math.round(maxBytes / 1048576)} MB.`); }
      onProgress?.(received, total);
    }
  } else {
    const bytes = new Uint8Array(await response.arrayBuffer());
    chunks.push(bytes); received = bytes.length;
  }
  if (!received) throw new Error("El servidor devolvió un archivo vacío.");
  if (total && received < total) throw new Error(`Descarga incompleta: se recibieron ${received} de ${total} bytes.`);
  const contentType = response.headers.get("content-type") || "";
  const raw = new Blob(chunks);
  const head = new Uint8Array(await raw.slice(0, 4096).arrayBuffer());
  const format = validateMediaBytes(head, { kind, contentType });
  let structure = null;
  if (format.mime === "video/mp4") {
    structure = await inspectMp4(raw);
    if (!structure.complete) throw new Error(structure.reason);
  }
  const blob = new Blob(chunks, { type: format.mime });
  const header = (name) => response.headers.get(name) || "";
  return {
    blob, format, structure: structure ? { boxes: structure.boxes.map((b) => b.type) } : null,
    http: { status: response.status, finalUrl: response.url || url, redirected: Boolean(response.redirected), contentType, contentLength: total || null, lastModified: header("last-modified"), etag: header("etag"), serverDate: header("date"), receivedBytes: received, attempts }
  };
}
