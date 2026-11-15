// Datos FICTICIOS para pruebas y para los informes de ejemplo. Ninguna URL, cuenta ni referencia es real.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildManifest } from "../../src/lib/report.js";

const here = new URL(".", import.meta.url);
const dataUrl = (file, mime) => `data:${mime};base64,${readFileSync(new URL(file, here)).toString("base64")}`;
export const sha = (text) => createHash("sha256").update(text).digest("hex");

export const assets = () => ({
  institutionLogo: dataUrl("escudo-ficticio.png", "image/png"),
  institutionLogoJpeg: dataUrl("escudo-ficticio.jpg", "image/jpeg"),
  rastroLogo: dataUrl("../../assets/rastro-capture-logo-report.jpg", "image/jpeg"),
  previews: { "EV-0002": dataUrl("preview1.jpg", "image/jpeg"), "EV-0003": dataUrl("preview2.jpg", "image/jpeg") }
});

export function sampleInput({ evil = "" } = {}) {
  const post = { platform: "Instagram", id: "FICT123", code: "FICT123", numericId: "900000001", type: "carousel", url: "https://www.instagram.com/p/FICT123/", takenAt: "2026-10-30T18:22:10.000Z", caption: `Publicación ficticia de prueba #osint #ejemplo ${evil} 😀`, hashtags: ["osint", "ejemplo"], mentions: ["otra_cuenta_ficticia"], taggedUsers: [], author: { username: "usuario_ficticio", id: "55500001", name: "Usuario Ficticio" }, metrics: { likes: 12, comments: 3 }, media: [] };
  const source = { platform: "Instagram", pageKind: "post", contentType: "publicación", contentId: "FICT123", username: "usuario_ficticio", displayName: "Usuario Ficticio", url: "https://www.instagram.com/p/FICT123/", canonicalUrl: "https://www.instagram.com/p/FICT123/", title: "Usuario Ficticio en Instagram (ejemplo)", publishedAt: "2026-10-30T18:22:10.000Z", description: "Publicación ficticia", post, account: { platform: "Instagram", username: "usuario_ficticio", id: "55500001", name: "Usuario Ficticio", bio: "Cuenta inventada para documentación.", followers: 1500, following: 20, postsCount: 12 }, warnings: [] };
  const web = { platform: "Web", pageKind: "page", contentType: "página", contentId: "", username: "", url: "https://noticias.example/articulo-ficticio", canonicalUrl: "https://noticias.example/articulo-ficticio", title: "Artículo ficticio", description: "", post: null, account: null, warnings: ["Extractor web genérico: no se reconoce Instagram ni TikTok."] };
  const ev = (seq, kind, zipPath, mime, size, at, src, extra = {}) => ({ id: `id-${seq}`, seq, code: `EV-${String(seq).padStart(4, "0")}`, kind, type: kind, filename: zipPath.split("/").pop(), zipPath, mime, size, sha256: sha(`contenido-${seq}`), createdAt: at, utcOffsetMinutes: 60, note: "", case: { reference: "EXP-FICT-2026-014" }, source: src, details: {}, integrityVerified: true, sessionId: "RC-20261115-125700-A1B2C3", ...extra });
  const evidence = [
    ev(1, "analysis", "datos-origen/EV-0001_Instagram_usuario_ficticio_FICT123_analisis.json", "application/json", 5120, "2026-11-15T12:58:03.120Z", source),
    ev(2, "screenshot-visible", "capturas/EV-0002_Instagram_usuario_ficticio_FICT123_visible.png", "image/png", 483211, "2026-11-15T12:58:04.900Z", source, { note: "Vista de la publicación tal como se mostraba al acceder.", details: { pixelWidth: 1280, pixelHeight: 800, startUrl: source.url, endUrl: source.url } }),
    ev(3, "media-image", "medios/instagram/usuario_ficticio/FICT123/EV-0003_Instagram_usuario_ficticio_FICT123_img-1.jpg", "image/jpeg", 211034, "2026-11-15T12:59:10.004Z", source, { details: { mediaUrl: "https://cdn.example/ficticio/img1.jpg?token=abc", mediaIndex: 1, width: 1080, height: 1080, postKey: "Instagram:FICT123", http: { contentType: "image/jpeg", finalUrl: "https://cdn.example/ficticio/img1.jpg?token=abc", serverDate: "Sun, 15 Nov 2026 12:59:09 GMT" } } }),
    ev(4, "media-video", "medios/instagram/usuario_ficticio/FICT123/EV-0004_Instagram_usuario_ficticio_FICT123_video-2.mp4", "video/mp4", 4810022, "2026-11-15T12:59:14.550Z", source, { details: { mediaUrl: "https://cdn.example/ficticio/video2.mp4", mediaIndex: 2, postKey: "Instagram:FICT123" } }),
    ev(5, "screenshot-page", "capturas/EV-0005_Web_noticias.example_page_parte-01.png", "image/png", 1902211, "2026-11-15T13:04:41.000Z", web, { details: { frames: 6, part: 1, parts: 1, scrollMode: "window", fixedHidden: 1, pixelWidth: 1280, pixelHeight: 5210 } }),
    ev(6, "mhtml", "paginas-mhtml/EV-0006_Web_noticias.example_pagina.mhtml", "multipart/related", 802113, "2026-11-15T13:05:02.000Z", web)
  ];
  const log = [
    { at: "2026-11-15T12:57:40.000Z", action: "Sesión iniciada", detail: "RC-20261115-125700-A1B2C3", url: "" },
    { at: "2026-11-15T12:58:02.000Z", action: "Análisis", detail: "Instagram publicación FICT123", url: source.url },
    { at: "2026-11-15T12:58:03.200Z", action: "Ficha de análisis (JSON)", detail: evidence[0].filename, url: source.url, code: "EV-0001" },
    { at: "2026-11-15T12:58:05.000Z", action: "Captura visible", detail: evidence[1].filename, url: source.url, code: "EV-0002" },
    { at: "2026-11-15T12:59:10.100Z", action: "Imagen descargada", detail: evidence[2].filename, url: source.url, code: "EV-0003" },
    { at: "2026-11-15T12:59:12.000Z", action: "Error de descarga", level: "error", detail: "Imagen FICT123 #3: El servidor multimedia respondió 403 (acceso denegado o enlace caducado).", url: source.url },
    { at: "2026-11-15T12:59:14.600Z", action: "Vídeo descargado", detail: evidence[3].filename, url: source.url, code: "EV-0004" },
    { at: "2026-11-15T13:04:41.100Z", action: "Captura de página completa", detail: evidence[4].filename, url: web.url, code: "EV-0005" },
    { at: "2026-11-15T13:05:02.100Z", action: "Copia MHTML de la página", detail: evidence[5].filename, url: web.url, code: "EV-0006" },
    { at: "2026-11-15T13:06:00.000Z", action: "Exportación", detail: "Inicio de la exportación del paquete", url: "" }
  ];
  return {
    caseData: { reference: "EXP-FICT-2026-014", proceedings: "DP 0000/2026 (ficticias)", name: "Operación de ejemplo «Marea»", observations: "Datos ficticios elaborados para la documentación de RASTRO CAPTURE.\nLa publicación se localizó a partir de una búsqueda abierta." },
    institution: { unit: "Unidad Ficticia de Investigación Tecnológica", department: "Grupo de Ciberinteligencia (ejemplo)", investigatorId: "TIP 000000 (ficticio)", place: "Ciudad de Ejemplo" },
    session: { id: "RC-20261115-125700-A1B2C3", uuid: "00000000-0000-4000-8000-000000000000", startedAt: "2026-11-15T12:57:00.000Z", utcOffsetMinutes: 60 },
    environment: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", language: "es-ES", timezone: "Europe/Madrid", utcOffsetMinutes: 60, screen: "1920x1080", extensionVersion: "0.5.0" },
    evidence, catalog: { accounts: [source.account], posts: [post] }, log, generatedAt: "2026-11-15T13:06:01.000Z", packageName: "RASTRO_CAPTURE_EXP-FICT-2026-014_20261115T130601Z.zip"
  };
}
export const sampleManifest = (options) => buildManifest(sampleInput(options));
