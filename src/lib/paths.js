// src/lib/paths.js · nomenclatura de archivos y rutas del paquete de evidencias

export const KIND_LABELS = {
  "screenshot-visible": "Captura visible",
  "screenshot-post": "Captura de publicación / elemento",
  "screenshot-page": "Captura de página completa",
  mhtml: "Copia MHTML de la página",
  "media-image": "Imagen descargada",
  "media-video": "Vídeo descargado",
  recording: "Grabación de pestaña",
  analysis: "Ficha de análisis (JSON)",
  "source-data": "Datos de origen (JSON)"
};

export function safeName(value, fallback = "archivo", max = 80) {
  const cleaned = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9._-]+/gi, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, max);
  return cleaned || fallback;
}

export const pad = (n, width = 4) => String(n).padStart(width, "0");
export const codeOf = (seq) => `EV-${pad(seq)}`;

const EXT_BY_MIME = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif", "video/mp4": ".mp4", "video/webm": ".webm", "application/json": ".json", "multipart/related": ".mhtml", "message/rfc822": ".mhtml" };
export const extFromMime = (mime, fallback = ".bin") => EXT_BY_MIME[String(mime || "").split(";")[0].trim().toLowerCase()] || fallback;

/** Carpeta dentro del ZIP (y de Descargas) según el tipo de evidencia. */
export function folderFor(kind, { platform = "", username = "", postId = "" } = {}) {
  switch (kind) {
    case "screenshot-visible":
    case "screenshot-post":
    case "screenshot-page": return "capturas";
    case "mhtml": return "paginas-mhtml";
    case "recording": return "grabaciones";
    case "analysis":
    case "source-data": return "datos-origen";
    case "media-image":
    case "media-video": {
      const parts = ["medios", safeName(platform.toLowerCase(), "web"), safeName(username, "sin-usuario", 40)];
      if (postId) parts.push(safeName(postId, "publicacion", 60));
      return parts.join("/");
    }
    default: return "otros";
  }
}

/** Nombre único: el código correlativo evita colisiones entre evidencias del mismo usuario/publicación. */
export function evidenceFilename(code, slug, extension) {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${code}_${safeName(slug, "evidencia", 90)}${ext}`;
}

/** Fecha local con desplazamiento explícito: 2026-09-19 21:03:12 (UTC+02:00). */
export function formatLocal(isoString, offsetMinutes) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const offset = Number.isFinite(offsetMinutes) ? offsetMinutes : -date.getTimezoneOffset();
  const shifted = new Date(date.getTime() + offset * 60000).toISOString().replace("T", " ").slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${shifted} (UTC${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)})`;
}
