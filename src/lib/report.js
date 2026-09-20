// src/lib/report.js · manifiesto, informe HTML, CSV y texto de verificación del paquete de evidencias
// Funciones puras (sin acceso a red ni a APIs del navegador): se prueban en Node.
import { KIND_LABELS, formatLocal } from "./paths.js";

export const TOOL = { name: "RASTRO CAPTURE", version: "0.4.0" };
export const SCHEMA = "RASTRO-CAPTURE/2";

export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const safeHref = (url) => (/^https?:\/\//i.test(String(url || "")) ? String(url) : "");
const link = (url, label) => (safeHref(url) ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label || url)}</a>` : escapeHtml(label || url || ""));
const relPath = (p) => String(p || "").split("/").map(encodeURIComponent).join("/");
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n || 0} B`);
const num = (v) => (v === null || v === undefined ? "" : String(v));

// ------------------------------------------------------------------- CSV
/** CSV con BOM UTF-8 y «;» (Excel en español). Neutraliza inyección de fórmulas (=, +, -, @) en contenido de terceros. */
export function toCsv(columns, rows) {
  const cell = (value) => {
    let s = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\ufeff${[columns.map((c) => cell(c.label)).join(";"), ...rows.map((row) => columns.map((c) => cell(c.get(row))).join(";"))].join("\r\n")}\r\n`;
}

export function inventoryCsv(evidence) {
  return toCsv([
    { label: "Código", get: (e) => e.code }, { label: "Tipo", get: (e) => KIND_LABELS[e.kind] || e.type }, { label: "Archivo", get: (e) => e.path },
    { label: "SHA-256", get: (e) => e.sha256 }, { label: "Bytes", get: (e) => e.size }, { label: "MIME", get: (e) => e.mime },
    { label: "Fecha UTC", get: (e) => e.createdAt }, { label: "Fecha local", get: (e) => e.createdLocal },
    { label: "Plataforma", get: (e) => e.source?.platform }, { label: "Usuario", get: (e) => e.source?.username },
    { label: "URL origen", get: (e) => e.source?.url }, { label: "URL del recurso", get: (e) => e.details?.mediaUrl }, { label: "Verificado en exportación", get: (e) => (e.integrityVerified ? "sí" : "NO") },
    { label: "Nota", get: (e) => e.note }
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
    { label: "Fecha UTC", get: (l) => l.at }, { label: "Acción", get: (l) => l.action }, { label: "Detalle", get: (l) => l.detail || "" },
    { label: "URL", get: (l) => l.url || "" }, { label: "Evidencia", get: (l) => l.code || "" }
  ], log);
}

// ------------------------------------------------------------------- Manifiesto
export function buildManifest({ caseData = {}, environment = {}, evidence = [], catalog = { accounts: [], posts: [] }, log = [], generatedAt = new Date().toISOString() }) {
  const offset = environment.utcOffsetMinutes;
  const byKind = {};
  for (const e of evidence) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  const items = evidence.map((e) => ({
    code: e.code, sequence: e.seq, id: e.id, kind: e.kind, type: KIND_LABELS[e.kind] || e.type, filename: e.filename, path: e.zipPath,
    mime: e.mime, size: e.size, sha256: e.sha256, createdAt: e.createdAt, createdLocal: formatLocal(e.createdAt, e.utcOffsetMinutes ?? offset),
    note: e.note || "", integrityVerified: e.integrityVerified === true, source: e.source || null, details: e.details || {}
  }));
  const targets = [...new Set(items.map((i) => i.source?.canonicalUrl || i.source?.url).filter(Boolean))];
  return {
    schema: SCHEMA, tool: TOOL, generatedAt, generatedLocal: formatLocal(generatedAt, offset),
    case: { reference: caseData.reference || "", name: caseData.name || "", investigator: caseData.investigator || "", unit: caseData.unit || "" },
    environment,
    summary: { evidenceCount: items.length, byKind, totalBytes: items.reduce((n, i) => n + (i.size || 0), 0), platforms: [...new Set(items.map((i) => i.source?.platform).filter(Boolean))], targets },
    evidence: items,
    catalog: { accounts: catalog.accounts || [], posts: (catalog.posts || []).map(({ rawIndexes, ...rest }) => rest) },
    activityLog: log
  };
}

// ------------------------------------------------------------------- Verificación
export function verificationText(manifest, sumsName = "SHA256SUMS.txt") {
  return `RASTRO CAPTURE ${manifest.tool.version} · Instrucciones de verificación de integridad
Referencia: ${manifest.case.reference || "(sin referencia)"}
Generado: ${manifest.generatedAt} (UTC)

Este paquete contiene ${manifest.summary.evidenceCount} evidencias y ficheros de contexto. ${sumsName} enumera el SHA-256 de cada fichero
del paquete (salvo el propio ${sumsName}). Antes de exportar, la herramienta recalcula el SHA-256 de cada evidencia y lo compara con el
registrado en el momento de la captura; el resultado figura en MANIFEST.json (integrityVerified) y en el informe.

Comprobación
  Linux / macOS (en la carpeta donde se extrajo el ZIP):   sha256sum -c ${sumsName}      (macOS: shasum -a 256 -c ${sumsName})
  Windows PowerShell (un fichero):                         Get-FileHash -Algorithm SHA256 .\\capturas\\EV-0001_....png
  Windows CMD (un fichero):                                certutil -hashfile capturas\\EV-0001_....png SHA256

Contenido
  INFORME.html            Informe legible e imprimible (Ctrl+P → Guardar como PDF).
  MANIFEST.json           Metadatos completos, entorno de captura, catálogo de publicaciones y registro de actividad.
  evidencias.csv          Inventario de archivos con hash, fechas y URL de origen.
  publicaciones.csv       Publicaciones detectadas (texto, fecha, métricas, hashtags, archivos guardados).
  registro-actividad.csv  Registro cronológico de las acciones realizadas con la herramienta.
  capturas/ paginas-mhtml/ medios/ grabaciones/ datos-origen/   Evidencias originales sin modificar.

Notas
  - Los CSV usan «;» como separador y codificación UTF-8 con BOM (se abren correctamente en Excel en español).
  - Las fechas UTC son las del reloj del equipo del investigador. El hash acredita que el archivo no ha cambiado desde su
    captura; no aporta por sí solo sellado de tiempo cualificado ni sustituye los procedimientos de preservación aplicables.
  - Las métricas y textos son los mostrados por la plataforma en el momento de la captura.
`;
}

// ------------------------------------------------------------------- Informe HTML
const CSS = `
:root{--navy:#071a2e;--blue:#0a6fa3;--line:#c5d3de;--muted:#5b7286}
*{box-sizing:border-box}body{margin:0;background:#eef3f7;color:#10243a;font:14px/1.5 "Segoe UI",Roboto,Arial,sans-serif}
header.cover{background:var(--navy);color:#fff;padding:30px 36px}header.cover h1{margin:0 0 4px;font-size:26px;letter-spacing:.03em}header.cover p{margin:0;color:#a9c4d8}
main{max-width:1080px;margin:0 auto;padding:22px}section{background:#fff;border:1px solid var(--line);border-radius:6px;padding:20px 22px;margin:0 0 20px}
h2{margin:0 0 12px;font-size:19px;color:var(--navy);border-bottom:2px solid var(--blue);padding-bottom:6px}h3{margin:20px 0 8px;font-size:15px}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e6eef5;width:190px}
table.grid th{width:auto}.mono{font-family:Consolas,"Courier New",monospace;font-size:11.5px}.muted{color:var(--muted)}.ok{color:#0b7a4b;font-weight:700}.bad{color:#b3202f;font-weight:700}
nav.toc a{display:block;padding:2px 0;color:var(--blue);text-decoration:none}nav.toc a:hover{text-decoration:underline}
figure{margin:14px 0;padding:12px;border:1px solid var(--line);border-radius:4px;background:#fafcfd;break-inside:avoid}figure img.shot{display:block;max-width:100%;height:auto;max-height:1500px;object-fit:contain;object-position:top;border:1px solid var(--line)}
figcaption{margin-top:8px;font-size:12px}.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:4px;padding:8px;background:#fafcfd;break-inside:avoid;font-size:11.5px}.card img,.card video{width:100%;height:190px;object-fit:cover;background:#dfe8ef;display:block;margin-bottom:6px}
.tag{display:inline-block;background:#e0eef8;border:1px solid #b6d3e8;border-radius:10px;padding:0 8px;margin:1px 2px 1px 0;font-size:11.5px}.tech{margin-top:6px;font-size:11.5px;color:var(--muted)}
footer{text-align:center;color:var(--muted);padding:20px;font-size:12px}
@page{size:A4;margin:14mm}@media print{body{background:#fff}section{border:0;padding:0}header.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}figure img.shot{max-height:235mm}a{color:inherit;text-decoration:none}.card video{display:none}}
`;

const row = (label, value) => (value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length) ? "" : `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`);
const tags = (list, prefix = "") => (list || []).map((t) => `<span class="tag">${escapeHtml(prefix + t)}</span>`).join(" ");

function metricsText(m = {}) {
  const parts = [["Me gusta", m.likes], ["Comentarios", m.comments], ["Reproducciones", m.views], ["Compartidos", m.shares], ["Guardados", m.saves]].filter(([, v]) => v !== null && v !== undefined && v !== "");
  return parts.map(([k, v]) => `${k}: ${escapeHtml(v)}`).join(" · ");
}

function techList(e) {
  const d = e.details || {};
  const items = [];
  const push = (k, v) => { if (v !== undefined && v !== null && v !== "" && v !== false) items.push(`${k}: ${escapeHtml(typeof v === "object" ? JSON.stringify(v) : v)}`); };
  push("URL del recurso", d.mediaUrl); push("URL final tras redirecciones", d.http?.finalUrl !== d.mediaUrl ? d.http?.finalUrl : "");
  push("Dimensiones", d.width && d.height ? `${d.width}×${d.height}` : ""); push("Posición", d.mediaIndex ? `elemento ${d.mediaIndex}` : ""); push("Caducidad del enlace", d.expiresAt);
  push("Content-Type recibido", d.http?.contentType); push("Last-Modified", d.http?.lastModified); push("Date (servidor)", d.http?.serverDate); push("ETag", d.http?.etag);
  push("Región capturada", d.region); push("Tamaño (px)", d.pixelWidth && d.pixelHeight ? `${d.pixelWidth}×${d.pixelHeight}` : ""); push("Tramos", d.frames); push("Parte", d.part ? `${d.part}/${d.parts}` : "");
  push("Elementos fijos ocultados", d.fixedHidden); push("Contenedor de scroll", d.scrollMode); push("URL al iniciar", d.startUrl); push("URL al terminar", d.endUrl !== d.startUrl ? d.endUrl : "");
  push("Inicio", d.startedAt); push("Fin", d.endedAt); push("Duración (s)", d.durationSeconds); push("Audio", d.hasAudio === undefined ? "" : d.hasAudio ? "sí" : "no");
  push("Ruta de descarga", d.downloadPath); push("Origen de los datos", d.origin); push("Página donde se localizó", d.discoveredOn);
  return items.length ? `<div class="tech">${items.join("<br>")}</div>` : "";
}

function evidenceBlock(e) {
  const meta = `<b>${escapeHtml(e.code)}</b> · ${escapeHtml(e.type)} · ${escapeHtml(e.createdAt)} UTC${e.createdLocal ? ` (${escapeHtml(e.createdLocal)})` : ""}<br>` +
    `Archivo: <a href="${relPath(e.path)}">${escapeHtml(e.path)}</a> · ${fmtBytes(e.size)}<br>SHA-256: <span class="mono">${escapeHtml(e.sha256)}</span> ` +
    `<span class="${e.integrityVerified ? "ok" : "bad"}">${e.integrityVerified ? "✔ verificado al exportar" : "✘ NO verificado"}</span>` +
    (e.note ? `<br>Nota del investigador: ${escapeHtml(e.note)}` : "") + techList(e);
  if (e.kind.startsWith("screenshot")) return `<figure><img class="shot" src="${relPath(e.path)}" alt="${escapeHtml(e.code)}"><figcaption>${meta}</figcaption></figure>`;
  return `<div class="card">${meta}</div>`;
}

function mediaCard(e) {
  const meta = `<b>${escapeHtml(e.code)}</b> · ${escapeHtml(e.type)}${e.details?.mediaIndex ? ` (${e.details.mediaIndex})` : ""}<br><span class="mono">${escapeHtml(String(e.sha256).slice(0, 24))}…</span> ${e.integrityVerified ? '<span class="ok">✔</span>' : '<span class="bad">✘</span>'}<br>` +
    `<a href="${relPath(e.path)}">${escapeHtml(e.filename)}</a> · ${fmtBytes(e.size)}${techList(e)}`;
  const visual = e.kind === "media-image" ? `<img src="${relPath(e.path)}" alt="${escapeHtml(e.code)}">` : `<video controls preload="metadata" src="${relPath(e.path)}"></video>`;
  return `<div class="card">${visual}${meta}</div>`;
}

function targetSection(key, items, index, catalogAccounts) {
  const first = items[0];
  const s = items.find((i) => i.source?.post)?.source || first.source || {};
  const post = s.post;
  const account = s.account || catalogAccounts.find((a) => a.platform === s.platform && a.username?.toLowerCase() === String(s.username || "").toLowerCase());
  const head = [s.platform, s.contentType, s.username ? `@${s.username}` : "", s.contentId].filter(Boolean).join(" · ");
  const shots = items.filter((i) => i.kind.startsWith("screenshot"));
  const media = items.filter((i) => i.kind === "media-image" || i.kind === "media-video");
  const others = items.filter((i) => !i.kind.startsWith("screenshot") && !i.kind.startsWith("media"));
  const times = items.map((i) => i.createdAt).sort();
  return `<section id="objetivo-${index}"><h2>${index}. ${escapeHtml(head || "Página web")}</h2>
  <table>${row("URL", link(s.url || key))}${row("URL canónica", s.canonicalUrl && s.canonicalUrl !== s.url ? link(s.canonicalUrl) : "")}${row("Título de la página", escapeHtml(s.title))}
  ${row("Fecha de publicación (según la plataforma)", escapeHtml(post?.takenAt || s.publishedAt))}${row("Texto / descripción", escapeHtml(post?.caption || s.description))}
  ${row("Hashtags", tags(post?.hashtags, "#"))}${row("Menciones", tags(post?.mentions, "@"))}${row("Usuarios etiquetados", tags(post?.taggedUsers, "@"))}
  ${row("Ubicación", escapeHtml(post?.location))}${row("Música / sonido", escapeHtml(post?.music))}${row("Métricas visibles", metricsText(post?.metrics))}
  ${row("Primera / última captura (UTC)", `${escapeHtml(times[0])} / ${escapeHtml(times[times.length - 1])}`)}</table>
  ${account ? `<h3>Cuenta</h3><table>${row("Usuario", escapeHtml(`@${account.username}`))}${row("Nombre", escapeHtml(account.name))}${row("Identificador", escapeHtml(account.id))}${row("Verificada", account.verified ? "sí" : "")}${row("Privada", account.isPrivate ? "sí" : "")}
  ${row("Biografía", escapeHtml(account.bio))}${row("Seguidores", escapeHtml(num(account.followers)))}${row("Siguiendo", escapeHtml(num(account.following)))}${row("Publicaciones", escapeHtml(num(account.postsCount)))}${row("Enlace externo", account.externalUrl ? link(account.externalUrl) : "")}${row("Foto de perfil (URL)", account.avatarUrl ? link(account.avatarUrl) : "")}</table>` : ""}
  ${shots.length ? `<h3>Capturas de pantalla</h3>${shots.map(evidenceBlock).join("")}` : ""}
  ${media.length ? `<h3>Imágenes y vídeos (${media.length})</h3><div class="gallery">${media.map(mediaCard).join("")}</div>` : ""}
  ${others.length ? `<h3>Otros archivos</h3><div class="gallery">${others.map(evidenceBlock).join("")}</div>` : ""}</section>`;
}

export function reportHtml(manifest) {
  const evidence = manifest.evidence;
  const groups = new Map();
  for (const e of evidence) {
    const key = e.source?.canonicalUrl || e.source?.url || "sin-origen";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const entries = [...groups.entries()];
  const filesByPost = {};
  for (const e of evidence) if (e.details?.postKey) (filesByPost[e.details.postKey] ||= []).push(e.code);
  const posts = manifest.catalog.posts;
  const kinds = Object.entries(manifest.summary.byKind).map(([k, n]) => `<tr><td>${escapeHtml(KIND_LABELS[k] || k)}</td><td>${n}</td></tr>`).join("");
  const allVerified = evidence.every((e) => e.integrityVerified);
  const env = manifest.environment || {};
  const label = (items, key) => [items[0].source?.platform, items[0].source?.contentType, items[0].source?.username ? `@${items[0].source.username}` : ""].filter(Boolean).join(" · ") || key;
  const toc = [`<a href="#resumen">Resumen</a>`, ...entries.map(([key, items], i) => `<a href="#objetivo-${i + 1}">${i + 1}. ${escapeHtml(label(items, key))}</a>`),
    ...(posts.length ? [`<a href="#publicaciones">Publicaciones detectadas (${posts.length})</a>`] : []), `<a href="#custodia">Registro de actividad</a>`, `<a href="#inventario">Inventario y huellas SHA-256</a>`, `<a href="#verificacion">Verificación y limitaciones</a>`].join("");

  const postRows = posts.map((p, i) => `<tr><td>${i + 1}</td><td>${link(p.url, p.code || p.id)}</td><td>${escapeHtml(p.type)}</td><td>${escapeHtml(p.takenAt)}</td><td>${escapeHtml((p.caption || "").slice(0, 220))}${(p.caption || "").length > 220 ? "…" : ""}</td><td>${metricsText(p.metrics)}</td><td>${(p.media || []).filter((m) => m.role !== "cover" && m.url).length}</td><td>${(filesByPost[`${p.platform}:${p.id}`] || []).map(escapeHtml).join(", ")}</td></tr>`).join("");
  const logRows = manifest.activityLog.map((l) => `<tr><td class="mono">${escapeHtml(l.at)}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.detail || "")}</td><td>${escapeHtml(l.code || "")}</td></tr>`).join("");
  const inv = evidence.map((e) => `<tr><td>${escapeHtml(e.code)}</td><td>${escapeHtml(e.path)}</td><td>${fmtBytes(e.size)}</td><td class="mono">${escapeHtml(e.sha256)}</td><td class="${e.integrityVerified ? "ok" : "bad"}">${e.integrityVerified ? "✔" : "✘"}</td></tr>`).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file: data:; media-src 'self' file:; style-src 'unsafe-inline'">
<title>Informe de capturas · ${escapeHtml(manifest.case.reference || "sin referencia")}</title><style>${CSS}</style></head><body>
<header class="cover"><h1>RASTRO CAPTURE</h1><p>Informe de preservación de contenido web y redes sociales</p></header><main>
<section id="resumen"><h2>Resumen</h2><table>
${row("Referencia", escapeHtml(manifest.case.reference || "Sin referencia"))}${row("Investigación", escapeHtml(manifest.case.name))}${row("Investigador", escapeHtml(manifest.case.investigator))}${row("Unidad", escapeHtml(manifest.case.unit))}
${row("Informe generado", `${escapeHtml(manifest.generatedAt)} UTC (${escapeHtml(manifest.generatedLocal)})`)}${row("Herramienta", escapeHtml(`${manifest.tool.name} ${manifest.tool.version}`))}
${row("Navegador", escapeHtml(env.userAgent))}${row("Zona horaria / idioma", escapeHtml([env.timezone, env.language].filter(Boolean).join(" · ")))}${row("Archivos / tamaño", `${manifest.summary.evidenceCount} / ${fmtBytes(manifest.summary.totalBytes)}`)}
${row("Plataformas", escapeHtml(manifest.summary.platforms.join(", ")))}${row("Objetivos documentados", String(entries.length))}${row("Integridad al exportar", allVerified ? '<span class="ok">✔ todos los archivos coinciden con su huella de captura</span>' : '<span class="bad">✘ hay archivos cuya huella no coincide (ver inventario)</span>')}</table>
<h3>Contenido del expediente</h3><table class="grid"><tr><th>Tipo</th><th>Cantidad</th></tr>${kinds}</table><h3>Índice</h3><nav class="toc">${toc}</nav></section>
${entries.map(([key, items], i) => targetSection(key, items, i + 1, manifest.catalog.accounts)).join("")}
${posts.length ? `<section id="publicaciones"><h2>Publicaciones detectadas</h2><p class="muted">Datos tal como los devolvió la plataforma al navegador del investigador. Detalle completo en publicaciones.csv.</p><table class="grid"><tr><th>#</th><th>Publicación</th><th>Tipo</th><th>Fecha (UTC)</th><th>Texto</th><th>Métricas</th><th>Medios</th><th>Archivos</th></tr>${postRows}</table></section>` : ""}
<section id="custodia"><h2>Registro de actividad</h2><table class="grid"><tr><th>Fecha UTC</th><th>Acción</th><th>Detalle</th><th>Evidencia</th></tr>${logRows}</table></section>
<section id="inventario"><h2>Inventario y huellas SHA-256</h2><table class="grid"><tr><th>Código</th><th>Archivo</th><th>Tamaño</th><th>SHA-256</th><th>Verif.</th></tr>${inv}</table><p class="muted">El listado de huellas de todos los ficheros del paquete está en SHA256SUMS.txt.</p></section>
<section id="verificacion"><h2>Verificación y limitaciones</h2>
<p>Las evidencias se conservan sin modificar. El SHA-256 permite comprobar que un archivo no ha cambiado desde su captura (ver LEEME-VERIFICACION.txt). La herramienta actúa únicamente sobre lo que el navegador del investigador puede mostrar, no elude autenticación ni controles de acceso, y no aporta sellado de tiempo cualificado: las fechas proceden del reloj del equipo.</p>
<p>Las capturas de pantalla completas se componen desplazando la página; cuando se indica «elementos fijos ocultados» se ocultaron barras o avisos superpuestos para no repetirlos en cada tramo. Métricas y textos son los que mostraba la plataforma en el momento de la captura.</p></section>
</main><footer>Generado localmente por ${escapeHtml(manifest.tool.name)} ${escapeHtml(manifest.tool.version)} · Sin telemetría</footer></body></html>`;
}
