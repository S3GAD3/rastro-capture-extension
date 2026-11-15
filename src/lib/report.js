// src/lib/report.js · manifiesto, modelo de informe, informe HTML autónomo, CSV y textos del paquete de evidencias
// Funciones puras (sin acceso a red ni a APIs del navegador): se prueban en Node.
//
// Los dos informes (técnico completo y resumido para diligencias) se construyen a partir del MISMO manifiesto
// mediante un modelo de bloques (buildReportModel) que después se representa en HTML (reportHtml) o en PDF
// (src/lib/pdf.js). Cada dato lleva su procedencia: A = obtenido automáticamente, M = introducido manualmente
// por el investigador, I = inferido por la herramienta (con su fundamento).
import { KIND_LABELS, FILE_CLASS_LABELS, EVIDENCE_ROOT, kindInfo, formatLocal, formatBytes } from "./paths.js";

export const TOOL = { name: "RASTRO CAPTURE", version: "0.5.0", suite: "Kit RASTRO — Herramientas de Investigación de Fuentes Abiertas", author: "S3GAD3" };
export const SCHEMA = "RASTRO-CAPTURE/3";
export const REPORT_MODES = { tecnico: "Informe técnico completo", resumido: "Informe resumido para diligencias" };
export const ORIGIN = {
  A: { label: "Automático", text: "Dato obtenido automáticamente por la herramienta durante la captura (URL, fechas del equipo, nombres de archivo, metadatos, tamaños, hashes, datos entregados por la plataforma al navegador)." },
  M: { label: "Manual", text: "Dato introducido manualmente por el investigador (identificación de la unidad y del expediente, notas y observaciones)." },
  I: { label: "Inferido", text: "Dato deducido por la herramienta a partir de otros datos o patrones. No es un hecho verificado directamente; se indica su fundamento." }
};

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const safeHref = (url) => (/^https?:\/\//i.test(String(url || "")) ? String(url) : "");
const relPath = (p) => String(p || "").split("/").map(encodeURIComponent).join("/");
const num = (v) => (v === null || v === undefined ? "" : String(v));
const has = (v) => !(v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length));
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ""; } };
const sameText = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// ------------------------------------------------------------------- CSV
/** CSV con BOM UTF-8 y «;» (Excel en español). Neutraliza inyección de fórmulas (=, +, -, @) en contenido de terceros. */
export function toCsv(columns, rows) {
  const cell = (value) => {
    let s = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[columns.map((c) => cell(c.label)).join(";"), ...rows.map((row) => columns.map((c) => cell(c.get(row))).join(";"))].join("\r\n")}\r\n`;
}

export function inventoryCsv(evidence) {
  return toCsv([
    { label: "Código", get: (e) => e.code }, { label: "Tipo", get: (e) => KIND_LABELS[e.kind] || e.type }, { label: "Clase", get: (e) => e.fileClassLabel || "" }, { label: "Archivo", get: (e) => e.path },
    { label: "SHA-256", get: (e) => e.sha256 }, { label: "Bytes", get: (e) => e.size }, { label: "MIME", get: (e) => e.mime },
    { label: "Fecha UTC", get: (e) => e.createdAt }, { label: "Fecha local", get: (e) => e.createdLocal },
    { label: "Plataforma (inferida)", get: (e) => e.source?.platform }, { label: "Usuario", get: (e) => e.source?.username },
    { label: "URL origen", get: (e) => e.source?.url }, { label: "URL del recurso", get: (e) => e.details?.mediaUrl }, { label: "Método de captura", get: (e) => e.captureMethod || "" },
    { label: "Verificado en exportación", get: (e) => (e.integrityVerified ? "sí" : "NO") }, { label: "Advertencias", get: (e) => e.warnings || [] },
    { label: "Nota del investigador", get: (e) => e.note }
  ], evidence);
}

export function postsCsv(posts, filesByPost = {}) {
  return toCsv([
    { label: "Plataforma", get: (p) => p.platform }, { label: "ID", get: (p) => p.id }, { label: "URL", get: (p) => p.url },
    { label: "Tipo", get: (p) => p.type }, { label: "Autor", get: (p) => p.author?.username }, { label: "Fecha publicación (UTC)", get: (p) => p.takenAt },
    { label: "Texto", get: (p) => p.caption }, { label: "Hashtags", get: (p) => p.hashtags }, { label: "Menciones", get: (p) => p.mentions },
    { label: "Etiquetados", get: (p) => p.taggedUsers }, { label: "Ubicación", get: (p) => p.location }, { label: "Música", get: (p) => p.music },
    { label: "Me gusta", get: (p) => num(p.metrics?.likes) }, { label: "Comentarios", get: (p) => num(p.metrics?.comments) }, { label: "Reproducciones", get: (p) => num(p.metrics?.views) },
    { label: "Compartidos", get: (p) => num(p.metrics?.shares) }, { label: "Elementos multimedia", get: (p) => (p.media || []).filter((m) => m.role !== "cover" && m.url).length },
    { label: "Archivos guardados", get: (p) => filesByPost[`${p.platform}:${p.id}`] || [] }, { label: "Origen del dato", get: (p) => p.via }
  ], posts);
}

export function logCsv(log) {
  return toCsv([
    { label: "Fecha UTC", get: (l) => l.at }, { label: "Nivel", get: (l) => l.level || "info" }, { label: "Acción", get: (l) => l.action }, { label: "Detalle", get: (l) => l.detail || "" },
    { label: "URL", get: (l) => l.url || "" }, { label: "Evidencia", get: (l) => l.code || "" }
  ], log);
}

// ------------------------------------------------------------------- Manifiesto
const levelOf = (l) => l.level || (/alerta|error/i.test(l.action || "") ? "error" : /aviso|advertencia|cancel/i.test(l.action || "") ? "warn" : "info");

/**
 * Construye el manifiesto del paquete (esquema 3). `evidence` son los registros del almacén local con
 * `integrityVerified` ya calculado por el exportador (true / false) y, si falta el contenido, `blobMissing`.
 */
export function buildManifest({ caseData = {}, institution = {}, session = null, environment = {}, evidence = [], catalog = { accounts: [], posts: [] }, log = [], generatedAt = new Date().toISOString(), packageName = "" }) {
  const offset = Number.isFinite(environment.utcOffsetMinutes) ? environment.utcOffsetMinutes : undefined;
  const byKind = {};
  for (const e of evidence) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const reference = caseData.reference || "";
  const items = evidence.map((e) => {
    const info = kindInfo(e.kind);
    const warnings = [...new Set([...(e.source?.warnings || []), ...(e.details?.warnings || [])].filter(Boolean))];
    return {
      code: e.code, sequence: e.seq, id: e.id, sessionId: e.sessionId || session?.id || "", kind: e.kind, type: KIND_LABELS[e.kind] || e.type,
      fileClass: info.fileClass, fileClassLabel: FILE_CLASS_LABELS[info.fileClass], captureMethod: info.method,
      filename: e.filename, path: `${EVIDENCE_ROOT}/${e.zipPath}`, mime: e.mime, size: e.size, sha256: e.sha256,
      createdAt: e.createdAt, createdLocal: formatLocal(e.createdAt, e.utcOffsetMinutes ?? offset),
      sourceUrl: e.source?.canonicalUrl || e.source?.url || "", mediaUrl: e.details?.mediaUrl || "",
      note: e.note || "", integrityVerified: e.integrityVerified === true,
      integrityStatus: e.blobMissing ? "contenido-ausente" : e.integrityVerified === true ? "verificada" : "hash-diferente",
      warnings, caseReferenceAtCapture: e.case?.reference || "", source: e.source || null, details: e.details || {}
    };
  });
  const targets = [...new Set(items.map((i) => i.sourceUrl).filter(Boolean))];

  // Incidencias: errores y avisos del registro, discrepancias de integridad y mezcla de referencias.
  const incidents = [];
  for (const l of log) { const level = levelOf(l); if (level !== "info") incidents.push({ at: l.at, level, origin: "registro", action: l.action, detail: l.detail || "", code: l.code || "", url: l.url || "" }); }
  for (const i of items) {
    if (i.integrityStatus === "hash-diferente") incidents.push({ at: generatedAt, level: "error", origin: "integridad", action: "Huella no coincidente", detail: `${i.code} ${i.filename}: el SHA-256 recalculado al exportar no coincide con el registrado en la captura.`, code: i.code, url: "" });
    if (i.integrityStatus === "contenido-ausente") incidents.push({ at: generatedAt, level: "error", origin: "integridad", action: "Contenido ausente", detail: `${i.code} ${i.filename}: el contenido no está en el almacén local y no se incluye en el paquete.`, code: i.code, url: "" });
    if (i.caseReferenceAtCapture && reference && i.caseReferenceAtCapture !== reference) incidents.push({ at: i.createdAt, level: "warn", origin: "sesión", action: "Referencia distinta", detail: `${i.code} se incorporó con la referencia «${i.caseReferenceAtCapture}» y el paquete se exporta con «${reference}».`, code: i.code, url: "" });
  }
  const times = items.map((i) => i.createdAt).filter(Boolean).sort();
  const startedAt = session?.startedAt || times[0] || generatedAt;
  return {
    schema: SCHEMA, tool: { name: TOOL.name, version: TOOL.version }, generatedAt, generatedLocal: formatLocal(generatedAt, offset), packageName,
    session: {
      id: session?.id || "", uuid: session?.uuid || "", startedAt, startedLocal: formatLocal(startedAt, session?.utcOffsetMinutes ?? offset), endedAt: generatedAt, endedLocal: formatLocal(generatedAt, offset),
      firstCaptureAt: times[0] || "", lastCaptureAt: times[times.length - 1] || "", timezone: environment.timezone || "", utcOffsetMinutes: offset ?? null
    },
    institution: { unit: institution.unit || caseData.unit || "", department: institution.department || "", investigatorId: institution.investigatorId || caseData.investigator || "", place: institution.place || "" },
    case: {
      reference, proceedings: caseData.proceedings || "", name: caseData.name || "", observations: caseData.observations || "",
      investigator: institution.investigatorId || caseData.investigator || "", unit: institution.unit || caseData.unit || ""
    },
    dataOrigin: { A: ORIGIN.A.text, M: ORIGIN.M.text, I: ORIGIN.I.text, manualFields: ["institution.*", "case.*", "evidence[].note"], inferredFields: ["evidence[].source.platform", "evidence[].source.pageKind", "evidence[].source.contentType", "evidence[].source.contentId (si procede de la URL)", "evidence[].source.username (si procede de la URL o del DOM)"] },
    fileClasses: { original: "Bytes tal como los entregó el servidor de origen, sin transformación.", captura: "Archivo generado por el navegador o la herramienta en el momento de la captura; el hash corresponde al archivo generado.", derivado: "Elaborado a partir de otros datos (composición de tramos, ficha de análisis, informes, registros). No sustituye a los archivos de evidencia." },
    environment,
    summary: { evidenceCount: items.length, byKind, totalBytes: items.reduce((n, i) => n + (i.size || 0), 0), platforms: [...new Set(items.map((i) => i.source?.platform).filter(Boolean))], targets, incidents: incidents.length, allVerified: items.every((i) => i.integrityVerified) },
    evidence: items,
    documents: [],
    incidents,
    catalog: { accounts: catalog.accounts || [], posts: (catalog.posts || []).map(({ rawIndexes, ...rest }) => rest) },
    activityLog: log.map((l) => ({ ...l, level: levelOf(l) }))
  };
}

// ------------------------------------------------------------------- Textos del paquete
export function readmeText(manifest, { zipName = "", hasPdf = false, sumsName = "metadatos/SHA256SUMS.txt" } = {}) {
  const root = zipName ? zipName.replace(/\.zip$/i, "") : "RASTRO_CAPTURE_EXPEDIENTE";
  return `RASTRO CAPTURE ${manifest.tool.version} · PAQUETE DE EVIDENCIAS
${TOOL.suite} · Creado por ${TOOL.author}

Sesión:        ${manifest.session.id || "(sin identificador)"}
Diligencias:   ${manifest.case.proceedings || "(no consignadas)"}
Referencia:    ${manifest.case.reference || "(sin referencia)"}
Generado:      ${manifest.generatedAt} (UTC) · ${manifest.generatedLocal}
Evidencias:    ${manifest.summary.evidenceCount} archivos, ${manifest.summary.totalBytes} bytes
Incidencias:   ${manifest.incidents.length}

ORGANIZACIÓN DEL PAQUETE
${root}/
  evidencias/               Archivos de evidencia SIN MODIFICAR, cada uno con código correlativo EV-0001…
      capturas/             Capturas de pantalla (PNG).
      paginas-mhtml/        Copias MHTML de páginas.
      medios/<plataforma>/<usuario>/<publicación>/   Imágenes y vídeos descargados.
      grabaciones/          Grabaciones de pestaña (WebM).
      datos-origen/         Fichas de análisis y datos JSON recibidos por la página.
  informes/
      informe_tecnico.html  Informe técnico completo (autónomo: se abre sin conexión).
      informe_resumido.html Informe resumido para diligencias (autónomo).${hasPdf ? "\n      informe_tecnico.pdf   Versión PDF del informe técnico.\n      informe_resumido.pdf  Versión PDF del informe resumido." : ""}
  registros/
      actividad.json        Cronología de las operaciones registradas por la herramienta e incidencias.
      actividad.csv         La misma cronología en CSV.
      evidencias.csv        Inventario de evidencias con hash, fechas y URL de origen.
      publicaciones.csv     Publicaciones detectadas (solo si las hay).
  metadatos/
      manifest.json         Manifiesto: sesión, evidencias (ruta, tamaño, MIME, SHA-256, fecha, URL, método,
                            advertencias, clase original/derivado), documentos del paquete e incidencias.
      SHA256SUMS.txt        SHA-256 de todos los ficheros del paquete (salvo el propio SHA256SUMS.txt).
  README_EVIDENCIAS.txt     Este archivo.

Solo aparecen las carpetas y archivos que se han generado realmente.

ORIGINALES Y DERIVADOS
  Original          Bytes tal como los entregó el servidor de origen (imágenes y vídeos descargados).
  Captura generada  Archivo creado por el navegador o la herramienta al capturar (captura visible, MHTML,
                    grabación, datos JSON recibidos por la página). El hash corresponde al archivo generado.
  Derivado          Elaborado a partir de otros datos: capturas compuestas por tramos, fichas de análisis,
                    informes, registros y las vistas previas incrustadas en los informes.
  La clase de cada archivo figura en manifest.json (fileClass) y en los informes. Los informes y sus vistas
  previas NO sustituyen a los archivos de la carpeta evidencias/.

VERIFICACIÓN DE INTEGRIDAD
  A) Con RASTRO CAPTURE: pestaña EVIDENCIAS › «Verificar integridad». Selecciona el ZIP (y, si lo tienes, su
     archivo .sha256) o la carpeta extraída. La comprobación es local.
  B) Con herramientas del sistema, en la carpeta extraída (${root}/):
       Linux:               sha256sum -c ${sumsName}
       macOS:               shasum -a 256 -c ${sumsName}
       Windows PowerShell:  Get-FileHash -Algorithm SHA256 .\\evidencias\\capturas\\EV-0001_....png
       Windows CMD:         certutil -hashfile evidencias\\capturas\\EV-0001_....png SHA256
  C) Huella del paquete completo: si al exportar se generó «${zipName || "<paquete>.zip"}.sha256», contiene el SHA-256 del
     ZIP. Se entrega fuera del ZIP para no alterar los bytes sobre los que se calculó:
       Linux:  sha256sum -c ${zipName || "<paquete>.zip"}.sha256

ALCANCE
  - La coincidencia de hashes acredita que un archivo no ha cambiado desde que se generó el manifiesto. No
    acredita por sí misma quién creó el contenido ni cuándo fue publicado (autenticidad de origen).
  - Las fechas proceden del reloj del equipo del investigador; no hay sellado de tiempo cualificado.
  - La herramienta actúa sobre lo que el navegador del investigador puede mostrar; no elude autenticación,
    controles de acceso ni DRM, y no exporta cookies, credenciales ni tokens de sesión.
  - Los CSV usan «;» y UTF-8 con BOM (se abren correctamente en Excel en español).
  - Conserva el ZIP sin modificar y trabaja sobre copias.
`;
}
/** Compatibilidad con versiones anteriores del código. */
export const verificationText = (manifest, sumsName) => readmeText(manifest, { sumsName });

// ------------------------------------------------------------------- Modelo de informe
const T = (text, extra = {}) => ({ text: String(text ?? ""), ...extra });
const mono = (text) => T(text, { mono: true });
const fileLink = (path, label) => T(label || path, { href: `../${relPath(path)}`, rel: true });
const webLink = (url, label) => (safeHref(url) ? T(label || url, { href: url }) : T(label || url || ""));

function metricsText(m = {}) {
  return [["Me gusta", m.likes], ["Comentarios", m.comments], ["Reproducciones", m.views], ["Compartidos", m.shares], ["Guardados", m.saves]]
    .filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ");
}

function techLines(e) {
  const d = e.details || {};
  const out = [];
  const push = (k, v) => { if (v !== undefined && v !== null && v !== "" && v !== false) out.push(`${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`); };
  push("URL del recurso", d.mediaUrl); push("URL final tras redirecciones", d.http?.finalUrl !== d.mediaUrl ? d.http?.finalUrl : "");
  push("Dimensiones", d.width && d.height ? `${d.width}×${d.height}` : ""); push("Posición", d.mediaIndex ? `elemento ${d.mediaIndex}` : ""); push("Caducidad del enlace", d.expiresAt);
  push("Content-Type recibido", d.http?.contentType); push("Last-Modified", d.http?.lastModified); push("Date (servidor)", d.http?.serverDate); push("ETag", d.http?.etag);
  push("Región capturada", d.region); push("Tamaño (px)", d.pixelWidth && d.pixelHeight ? `${d.pixelWidth}×${d.pixelHeight}` : ""); push("Tramos", d.frames); push("Parte", d.part ? `${d.part}/${d.parts}` : "");
  push("Elementos fijos ocultados", d.fixedHidden); push("Contenedor de scroll", d.scrollMode); push("URL al iniciar", d.startUrl); push("URL al terminar", d.endUrl !== d.startUrl ? d.endUrl : "");
  push("Inicio", d.startedAt); push("Fin", d.endedAt); push("Duración (s)", d.durationSeconds); push("Audio", d.hasAudio === undefined ? "" : d.hasAudio ? "sí" : "no");
  push("Copia en Descargas", d.downloadPath); push("Origen de los datos", d.origin); push("Página donde se localizó", d.discoveredOn);
  return out;
}

function groupTargets(evidence) {
  const groups = new Map();
  for (const e of evidence) {
    const key = e.sourceUrl || "sin-origen";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].map(([key, items], i) => ({ key, items, index: i + 1, source: items.find((x) => x.source?.post)?.source || items[0].source || {} }));
}

const kv = (label, value, origin, basis = "") => ({ label, value, origin, basis });
const rowsOf = (list) => list.filter((r) => r && has(r.value) && !(typeof r.value === "object" && !Array.isArray(r.value) && !has(r.value.text)));

/** Fila «usuario» con procedencia: A si coincide con los datos entregados por la plataforma; I si procede de la URL/DOM. */
function usernameRow(s) {
  if (!s.username) return null;
  const fromPlatform = sameText(s.post?.author?.username, s.username) || sameText(s.account?.username, s.username);
  return kv("Usuario o identificador del perfil", `@${s.username}`, fromPlatform ? "A" : "I", fromPlatform ? "" : "Deducido de la ruta de la URL o del contenido visible de la página; no confirmado con datos de la plataforma.");
}
function contentIdRow(s) {
  if (!s.contentId) return null;
  const fromPlatform = s.post && [s.post.code, s.post.id, s.post.numericId].map(String).includes(String(s.contentId));
  return kv("Identificador de la publicación", s.contentId, fromPlatform ? "A" : "I", fromPlatform ? "" : "Extraído de la ruta de la URL.");
}

function missingData(target) {
  const s = target.source || {};
  const out = [];
  if (!s.username) out.push("usuario o identificador del perfil no determinado");
  if (!s.contentId && ["post", "reel", "video", "story"].includes(s.pageKind)) out.push("identificador de la publicación no detectado");
  if (!(s.post?.takenAt || s.publishedAt) && s.pageKind !== "profile" && s.pageKind !== "recording") out.push("fecha de publicación no disponible");
  if (s.platform && s.platform !== "Web" && !s.post && !s.account && s.pageKind !== "recording") out.push("sin datos estructurados de la plataforma (solo contenido visible)");
  return out;
}

const STANDARD_LIMITS = [
  "La herramienta actúa exclusivamente sobre el contenido que el navegador del investigador puede mostrar en el momento de la captura. No elude autenticación, controles de acceso, cifrado ni DRM.",
  "Las fechas y horas de acceso proceden del reloj del equipo del investigador. No existe sellado de tiempo cualificado de terceros.",
  "El SHA-256 permite comprobar que un archivo no ha cambiado desde su incorporación. No acredita por sí mismo quién creó el contenido ni cuándo fue publicado.",
  "Los textos, fechas de publicación, métricas e identificadores de cuenta son los que la plataforma entregó o mostró al navegador; pueden variar con posterioridad y dependen de la sesión, el idioma y la ubicación desde la que se accede.",
  "Las capturas de página o de elemento «por tramos» son composiciones de varias capturas de la vista visible obtenidas desplazando la página; cuando se indica «elementos fijos ocultados» se ocultaron barras o avisos superpuestos para no repetirlos.",
  "Las emisiones segmentadas (HLS/DASH) y los vídeos con fuente interna no se descargan directamente: se documentan mediante grabación de pestaña (WebM), que es una captura generada y no el archivo original del servidor.",
  "La copia MHTML es complementaria y no garantiza que las aplicaciones web dinámicas funcionen al abrirla.",
  "Las vistas previas incrustadas en este informe son representaciones reducidas (derivadas). La evidencia es el archivo indicado en cada caso dentro de la carpeta evidencias/."
];

function headOf(manifest, mode) {
  return {
    mode, title: mode === "resumido" ? "INFORME RESUMIDO DE CAPTURA Y PRESERVACIÓN DE CONTENIDO WEB" : "INFORME TÉCNICO DE CAPTURA Y PRESERVACIÓN DE EVIDENCIAS DIGITALES",
    subtitle: REPORT_MODES[mode], unit: manifest.institution.unit || "", department: manifest.institution.department || "",
    proceedings: manifest.case.proceedings || "", reference: manifest.case.reference || "", sessionId: manifest.session.id || "",
    generated: `${manifest.generatedAt} UTC`, toolLine: `${manifest.tool.name} ${manifest.tool.version}`
  };
}

function actuationRows(manifest, full) {
  const s = manifest.session, c = manifest.case, inst = manifest.institution, env = manifest.environment || {};
  const off = Number.isFinite(s.utcOffsetMinutes) ? formatLocal("2000-01-01T00:00:00Z", s.utcOffsetMinutes).match(/\((UTC[^)]+)\)/)?.[1] : "";
  return rowsOf([
    kv("Unidad investigadora", inst.unit, "M"), kv("Dependencia o grupo", inst.department, "M"),
    kv("Número de diligencias", c.proceedings, "M"), kv("Referencia del expediente", c.reference, "M"), full ? kv("Denominación de la investigación", c.name, "M") : null,
    kv("Identificador profesional del investigador", inst.investigatorId, "M"), kv("Lugar de actuación", inst.place, "M"),
    kv("Identificador de la sesión", s.id, "A"),
    kv("Inicio de la sesión", s.startedAt ? [`${s.startedLocal} (hora local)`, `${s.startedAt} (UTC)`] : "", "A"),
    kv("Primera / última captura", s.firstCaptureAt ? [`${formatLocal(s.firstCaptureAt, s.utcOffsetMinutes ?? undefined)} / ${formatLocal(s.lastCaptureAt, s.utcOffsetMinutes ?? undefined)}`, `${s.firstCaptureAt} / ${s.lastCaptureAt} (UTC)`] : "", "A"),
    kv("Finalización (generación del paquete)", [`${s.endedLocal} (hora local)`, `${s.endedAt} (UTC)`], "A"),
    kv("Zona horaria local y referencia UTC", [s.timezone, off].filter(Boolean).join(" · "), "A"),
    kv("Herramienta y versión", `${manifest.tool.name} ${manifest.tool.version} (extensión de navegador, procesamiento local)`, "A"),
    full ? kv("Navegador (agente de usuario)", env.userAgent, "A") : null,
    full ? kv("Idioma / pantalla", [env.language, env.screen].filter(Boolean).join(" · "), "A") : null
  ]);
}

function resourceBlocks(target, manifest) {
  const s = target.source || {};
  const post = s.post;
  const account = s.account || (manifest.catalog.accounts || []).find((a) => a.platform === s.platform && sameText(a.username, s.username));
  const url = s.url || (target.key !== "sin-origen" ? target.key : "");
  const times = target.items.map((i) => i.createdAt).sort();
  const off = manifest.session.utcOffsetMinutes ?? undefined;
  const blocks = [{ t: "h3", text: `Recurso ${target.index}` }];
  blocks.push({ t: "kv", rows: rowsOf([
    kv("URL completa", url ? webLink(url) : "No consta", "A"),
    s.canonicalUrl && s.canonicalUrl !== url ? kv("URL canónica declarada por la página", webLink(s.canonicalUrl), "A") : null,
    kv("Dominio", hostOf(url), "A"),
    kv("Plataforma", s.platform, "I", "Deducida del nombre de host de la URL."),
    usernameRow(s), contentIdRow(s),
    kv("Tipo de contenido", s.contentType, "I", "Deducido del patrón de la URL."),
    kv("Título de la página", s.title, "A"),
    kv("Fecha y hora de acceso (primera / última captura)", times.length ? [`${formatLocal(times[0], off)} / ${formatLocal(times[times.length - 1], off)}`, `${times[0]} / ${times[times.length - 1]} (UTC)`] : "", "A"),
    kv("Fecha de publicación según la plataforma", post?.takenAt || s.publishedAt, "A"),
    kv("Texto o descripción", post?.caption || s.description, "A"),
    kv("Hashtags", (post?.hashtags || []).map((h) => `#${h}`).join(" "), "A"), kv("Menciones", (post?.mentions || []).map((h) => `@${h}`).join(" "), "A"),
    kv("Usuarios etiquetados", (post?.taggedUsers || []).map((h) => `@${h}`).join(" "), "A"), kv("Ubicación indicada", post?.location, "A"), kv("Música o sonido", post?.music, "A"),
    kv("Métricas mostradas", metricsText(post?.metrics), "A"),
    kv("Evidencias asociadas", target.items.map((i) => i.code).join(", "), "A")
  ]) });
  if (account) {
    blocks.push({ t: "h4", text: "Datos de la cuenta entregados o mostrados por la plataforma" });
    blocks.push({ t: "kv", rows: rowsOf([
      kv("Usuario", account.username ? `@${account.username}` : "", "A"), kv("Nombre mostrado", account.name, "A"), kv("Identificador interno", account.id, "A"),
      kv("Cuenta verificada", account.verified ? "sí" : "", "A"), kv("Cuenta privada", account.isPrivate ? "sí" : "", "A"), kv("Biografía", account.bio, "A"),
      kv("Seguidores", num(account.followers ?? account.displayed?.followersText), "A"), kv("Siguiendo", num(account.following ?? account.displayed?.followingText), "A"),
      kv("Publicaciones", num(account.postsCount ?? account.displayed?.postsText), "A"), kv("Enlace externo", account.externalUrl ? webLink(account.externalUrl) : "", "A"),
      kv("Foto de perfil (URL)", account.avatarUrl ? webLink(account.avatarUrl) : "", "A")
    ]) });
  }
  return blocks;
}

const integrityCell = (e) => (e.integrityStatus === "verificada" ? T("Coincide", { cls: "ok" }) : e.integrityStatus === "contenido-ausente" ? T("Contenido ausente", { cls: "bad" }) : T("NO coincide", { cls: "bad" }));
const localShort = (iso, off) => formatLocal(iso, off).replace(/\s*\(UTC[^)]*\)$/, "");
/** Fecha UTC compacta para tablas (los milisegundos figuran en manifest.json): 2026-11-15 12:58:03 UTC. */
const utcShort = (iso) => String(iso || "").replace("T", " ").replace(/(\.\d+)?Z$/, " UTC");

function evidenceTable(manifest, { withUrl = true } = {}) {
  const columns = withUrl
    ? [{ label: "Nº", w: 0.085 }, { label: "Archivo", w: 0.215 }, { label: "Tipo", w: 0.12 }, { label: "Tamaño", w: 0.075 }, { label: "Fecha y hora (UTC)", w: 0.115 }, { label: "URL de procedencia", w: 0.165 }, { label: "SHA-256", w: 0.225 }]
    : [{ label: "Nº", w: 0.09 }, { label: "Archivo", w: 0.31 }, { label: "Tipo", w: 0.15 }, { label: "Tamaño", w: 0.09 }, { label: "SHA-256", w: 0.36 }];
  const rows = manifest.evidence.map((e) => (withUrl
    ? [e.code, fileLink(e.path, e.filename), e.type, formatBytes(e.size), utcShort(e.createdAt), e.mediaUrl || e.sourceUrl || "No consta", mono(e.sha256)]
    : [e.code, fileLink(e.path, e.filename), e.type, formatBytes(e.size), mono(e.sha256)]));
  return { t: "table", columns, rows, empty: "No hay evidencias en la sesión." };
}

function incidentBlocks(manifest, { brief = false } = {}) {
  const off = manifest.session.utcOffsetMinutes ?? undefined;
  const list = brief ? manifest.incidents.filter((i) => i.level === "error" || i.origin !== "registro") : manifest.incidents;
  if (!list.length) return [{ t: "p", text: brief ? "No se han registrado incidencias relevantes durante la actuación." : "La herramienta no ha registrado errores ni avisos durante la sesión.", origin: "A" }];
  return [{ t: "table", columns: [{ label: "Fecha y hora (local)", w: 0.17 }, { label: "Nivel", w: 0.09 }, { label: "Incidencia", w: 0.2 }, { label: "Detalle", w: 0.44 }, { label: "Evidencia", w: 0.1 }],
    rows: list.map((i) => [localShort(i.at, off), T(i.level === "error" ? "Error" : "Aviso", { cls: i.level === "error" ? "bad" : "warn" }), i.action, i.detail, i.code]) }];
}

function operationsNarrative(manifest, targets) {
  const s = manifest.session;
  const off = s.utcOffsetMinutes ?? undefined;
  const n = manifest.evidence.length;
  if (!n) return "No se ha incorporado ninguna evidencia a la sesión.";
  const kinds = Object.entries(manifest.summary.byKind).map(([k, c]) => `${c} × ${(KIND_LABELS[k] || k).toLowerCase()}`).join("; ");
  const bad = manifest.evidence.filter((e) => !e.integrityVerified).length;
  return `Entre las ${formatLocal(s.firstCaptureAt, off)} y las ${formatLocal(s.lastCaptureAt, off)} (referencia UTC: ${s.firstCaptureAt} a ${s.lastCaptureAt}), mediante la extensión de navegador ${manifest.tool.name} ${manifest.tool.version}, se accedió a ${targets.length} recurso${targets.length === 1 ? "" : "s"} web y se incorporaron a la sesión ${n} archivo${n === 1 ? "" : "s"} (${formatBytes(manifest.summary.totalBytes)}): ${kinds}. De cada archivo se calculó la huella SHA-256 en el momento de su incorporación y se recalculó al generar el paquete, ${bad ? `con ${bad} discrepancia${bad === 1 ? "" : "s"} que se detalla${bad === 1 ? "" : "n"} en el apartado de incidencias` : "con resultado coincidente en todos los casos"}.`;
}

/**
 * Modelo de bloques del informe. `mode`: "tecnico" | "resumido". `previews`: códigos de evidencia con vista previa disponible.
 */
export function buildReportModel(manifest, mode = "tecnico", { previewCodes = [] } = {}) {
  const full = mode !== "resumido";
  const targets = groupTargets(manifest.evidence);
  const off = manifest.session.utcOffsetMinutes ?? undefined;
  const blocks = [];
  const h2 = (text, id) => blocks.push({ t: "h2", text, id });
  const p = (text, extra = {}) => blocks.push({ t: "p", text, ...extra });
  const notes = manifest.evidence.filter((e) => e.note);
  const pkg = manifest.packageName || "paquete de evidencias";

  if (!full) {
    h2("1. Datos de la actuación", "actuacion");
    blocks.push({ t: "kv", rows: actuationRows(manifest, false) });
    h2("2. Recurso o perfil examinado", "recurso");
    if (targets.length) blocks.push({ t: "table", columns: [{ label: "Nº", w: 0.06 }, { label: "URL", w: 0.44 }, { label: "Plataforma (inferida)", w: 0.14 }, { label: "Usuario / identificador", w: 0.2 }, { label: "Evidencias", w: 0.16 }],
      rows: targets.map((t) => [String(t.index), t.key === "sin-origen" ? "No consta" : webLink(t.source.url || t.key), t.source.platform || "", [t.source.username ? `@${t.source.username}` : "", t.source.contentId || ""].filter(Boolean).join(" · ") || "No determinado", t.items.map((i) => i.code).join(", ")]) });
    else p("No se ha documentado ningún recurso.");
    p("La plataforma se deduce del nombre de host de la URL. El usuario y el identificador proceden de los datos entregados por la plataforma al navegador o, en su defecto, de la ruta de la URL; en el informe técnico se indica la procedencia de cada dato.", { cls: "muted" });
    h2("3. Operaciones realizadas", "operaciones");
    p(operationsNarrative(manifest, targets), { origin: "A" });
    h2("4. Relación de archivos obtenidos y huellas SHA-256", "archivos");
    blocks.push(evidenceTable(manifest, { withUrl: false }));
    h2("5. Incidencias relevantes", "incidencias");
    blocks.push(...incidentBlocks(manifest, { brief: true }));
    if (manifest.case.observations || notes.length) {
      h2("6. Observaciones del investigador", "observaciones");
      if (manifest.case.observations) p(manifest.case.observations, { origin: "M", pre: true });
      if (notes.length) blocks.push({ t: "table", columns: [{ label: "Evidencia", w: 0.14 }, { label: "Nota del investigador", w: 0.86 }], rows: notes.map((e) => [e.code, e.note]), origin: "M" });
    }
    h2(`${manifest.case.observations || notes.length ? 7 : 6}. Paquete de evidencias y verificación`, "paquete");
    blocks.push({ t: "kv", rows: rowsOf([
      kv("Paquete completo de evidencias", pkg, "A"),
      kv("Manifiesto", "metadatos/manifest.json (relación de archivos, tamaños, tipos, huellas, fechas, URL de origen, método de captura y advertencias)", "A"),
      kv("Huella del paquete", `El SHA-256 del archivo ZIP se entrega en un archivo independiente (${pkg}.sha256), fuera del paquete, para no alterar los bytes sobre los que se calcula.`, "A"),
      kv("Informe técnico completo", "informes/informe_tecnico.html", "A"),
      kv("Verificación", "Función «Verificar integridad» de RASTRO CAPTURE o comprobación con sha256sum sobre metadatos/SHA256SUMS.txt (ver README_EVIDENCIAS.txt).", "A")
    ]) });
    p("Este documento describe operaciones técnicas y sus resultados. Las huellas SHA-256 permiten comprobar que los archivos no han sido modificados desde su incorporación; no acreditan por sí mismas la autoría del contenido, la identidad de quien lo publicó ni la fecha de publicación.", { cls: "note" });
    blocks.push({ t: "legend" });
    return { head: headOf(manifest, mode), blocks, previewCodes: [] };
  }

  // ---------------- Informe técnico completo
  h2("1. Identificación de la actuación", "actuacion");
  blocks.push({ t: "kv", rows: actuationRows(manifest, true) });
  blocks.push({ t: "legend" });

  h2("2. Identificación del recurso", "recurso");
  if (!targets.length) p("No se ha documentado ningún recurso.");
  for (const target of targets) blocks.push(...resourceBlocks(target, manifest));

  h2("3. Descripción técnica de la captura", "captura");
  p(operationsNarrative(manifest, targets), { origin: "A" });
  blocks.push({ t: "h3", text: "Método empleado y recursos obtenidos" });
  blocks.push({ t: "table", columns: [{ label: "Tipo de evidencia", w: 0.22 }, { label: "Nº", w: 0.06 }, { label: "Clase", w: 0.14 }, { label: "Método de captura", w: 0.58 }],
    rows: Object.entries(manifest.summary.byKind).map(([k, c]) => [KIND_LABELS[k] || k, String(c), FILE_CLASS_LABELS[kindInfo(k).fileClass], kindInfo(k).method]), empty: "Sin evidencias." });
  const ops = {};
  for (const l of manifest.activityLog) ops[l.action] = (ops[l.action] || 0) + 1;
  blocks.push({ t: "h3", text: "Operaciones registradas" });
  blocks.push({ t: "table", columns: [{ label: "Operación", w: 0.8 }, { label: "Veces", w: 0.2 }], rows: Object.entries(ops).map(([k, c]) => [k, String(c)]), empty: "El registro de actividad está vacío." });
  const count = (re) => manifest.evidence.filter((e) => re.test(e.kind)).length;
  blocks.push({ t: "kv", rows: rowsOf([
    kv("Capturas de pantalla", String(count(/^screenshot/)), "A"), kv("Contenidos audiovisuales (imágenes / vídeos / grabaciones)", `${count(/^media-image$/)} / ${count(/^media-video$/)} / ${count(/^recording$/)}`, "A"),
    kv("Copias MHTML", String(count(/^mhtml$/)), "A"), kv("Archivos de datos (fichas de análisis / datos de origen)", `${count(/^analysis$/)} / ${count(/^source-data$/)}`, "A"),
    kv("Metadatos disponibles", "URL y título de la página, fecha y hora de cada captura (UTC y local), entorno del navegador, cabeceras HTTP de las descargas, dimensiones, datos de publicación y de cuenta entregados por la plataforma, tamaño, tipo MIME y SHA-256 de cada archivo.", "A"),
    kv("Incidencias registradas", String(manifest.incidents.length), "A")
  ]) });

  h2("4. Relación de evidencias", "evidencias");
  blocks.push(evidenceTable(manifest, { withUrl: true }));
  p(`Los archivos se encuentran en la carpeta ${EVIDENCE_ROOT}/ del paquete. El inventario completo figura también en registros/evidencias.csv y en metadatos/manifest.json.`, { cls: "muted" });

  h2("5. Integridad de evidencias", "integridad");
  p("El SHA-256 es una función resumen: cualquier cambio en un archivo, por mínimo que sea, produce una huella distinta. Cada huella se calculó sobre los bytes del archivo en el momento de su incorporación a la sesión y se recalculó al generar este paquete. Volver a calcularla en el futuro y compararla con la aquí consignada permite comprobar que el archivo no ha sido modificado.");
  blocks.push({ t: "table", columns: [{ label: "Evidencia", w: 0.1 }, { label: "Clase", w: 0.14 }, { label: "SHA-256", w: 0.6 }, { label: "Comprobación al exportar", w: 0.16 }],
    rows: manifest.evidence.map((e) => [e.code, e.fileClassLabel, mono(e.sha256), integrityCell(e)]), empty: "Sin evidencias." });
  p("Clases: «Original» = bytes tal como los entregó el servidor de origen; «Captura generada» = archivo creado por el navegador o la herramienta al capturar; «Derivado» = elaborado a partir de otros datos (p. ej., captura compuesta por tramos o ficha de análisis).", { cls: "muted" });
  p(`La huella de todos los ficheros del paquete figura en metadatos/SHA256SUMS.txt. El SHA-256 del archivo ZIP completo se entrega aparte (${pkg}.sha256) porque incluirlo dentro del ZIP alteraría los bytes sobre los que se calcula. La coincidencia de huellas acredita la integridad de los archivos respecto de este manifiesto; no acredita por sí misma la autoría ni la fecha de publicación del contenido.`, { cls: "note" });

  h2("6. Cronología de operaciones", "cronologia");
  blocks.push({ t: "table", columns: [{ label: "Fecha y hora (UTC)", w: 0.19 }, { label: "Hora local", w: 0.15 }, { label: "Operación", w: 0.19 }, { label: "Detalle", w: 0.37 }, { label: "Evidencia", w: 0.1 }],
    rows: manifest.activityLog.map((l) => [utcShort(l.at), localShort(l.at, off), l.level && l.level !== "info" ? T(l.action, { cls: l.level === "error" ? "bad" : "warn" }) : l.action, l.detail || "", l.code || ""]), empty: "El registro de actividad está vacío." });

  h2("7. Observaciones del investigador", "observaciones");
  p("Este apartado contiene exclusivamente información introducida manualmente por el investigador.", { cls: "muted" });
  if (manifest.case.observations) p(manifest.case.observations, { origin: "M", pre: true }); else p("Sin observaciones generales.", { origin: "M" });
  if (notes.length) blocks.push({ t: "table", columns: [{ label: "Evidencia", w: 0.14 }, { label: "Nota del investigador", w: 0.86 }], rows: notes.map((e) => [e.code, e.note]), origin: "M" });

  h2("8. Limitaciones técnicas", "limitaciones");
  blocks.push({ t: "h3", text: "Incidencias y errores registrados" });
  blocks.push(...incidentBlocks(manifest));
  const missing = targets.map((t) => ({ t, list: missingData(t), warns: [...new Set(t.items.flatMap((i) => i.warnings || []))] })).filter((x) => x.list.length || x.warns.length);
  blocks.push({ t: "h3", text: "Datos que no han podido obtenerse y avisos de la captura" });
  if (missing.length) blocks.push({ t: "table", columns: [{ label: "Recurso", w: 0.1 }, { label: "Datos no obtenidos", w: 0.4 }, { label: "Avisos de la herramienta durante la captura", w: 0.5 }], rows: missing.map((x) => [`Recurso ${x.t.index}`, x.list.join("; ") || "—", x.warns.join(" ") || "—"]) });
  else p("No constan datos pendientes ni avisos de captura.", { origin: "A" });
  blocks.push({ t: "h3", text: "Limitaciones generales y restricciones de las plataformas" });
  blocks.push({ t: "list", items: STANDARD_LIMITS });

  h2("9. Anexo de evidencias", "anexo");
  p("Vistas previas reducidas (derivadas) e identificación de cada evidencia. El archivo de evidencia es el indicado en cada ficha.", { cls: "muted" });
  const have = new Set(previewCodes);
  for (const e of manifest.evidence) {
    blocks.push({ t: "figure", code: e.code, preview: have.has(e.code), title: `${e.code} · ${e.type}`, lines: [
      [T("Archivo: "), fileLink(e.path)], `Clase: ${e.fileClassLabel} · ${e.mime || "tipo no declarado"} · ${formatBytes(e.size)} (${e.size} bytes)`,
      `Obtenida: ${e.createdLocal} · ${e.createdAt} UTC`, [T("SHA-256: "), mono(e.sha256)],
      e.sourceUrl ? [T("URL de procedencia: "), webLink(e.sourceUrl)] : "URL de procedencia: no consta",
      ...(e.note ? [T(`Nota del investigador [M]: ${e.note}`)] : []), ...(e.warnings?.length ? [T(`Avisos: ${e.warnings.join(" ")}`, { cls: "warn" })] : []), ...techLines(e).map((l) => T(l, { cls: "muted" }))
    ] });
  }
  return { head: headOf(manifest, mode), blocks, previewCodes: [...have] };
}

// ------------------------------------------------------------------- Informe HTML autónomo
const cssString = (value) => `"${String(value ?? "").replace(/[^a-zA-Z0-9 .,:;_\-/()áéíóúñÁÉÍÓÚÑüÜ·]/g, (c) => `\\${c.codePointAt(0).toString(16)} `)}"`;

const REPORT_CSS = `
:root{--navy:#0b1f3f;--blue:#1d4f91;--line:#c9d5e2;--muted:#5a6f86;--soft:#eef2f6}
*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;background:var(--soft);color:#12233a;font:13px/1.5 "Segoe UI",Roboto,Arial,Helvetica,sans-serif}
.sheet{max-width:1020px;margin:18px auto;background:#fff;border:1px solid var(--line);padding:26px 30px}
.doc-head{display:flex;align-items:center;gap:16px;border-bottom:3px solid var(--navy);padding-bottom:12px}
.doc-head .crest{flex:0 0 auto}.doc-head .crest img{display:block;max-height:86px;max-width:150px}
.doc-head .org{flex:1;min-width:0}.doc-head .unit{font-size:17px;font-weight:700;color:var(--navy);text-transform:uppercase;letter-spacing:.02em;overflow-wrap:anywhere}
.doc-head .dept{color:var(--muted);font-size:13px;overflow-wrap:anywhere}.doc-head .ref{flex:0 0 auto;text-align:right;font-size:11.5px;color:#22344d;max-width:38%;overflow-wrap:anywhere}
.doc-head .ref b{color:var(--navy)}
h1.doc-title{margin:16px 0 2px;font-size:19px;color:var(--navy);letter-spacing:.02em}.doc-sub{margin:0 0 12px;color:var(--muted);font-size:12px}
section{margin:18px 0 0}h2{margin:0 0 9px;font-size:15px;color:#fff;background:var(--navy);padding:5px 9px;break-after:avoid}
h3{margin:14px 0 6px;font-size:13.5px;color:var(--navy);border-bottom:1px solid var(--blue);padding-bottom:2px;break-after:avoid}h4{margin:10px 0 5px;font-size:12.5px;color:var(--blue);break-after:avoid}
p{margin:6px 0}p.pre{white-space:pre-wrap}p.muted,.muted{color:var(--muted)}p.note{background:#fff8e1;border:1px solid #e0c36a;padding:7px 9px}
table{border-collapse:collapse;width:100%;font-size:11.5px;table-layout:fixed;margin:4px 0 8px}
th,td{border:1px solid var(--line);padding:4px 6px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
thead{display:table-header-group}thead th{background:#dfe8f2;color:var(--navy)}tr{break-inside:avoid}
table.kv th{width:31%;background:#eef2f6;font-weight:600}table.kv td.o{width:44px;text-align:center}
.mono{font-family:Consolas,"Courier New",monospace;font-size:10.5px}.ok{color:#17643a;font-weight:700}.bad{color:#a11d13;font-weight:700}.warn{color:#8a5a00;font-weight:600}
.o-tag{display:inline-block;min-width:18px;padding:0 4px;border-radius:3px;font-size:10px;font-weight:700;color:#fff;text-align:center}
.o-A{background:#1d4f91}.o-M{background:#6b4c9a}.o-I{background:#b26a00}.basis{display:block;color:#8a5a00;font-size:10.5px;font-style:italic}
.legend{display:grid;gap:3px;border:1px solid var(--line);background:#f7f9fc;padding:7px 9px;font-size:11px;margin:8px 0}
ul.limits{margin:4px 0 4px 18px;padding:0}ul.limits li{margin:3px 0}
figure{margin:10px 0;padding:9px;border:1px solid var(--line);background:#fafcfe;break-inside:avoid}
figure .ftitle{font-weight:700;color:var(--navy);margin-bottom:5px}figure img{display:block;max-width:100%;max-height:150mm;height:auto;border:1px solid var(--line);margin:0 0 6px;background:#fff}
figure .nop{padding:10px;border:1px dashed var(--line);color:var(--muted);font-size:11px;margin-bottom:6px}figcaption{font-size:11px;overflow-wrap:anywhere}figcaption div{margin:1px 0}
a{color:var(--blue)}.doc-foot{display:flex;align-items:center;gap:10px;margin-top:22px;border-top:1px solid var(--line);padding-top:9px;color:var(--muted);font-size:10.5px}
.doc-foot img{height:34px;border-radius:3px}
@media print{body{background:#fff}.sheet{margin:0;border:0;padding:0;max-width:none}a{color:inherit;text-decoration:none}}
`;

function cellHtml(c) {
  if (Array.isArray(c)) return c.map(cellHtml).join("");
  if (c && typeof c === "object") {
    let h = escapeHtml(c.text);
    if (c.href) { const href = c.rel ? c.href : safeHref(c.href); if (href) h = `<a href="${escapeHtml(href)}"${c.rel ? "" : ' target="_blank" rel="noopener noreferrer"'}>${h}</a>`; }
    const cls = [c.mono ? "mono" : "", c.cls || ""].filter(Boolean).join(" ");
    return cls ? `<span class="${cls}">${h}</span>` : h;
  }
  return escapeHtml(c ?? "");
}
/** Valor de varias líneas: un array de cadenas (no de fragmentos) se muestra línea a línea. */
const valueHtml = (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v.map(escapeHtml).join("<br>") : cellHtml(v));
const originTag = (o) => (o && ORIGIN[o] ? `<span class="o-tag o-${o}" title="${escapeHtml(ORIGIN[o].label)}">${o}</span>` : "");

function blockHtml(b, assets) {
  switch (b.t) {
    case "h3": return `<h3>${escapeHtml(b.text)}</h3>`;
    case "h4": return `<h4>${escapeHtml(b.text)}</h4>`;
    case "p": return `<p class="${[b.cls || "", b.pre ? "pre" : ""].filter(Boolean).join(" ")}">${b.origin ? `${originTag(b.origin)} ` : ""}${escapeHtml(b.text)}</p>`;
    case "list": return `<ul class="limits">${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
    case "legend": return `<div class="legend"><div><b>Procedencia de los datos</b></div>${Object.entries(ORIGIN).map(([k, o]) => `<div>${originTag(k)} <b>${escapeHtml(o.label)}:</b> ${escapeHtml(o.text)}</div>`).join("")}</div>`;
    case "kv": return `<table class="kv"><tbody>${b.rows.map((r) => `<tr><th>${escapeHtml(r.label)}</th><td>${valueHtml(r.value)}${r.basis ? `<span class="basis">Fundamento: ${escapeHtml(r.basis)}</span>` : ""}</td><td class="o">${originTag(r.origin)}</td></tr>`).join("")}</tbody></table>`;
    case "table": {
      if (!b.rows.length) return `<p class="muted">${escapeHtml(b.empty || "Sin datos.")}</p>`;
      const cols = b.columns.map((c) => `<col style="width:${(c.w * 100).toFixed(1)}%">`).join("");
      return `<table>${b.origin ? `<caption style="text-align:left;caption-side:top;padding:0 0 3px">${originTag(b.origin)}</caption>` : ""}<colgroup>${cols}</colgroup><thead><tr>${b.columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${valueHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    case "figure": {
      const src = b.preview ? assets.previews?.[b.code] : "";
      const img = src && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(src) ? `<img src="${src}" alt="Vista previa de ${escapeHtml(b.code)}">` : `<div class="nop">Sin vista previa incrustada. Consulte el archivo de evidencia.</div>`;
      return `<figure id="${escapeHtml(b.code)}"><div class="ftitle">${escapeHtml(b.title)}</div>${img}<figcaption>${b.lines.map((l) => `<div>${cellHtml(l)}</div>`).join("")}</figcaption></figure>`;
    }
    default: return "";
  }
}

const dataImage = (src) => (/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(String(src || "")) ? src : "");

/**
 * Representa un modelo de informe como documento HTML autónomo (sin scripts ni recursos externos).
 * `assets`: { institutionLogo, rastroLogo, previews:{[code]:dataUrl} } con imágenes incrustadas como data: URI.
 */
export function renderReportHtml(model, assets = {}) {
  const h = model.head;
  const sections = [];
  let current = null;
  for (const b of model.blocks) {
    if (b.t === "h2") { current = { id: b.id, title: b.text, body: [] }; sections.push(current); continue; }
    if (!current) { current = { id: "inicio", title: "", body: [] }; sections.push(current); }
    current.body.push(blockHtml(b, assets));
  }
  const crest = dataImage(assets.institutionLogo);
  const rastro = dataImage(assets.rastroLogo);
  const refLine = [h.proceedings ? `Diligencias ${h.proceedings}` : "", h.reference ? `Ref. ${h.reference}` : "", h.sessionId].filter(Boolean).join(" · ");
  const pageCss = `@page{size:A4;margin:17mm 13mm 18mm;@top-left{content:${cssString(h.unit || TOOL.name)};font:8pt Arial,Helvetica,sans-serif;color:#5a6f86}@top-right{content:${cssString(refLine)};font:8pt Arial,Helvetica,sans-serif;color:#5a6f86}@bottom-left{content:${cssString(`${h.toolLine} · ${h.subtitle}`)};font:8pt Arial,Helvetica,sans-serif;color:#5a6f86}@bottom-right{content:"Página " counter(page) " de " counter(pages);font:8pt Arial,Helvetica,sans-serif;color:#5a6f86}}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<meta name="generator" content="${escapeHtml(h.toolLine)}">
<title>${escapeHtml(h.subtitle)} · ${escapeHtml(h.proceedings || h.reference || h.sessionId || "sin referencia")}</title><style>${REPORT_CSS}${pageCss}</style></head><body><div class="sheet">
<header class="doc-head">${crest ? `<div class="crest"><img src="${crest}" alt="Escudo o logotipo de la unidad"></div>` : ""}<div class="org"><div class="unit">${escapeHtml(h.unit || "Unidad investigadora no consignada")}</div>${h.department ? `<div class="dept">${escapeHtml(h.department)}</div>` : ""}</div>
<div class="ref">${h.proceedings ? `<div><b>Diligencias:</b> ${escapeHtml(h.proceedings)}</div>` : ""}${h.reference ? `<div><b>Expediente:</b> ${escapeHtml(h.reference)}</div>` : ""}<div><b>Sesión:</b> ${escapeHtml(h.sessionId || "—")}</div><div>${escapeHtml(h.generated)}</div></div></header>
<h1 class="doc-title">${escapeHtml(h.title)}</h1><p class="doc-sub">${escapeHtml(h.subtitle)} · generado con ${escapeHtml(h.toolLine)}</p>
${sections.map((s) => `<section id="${escapeHtml(s.id)}">${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ""}${s.body.join("")}</section>`).join("")}
<footer class="doc-foot">${rastro ? `<img src="${rastro}" alt="RASTRO CAPTURE">` : ""}<span>Documento generado localmente por ${escapeHtml(h.toolLine)} — ${escapeHtml(TOOL.suite)} · Creado por ${escapeHtml(TOOL.author)}. Sin envío de datos a terceros.</span></footer>
</div></body></html>`;
}

/** Atajo: manifiesto → HTML. `mode`: "tecnico" (por defecto) | "resumido". */
export function reportHtml(manifest, { mode = "tecnico", assets = {} } = {}) {
  return renderReportHtml(buildReportModel(manifest, mode, { previewCodes: Object.keys(assets.previews || {}) }), assets);
}
