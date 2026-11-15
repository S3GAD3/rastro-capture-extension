// RASTRO CAPTURE · panel lateral
// Orquesta el análisis, las capturas, las descargas, la gestión de la sesión y la exportación.
// Las operaciones sobre la pestaña se delegan en el service worker; todo el procesamiento es local.
import { sha256Blob, sha256Hex } from "./src/lib/sha256.js";
import { fetchMedia } from "./src/lib/mediaFetch.js";
import * as store from "./src/lib/store.js";
import { KIND_LABELS, FILE_CLASS_LABELS, kindInfo, safeName, formatBytes, formatLocal } from "./src/lib/paths.js";
import { escapeHtml, TOOL } from "./src/lib/report.js";
import * as ctx from "./src/panel/context.js";
import { collectSession, buildPackage } from "./src/panel/packager.js";

const N = globalThis.RastroNormalize;
const $ = (selector) => document.querySelector(selector);
const els = Object.fromEntries(["status", "statusText", "caseRef", "caseProceedings", "caseName", "caseObservations", "caseInvestigator", "caseUnit", "instDepartment", "instPlace", "instKeepLogo", "captureNote", "platformBadge", "analysis", "mediaList", "mediaCount", "evidenceList", "evidenceCount", "evidenceBytes", "exportPackage", "goExport", "openRecorder", "progress", "progressFill", "progressText", "cancelTask", "postList", "postCount", "postActions", "selectedCount", "downloadAllMedia", "batchReport", "optHideFixed", "optCopyDownloads", "optBatchMedia", "optIncludePdf", "optZipHash", "loadMax", "sessionId", "sessionEvidenceCount", "sessionWarning", "checkIntegrity", "openVerifier", "integritySummary", "viewTechnical", "viewSummary", "exportResult", "logoPreview", "logoFile", "logoChoose", "logoRemove", "logoInfo", "cfgEvidence", "cfgUsage", "cfgLog", "cfgAllSites", "cfgRevokeSites", "cfgVersion", "footVersion"].map((id) => [id, $(`#${id}`)]));

const params = new URLSearchParams(location.search);
const FIXED_TAB_ID = params.get("tabId") && Number.isInteger(Number(params.get("tabId"))) ? Number(params.get("tabId")) : null;

let lastAnalysis = null;
let busy = false;
let targetTab = null;
let cancelRequested = false;
const catalog = { posts: new Map(), accounts: new Map() };
const selected = new Set();
let downloadedPostKeys = new Set();
let analysisSaved = { hash: "", code: "" };
let session = null;
let institutionLogo = "";
const integrityState = new Map(); // id de evidencia -> "ok" | "bad" | "missing" (última comprobación local)

class Cancelled extends Error { constructor() { super("Operación cancelada por el usuario."); this.name = "Cancelled"; } }
/** Aviso de uso (falta una selección, no hay nada que exportar…): se muestra pero no consta como incidencia. */
class Notice extends Error { constructor(message) { super(message); this.name = "Notice"; } }
const checkCancel = () => { if (cancelRequested) throw new Cancelled(); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ Mensajería y estado
async function send(type, extra = {}, timeout = 25000) {
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type, ...(targetTab?.id ? { tabId: targetTab.id } : {}), ...extra }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`La operación ${type} no respondió en ${timeout / 1000} segundos.`)), timeout))
  ]);
  if (!response?.ok) throw new Error(response?.error || "La extensión no ha podido completar la operación.");
  return response.result;
}

async function refreshTargetTab() {
  const tab = FIXED_TAB_ID !== null ? await chrome.tabs.get(FIXED_TAB_ID) : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) throw new Error("Abre una página web (Instagram, TikTok u otra) antes de usar RASTRO CAPTURE.");
  targetTab = tab;
  return tab;
}

function setStatus(kind, message) {
  els.status.className = `status status-${kind}`;
  els.status.querySelector("strong").textContent = kind === "busy" ? "PROCESANDO" : kind === "error" ? "ERROR" : "LISTO";
  els.statusText.textContent = message;
}
function setProgress(fraction, text) {
  els.progress.hidden = fraction === null;
  if (fraction === null) return;
  els.progressFill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  els.progressText.textContent = text || "";
}

function friendlyError(error) {
  if (error?.name === "Cancelled") return "Operación cancelada. Lo ya guardado permanece en el expediente.";
  const m = error?.message || String(error);
  if (/<all_urls>/i.test(m)) return "Concede el permiso «acceder a todos los sitios» cuando el navegador lo pregunte y repite la acción.";
  if (/Cannot access|host permission|extension manifest must request/i.test(m)) return "La extensión no tiene permiso sobre esta página. Pulsa de nuevo el botón; el navegador pedirá acceso a este sitio.";
  if (/cannot be captured|not capturable|chrome:\/\//i.test(m)) return "Esta pestaña no puede capturarse. Abre una página web normal.";
  if (/activeTab|invoked/i.test(m)) return "Chromium no ha autorizado la captura. Cierra y vuelve a abrir RASTRO desde su icono en esta pestaña.";
  return m;
}

const settings = { hideFixed: true, copyDownloads: true, loadMax: 60, batchMedia: true, includePdf: true, zipHash: true };
async function loadSettings() {
  const { rastroSettings } = await chrome.storage.local.get("rastroSettings");
  Object.assign(settings, rastroSettings || {});
  els.optHideFixed.checked = settings.hideFixed; els.optCopyDownloads.checked = settings.copyDownloads; els.optBatchMedia.checked = settings.batchMedia; els.loadMax.value = settings.loadMax;
  els.optIncludePdf.checked = settings.includePdf !== false; els.optZipHash.checked = settings.zipHash !== false;
}
async function saveSettings() {
  settings.hideFixed = els.optHideFixed.checked; settings.copyDownloads = els.optCopyDownloads.checked; settings.batchMedia = els.optBatchMedia.checked; settings.loadMax = Number(els.loadMax.value) || 60;
  settings.includePdf = els.optIncludePdf.checked; settings.zipHash = els.optZipHash.checked;
  await chrome.storage.local.set({ rastroSettings: settings });
}

// Datos del expediente (solo esta sesión) y perfil institucional (reutilizable). Ver src/panel/context.js.
function caseData() {
  return { reference: els.caseRef.value.trim(), proceedings: els.caseProceedings.value.trim(), name: els.caseName.value.trim(), observations: els.caseObservations.value.trim(), investigator: els.caseInvestigator.value.trim(), unit: els.caseUnit.value.trim() };
}
function institutionData() {
  return { unit: els.caseUnit.value.trim(), department: els.instDepartment.value.trim(), investigatorId: els.caseInvestigator.value.trim(), place: els.instPlace.value.trim(), keepLogo: els.instKeepLogo.checked };
}
async function saveCase() { await ctx.saveCase(caseData()); }
async function saveInstitution() { await ctx.saveInstitution(institutionData()); }
async function loadCase() {
  const c = await ctx.loadCase();
  els.caseRef.value = c.reference; els.caseProceedings.value = c.proceedings; els.caseName.value = c.name; els.caseObservations.value = c.observations;
}
async function loadInstitution() {
  const inst = await ctx.loadInstitution();
  els.caseUnit.value = inst.unit; els.instDepartment.value = inst.department; els.caseInvestigator.value = inst.investigatorId; els.instPlace.value = inst.place; els.instKeepLogo.checked = inst.keepLogo;
  institutionLogo = await ctx.loadLogo();
  renderLogo();
}

/** Registro de actividad. `extra.level`: "info" (por defecto) | "warn" | "error" (las dos últimas figuran como incidencias). */
async function log(action, detail = "", extra = {}) {
  try { await store.addLog(action, { detail, url: targetTab?.url || "", ...extra }); } catch (error) { console.warn("log", error); }
}

// ------------------------------------------------------------------ Análisis
const mediaKey = (url) => { try { const u = new URL(url); const stp = u.searchParams.get("stp"); return u.origin + u.pathname + (stp ? `?stp=${stp}` : ""); } catch { return url; } };

function buildAnalysis(dom, harvest) {
  const posts = new Map();
  if (harvest) N.mergeInto(posts, harvest.posts, N.postKey, N.mergePost);
  N.mergeInto(posts, dom.ssr.posts, N.postKey, N.mergePost);
  const accounts = new Map();
  if (harvest) N.mergeInto(accounts, harvest.accounts, N.accountKey, N.mergeAccount);
  N.mergeInto(accounts, dom.ssr.accounts, N.accountKey, N.mergeAccount);
  const all = [...posts.values()];
  const cid = dom.contentId;
  const uname = (dom.username || "").toLowerCase();
  let relevant = [];
  if (["post", "reel", "video", "story"].includes(dom.pageKind)) relevant = all.filter((p) => [p.code, p.id, p.numericId].includes(cid));
  else if (dom.pageKind === "profile") relevant = all.filter((p) => !uname || (p.author?.username || "").toLowerCase() === uname);
  const byCode = new Map(relevant.map((p) => [p.code, p]));
  const ordered = [];
  for (const d of dom.domPosts) {
    const p = byCode.get(d.code);
    if (p) { ordered.push({ ...p, thumb: d.thumb }); byCode.delete(d.code); }
    else ordered.push({ platform: dom.platform, id: d.code, code: d.code, numericId: d.code, type: "unknown", url: d.url, takenAt: "", caption: d.alt, hashtags: [], mentions: [], taggedUsers: [], author: { username: dom.username }, metrics: {}, media: [], thumb: d.thumb, via: "dom", stub: true });
  }
  const rest = [...byCode.values()].sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt)));
  const postList = dom.pageKind === "profile" ? [...ordered, ...rest] : relevant;
  const primaryPost = ["post", "reel", "video", "story"].includes(dom.pageKind) ? relevant[0] || null : null;

  let account = null;
  const wanted = (primaryPost?.author?.username || dom.username || "").toLowerCase();
  for (const a of accounts.values()) if (a.username.toLowerCase() === wanted) account = N.mergeAccount(account, a);
  if (!account && primaryPost?.author?.username) account = { platform: dom.platform, username: primaryPost.author.username, id: primaryPost.author.id, name: primaryPost.author.name, verified: primaryPost.author.verified };
  if (account && Object.keys(dom.domAccount || {}).length) account = { ...account, displayed: dom.domAccount };
  else if (!account && dom.pageKind === "profile" && dom.username) account = { platform: dom.platform, username: dom.username, name: dom.displayName, bio: dom.domAccount?.bio || "", displayed: dom.domAccount, avatarUrl: dom.domAccount?.avatarUrl || "" };

  const analysis = { ...dom, ssr: { rawCount: dom.ssr.raw.length }, ssrRaw: dom.ssr.raw, account, posts: postList, primaryPost, harvest: harvest ? { counters: harvest.counters, lateInjection: harvest.lateInjection, startedAt: harvest.startedAt, rawIndex: harvest.rawIndex, postsSeen: harvest.posts.length } : null, domPostsCount: dom.domPosts.length };
  analysis.media = pageMedia(analysis);
  delete analysis.domPosts;
  analysis.warnings = [...dom.warnings];
  if (dom.platform !== "Web" && (!harvest || harvest.lateInjection) && !postList.some((p) => !p.stub) && !primaryPost) analysis.warnings.push("Sin datos de la plataforma: recarga la página (F5) con RASTRO instalado y vuelve a analizar para obtener imágenes y vídeos originales y todos los metadatos.");
  if (dom.pageKind === "profile" && postList.some((p) => p.stub)) analysis.warnings.push("Algunas publicaciones solo se conocen por su miniatura. Pulsa «Cargar» tras recargar la página, o usa «Abrir y capturar cada seleccionada» para obtener sus originales.");
  return analysis;
}

function pageMedia(a) {
  const items = [];
  const seen = new Set();
  const push = (m, extra = {}) => {
    if (!m.url && m.downloadable !== false) return;
    const key = m.url ? mediaKey(m.url) : `nodl-${items.length}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ downloadable: true, ...m, ...extra, key });
  };
  const post = a.primaryPost;
  if (post) {
    const pk = N.postKey(post);
    post.media.filter((m) => m.role === "full").forEach((m) => push(m, { origin: "api", postKey: pk }));
    post.media.filter((m) => m.role === "cover").forEach((m) => push(m, { origin: "api", postKey: pk }));
  }
  if (a.pageKind === "profile" && a.account?.avatarUrl) push({ kind: "image", role: "avatar", index: 1, url: a.account.avatarUrl }, { origin: "api" });
  let videoIndex = items.filter((i) => i.kind === "video").length;
  for (const v of a.domMedia.videos) {
    if (v.downloadable) push({ kind: "video", role: "full", index: ++videoIndex, url: v.url, rawUrl: v.rawUrl }, { origin: v.source, postKey: post ? N.postKey(post) : undefined });
    else items.push({ kind: "video", role: "full", index: ++videoIndex, url: v.url, downloadable: false, note: v.kind, key: `stream-${items.length}` });
  }
  const haveFull = items.some((i) => i.kind === "image" && i.role === "full");
  for (const img of a.domMedia.images) {
    if (haveFull && img.role !== "avatar") continue;
    if (a.pageKind === "profile" && img.role === "dom") continue;
    push({ kind: "image", role: img.role === "dom" ? "full" : img.role, index: items.filter((i) => i.kind === "image").length + 1, url: img.url, width: img.width, height: img.height, alt: img.alt }, { origin: "dom", postKey: post ? N.postKey(post) : undefined });
  }
  return items;
}

function relevantForCatalog(a) {
  for (const p of a.posts) if (!p.stub) catalog.posts.set(N.postKey(p), { ...p, thumb: undefined });
  if (a.account) catalog.accounts.set(`${a.account.platform}:${a.account.username.toLowerCase()}`, a.account);
}
async function persistCatalog() {
  await store.kvSet("catalog", { posts: [...catalog.posts.values()], accounts: [...catalog.accounts.values()] });
}

const compactPost = (p) => (p ? { ...p, thumb: undefined, rawIndexes: undefined } : null);
function sourceSnapshot(a, post = null) {
  const p = post || a.primaryPost;
  return {
    platform: a.platform, pageKind: a.pageKind, contentType: a.contentType, contentId: a.contentId, username: a.username || p?.author?.username || "", displayName: a.displayName,
    url: post?.url || a.url, canonicalUrl: post?.url || a.canonicalUrl, title: a.title, publishedAt: a.publishedAt, description: a.description,
    post: compactPost(p), account: a.account || null, analysisRef: analysisSaved.code || "", warnings: [...(a.warnings || [])]
  };
}

function analysisMarkup(a) {
  const acc = a.account;
  const warn = a.warnings.map((w) => `<div class="warning">${escapeHtml(w)}</div>`).join("");
  const post = a.primaryPost;
  const has = (v) => v !== null && v !== undefined;
  const cells = [
    ["Plataforma", a.platform, "I"], ["Tipo", a.contentType, "I"], ["Usuario", a.username || post?.author?.username || "No determinado", post?.author?.username || acc?.username ? "A" : a.username ? "I" : ""], ["ID", a.contentId || "No detectado", a.contentId ? (post ? "A" : "I") : ""],
    ...(post ? [["Fecha (plataforma)", post.takenAt || "—"], ["Métricas", [has(post.metrics.likes) ? `♥ ${post.metrics.likes}` : "", has(post.metrics.comments) ? `💬 ${post.metrics.comments}` : "", post.metrics.views ? `▶ ${post.metrics.views}` : ""].filter(Boolean).join("  ") || "—"]] : []),
    ...(acc && a.pageKind === "profile" ? [["Seguidores", acc.followers ?? acc.displayed?.followersText ?? "—"], ["Publicaciones", acc.postsCount ?? acc.displayed?.postsText ?? "—"]] : [])
  ].map(([k, v, origin]) => `<div class="datum"><span>${escapeHtml(k)}${origin ? `<i class="origin origin-${origin}" title="${origin === "I" ? "Dato inferido por la herramienta (patrón de la URL o nombre de host)" : "Dato obtenido automáticamente"}">${origin}</i>` : ""}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  const bio = acc?.bio ? `<div class="datum wide"><span>Biografía</span><p>${escapeHtml(acc.bio)}</p></div>` : "";
  const desc = post?.caption || a.description || a.visibleText;
  return `<div class="analysis-grid">${cells}<div class="datum wide"><span>URL</span><p>${escapeHtml(a.canonicalUrl)}</p></div>${bio}
    <div class="datum wide"><span>Descripción / texto</span><p>${escapeHtml(desc || "Sin texto extraído")}</p>${post?.hashtags?.length ? `<small>${escapeHtml(post.hashtags.map((h) => `#${h}`).join(" "))}</small>` : ""}</div>
    <div class="datum"><span>Medios</span><strong>${a.media.filter((m) => m.downloadable).length}</strong></div><div class="datum"><span>Publicaciones</span><strong>${a.posts.length}</strong></div></div>${warn}`;
}

async function ensureTabAccess() {
  try { return await send("ANALYZE"); }
  catch (error) {
    if (!/Cannot access|permission|host/i.test(error.message)) throw error;
    const origin = `${new URL(targetTab.url).origin}/*`;
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) throw new Error("No se concedió acceso a este sitio web.");
    return send("ANALYZE");
  }
}

async function analyze({ quiet = false } = {}) {
  await refreshTargetTab();
  if (!quiet) setStatus("busy", "Analizando la página y sus recursos…");
  const { dom, harvest } = await ensureTabAccess();
  const a = buildAnalysis(dom, harvest);
  lastAnalysis = a;
  relevantForCatalog(a);
  els.platformBadge.textContent = a.platform.toUpperCase();
  els.analysis.className = "analysis";
  els.analysis.innerHTML = analysisMarkup(a);
  renderPosts(a);
  renderMedia(a);
  await persistCatalog();
  if (!quiet) { setStatus("ready", `${a.platform}: ${a.contentType}. ${a.media.filter((m) => m.downloadable).length} medios, ${a.posts.length} publicaciones.`); await log("Análisis", `${a.platform} ${a.contentType} ${a.contentId || a.username || ""}`); }
  return a;
}

// ------------------------------------------------------------------ Guardado de evidencias
async function makeThumb(blob) {
  if (!blob.type.startsWith("image/") || blob.size > 30 * 1024 * 1024) return "";
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = 96 / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * Math.min(1, scale))); canvas.height = Math.max(1, Math.round(bitmap.height * Math.min(1, scale)));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch { return ""; }
}

async function downloadCopy(record, blob) {
  const folder = safeName(caseData().reference || "SIN-REFERENCIA", "SIN-REFERENCIA", 60);
  const objectUrl = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url: objectUrl, filename: `RASTRO-CAPTURE/${folder}/${record.zipPath}`, conflictAction: "uniquify", saveAs: false });
    const [item] = await chrome.downloads.search({ id });
    return item?.filename || `Descargas/RASTRO-CAPTURE/${folder}/${record.zipPath}`;
  } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 180_000); }
}

async function saveEvidence({ kind, blob, slug, extension, source, details = {}, note = true, copy = settings.copyDownloads }) {
  const sha256 = await sha256Blob(blob);
  const thumb = kind === "media-image" || kind.startsWith("screenshot") ? await makeThumb(blob) : "";
  const record = await store.addEvidence({
    kind, slug, extension, sha256, type: KIND_LABELS[kind], utcOffsetMinutes: -new Date().getTimezoneOffset(),
    note: note ? els.captureNote.value.trim() : "", case: caseData(), source: source || null, details, thumb
  }, blob);
  if (copy) {
    try { const downloadPath = await downloadCopy(record, blob); await store.updateEvidence(record.id, { details: { downloadPath } }); record.details = { ...record.details, downloadPath }; }
    catch (error) { console.warn("Descarga a disco:", error); await store.updateEvidence(record.id, { details: { downloadPath: `No se pudo crear la copia en Descargas (${error.message})` } }); await log("Aviso: copia en Descargas no creada", `${record.code}: ${error.message}`, { level: "warn", code: record.code }); }
  }
  if (note) els.captureNote.value = "";
  await log(KIND_LABELS[kind], record.filename, { code: record.code });
  await renderEvidence();
  return record;
}

async function ensureAnalysisEvidence(a) {
  const json = JSON.stringify({ ...a, ssrRaw: undefined }, null, 2);
  const hash = await sha256Hex(json);
  if (analysisSaved.hash === hash) return analysisSaved.code;
  const record = await saveEvidence({ kind: "analysis", blob: new Blob([json], { type: "application/json" }), slug: `${a.platform}_${a.username || "web"}_${a.contentId || a.pageKind}_analisis`, extension: ".json", source: sourceSnapshot(a), details: { origin: "extractor" }, note: false, copy: false });
  analysisSaved = { hash, code: record.code };
  return record.code;
}

const slugFor = (a, suffix) => [a.platform, a.username || new URL(a.url).hostname, a.contentId, suffix].filter(Boolean).join("_");

// ------------------------------------------------------------------ Capturas de pantalla
function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] || "image/png" });
}
const loadImage = (dataUrl) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("No se pudo procesar un fotograma de la captura.")); img.src = dataUrl; });
const canvasBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo crear la imagen."))), "image/png"));
const samePage = (a, b) => { try { const x = new URL(a), y = new URL(b); return x.origin === y.origin && x.pathname === y.pathname; } catch { return a === b; } };

// captureVisibleTab exige activeTab (se pierde al navegar o cambiar de pestaña) o acceso a todos los sitios.
async function ensureAllSites() {
  if (await chrome.permissions.contains({ origins: ["<all_urls>"] })) return true;
  return chrome.permissions.request({ origins: ["<all_urls>"] });
}
async function captureFrame() {
  try { return await send("CAPTURE_FRAME"); }
  catch (error) {
    if (!/<all_urls>|activeTab/i.test(error.message)) throw error;
    if (!(await ensureAllSites())) throw new Error("Para capturar la pantalla en esta pestaña concede el permiso «acceder a todos los sitios» cuando el navegador lo pregunte y repite la acción.");
    return send("CAPTURE_FRAME");
  }
}

async function captureVisible() {
  const a = await analyze({ quiet: true });
  await ensureAnalysisEvidence(a);
  setStatus("busy", "Capturando la vista visible…");
  const frame = await captureFrame();
  const blob = dataUrlToBlob(frame.dataUrl);
  if (!blob.size) throw new Error("La captura visible está vacía.");
  const img = await loadImage(frame.dataUrl);
  await saveEvidence({ kind: "screenshot-visible", blob, slug: slugFor(a, "visible"), extension: ".png", source: sourceSnapshot(a), details: { startUrl: a.url, endUrl: frame.url, pixelWidth: img.width, pixelHeight: img.height, viewport: a.environment.viewport, devicePixelRatio: a.environment.devicePixelRatio } });
}

const MAX_PART_PX = 14000;
async function stitchedCapture(mode) {
  const a = await analyze({ quiet: true });
  await ensureAnalysisEvidence(a);
  const info = await send("SCROLLER");
  const tgt = mode === "target" ? await send("TARGET_GEOMETRY") : null;
  if (mode === "target" && !tgt) throw new Error("No se ha encontrado un elemento que capturar en esta página.");
  const region = info.region;
  const X0 = mode === "target" ? Math.max(tgt.left, region.left) : region.left;
  const W = mode === "target" ? Math.min(tgt.left + tgt.width, region.left + region.width) - X0 : region.width;
  const Y0 = mode === "target" ? tgt.contentTop : 0;
  const H = mode === "target" ? tgt.height : info.scrollHeight;
  if (!(W > 1) || !(H > 1)) throw new Error("La página no ha devuelto dimensiones válidas para la captura.");
  const MAX_CSS = 60000;
  if (H > MAX_CSS) throw new Error(`El contenido mide ${Math.round(H)} px. Usa «Cargar más contenido» con un límite menor o captura por partes.`);

  const hideFixed = els.optHideFixed.checked;
  const prepared = await send("PREPARE_CAPTURE", { hideFixed });
  const kind = mode === "target" ? "screenshot-post" : "screenshot-page";
  const savedIds = [];
  let scale = 1, partCss = 0, frames = 0, cursor = Y0, endRow = Y0 + H;
  const parts = new Map();
  const region2 = `x=${Math.round(X0)},y=${Math.round(Y0)},w=${Math.round(W)},h=${Math.round(H)}`;

  const finishPart = async (index, lastRow) => {
    const part = parts.get(index);
    if (!part) return;
    parts.delete(index);
    const rows = Math.max(1, Math.min(part.rows, lastRow - part.startRow));
    const out = document.createElement("canvas");
    out.width = part.canvas.width; out.height = Math.max(1, Math.round(rows * scale));
    out.getContext("2d", { alpha: false }).drawImage(part.canvas, 0, 0);
    part.canvas.width = 0;
    const blob = await canvasBlob(out);
    if (!blob.size) throw new Error("La captura generada está vacía.");
    const record = await saveEvidence({ kind, blob, slug: `${slugFor(a, mode)}_parte-${String(index + 1).padStart(2, "0")}`, extension: ".png", source: sourceSnapshot(a), note: index === 0,
      details: { startUrl: a.url, endUrl: a.url, region: region2, scrollMode: info.mode, fixedHidden: hideFixed ? prepared.hidden : 0, pixelWidth: out.width, pixelHeight: out.height, frames, part: index + 1, scale: Number(scale.toFixed(3)), viewport: a.environment.viewport, devicePixelRatio: a.environment.devicePixelRatio } });
    out.width = 0;
    savedIds.push(record.id);
  };

  try {
    while (cursor < endRow - 0.5 && frames < 220) {
      checkCancel();
      const maxScroll = Math.max(0, (mode === "page" ? Math.max(info.scrollHeight, endRow) : info.scrollHeight) - region.height);
      const scroll = await send("SCROLL_TO", { y: Math.min(cursor, maxScroll) });
      await sleep(frames === 0 ? 800 : 700);
      const frame = await captureFrame();
      if (!samePage(frame.url, a.url)) throw new Error("La dirección de la página cambió durante la captura. Repite la operación.");
      const image = await loadImage(frame.dataUrl);
      if (frames === 0) {
        const ratio = image.width / info.viewportWidth;
        scale = Math.min(ratio, 2.5, 4000 / W);
        partCss = Math.floor(MAX_PART_PX / scale);
      }
      if (mode === "page" && scroll.scrollHeight > endRow - Y0 + 4) endRow = Math.min(Y0 + MAX_CSS, scroll.scrollHeight);
      const rx = image.width / info.viewportWidth, ry = image.height / info.viewportHeight;
      const top = Math.max(cursor, scroll.top);
      const bottom = Math.min(endRow, scroll.top + region.height);
      if (bottom <= top) throw new Error("El desplazamiento no avanza; la página bloquea el scroll.");
      let p = Math.floor((top - Y0) / partCss);
      const lastP = Math.floor((bottom - Y0 - 0.001) / partCss);
      for (; p <= lastP; p++) {
        const startRow = Y0 + p * partCss;
        if (!parts.has(p)) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(W * scale)); canvas.height = Math.round(partCss * scale);
          const ctx = canvas.getContext("2d", { alpha: false });
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          parts.set(p, { canvas, ctx, startRow, rows: partCss });
        }
        const part = parts.get(p);
        const from = Math.max(top, startRow), to = Math.min(bottom, startRow + partCss);
        if (to > from) part.ctx.drawImage(image, X0 * rx, (region.top + (from - scroll.top)) * ry, W * rx, (to - from) * ry, 0, Math.round((from - startRow) * scale), W * scale, (to - from) * scale);
      }
      cursor = bottom;
      frames++;
      setProgress(Math.min(0.98, (cursor - Y0) / Math.max(1, endRow - Y0)), `Tramo ${frames}`);
      setStatus("busy", `Capturando ${mode === "target" ? "elemento" : "página"}: tramo ${frames}…`);
      for (const [index, part] of [...parts]) if (part.startRow + partCss <= cursor + 0.001) await finishPart(index, part.startRow + partCss);
    }
    if (cursor < endRow - 1) throw new Error("La captura alcanzó el límite de tramos antes de finalizar.");
    for (const index of [...parts.keys()].sort((x, y) => x - y)) await finishPart(index, endRow);
  } finally {
    await send("RESTORE_CAPTURE", { state: prepared }).catch(() => {});
    setProgress(null);
  }
  for (const id of savedIds) await store.updateEvidence(id, { details: { parts: savedIds.length, frames } });
  await renderEvidence();
  setStatus("ready", `${mode === "target" ? "Captura del elemento" : "Captura de página"} guardada (${savedIds.length} ${savedIds.length === 1 ? "imagen" : "partes"}, ${frames} tramos).`);
}

async function saveMhtml() {
  const a = await analyze({ quiet: true });
  await ensureAnalysisEvidence(a);
  setStatus("busy", "Generando MHTML…");
  const blob = await chrome.pageCapture.saveAsMHTML({ tabId: targetTab.id });
  if (!blob?.size) throw new Error("El navegador no pudo generar el archivo MHTML.");
  if (blob.size > 250 * 1024 * 1024) throw new Error("El MHTML supera el límite operativo de 250 MB.");
  await saveEvidence({ kind: "mhtml", blob: new Blob([blob], { type: "multipart/related" }), slug: slugFor(a, "pagina"), extension: ".mhtml", source: sourceSnapshot(a), details: { startUrl: a.url } });
}

async function savePageData() {
  const a = await analyze({ quiet: true });
  const code = await ensureAnalysisEvidence(a);
  let saved = 1;
  for (const raw of a.ssrRaw || []) {
    await saveEvidence({ kind: "source-data", blob: new Blob([raw.text], { type: "application/json" }), slug: `${slugFor(a, "origen")}_${raw.id}`, extension: ".json", source: sourceSnapshot(a), details: { origin: `JSON embebido en la página (${raw.id})`, posts: raw.posts }, note: false, copy: false });
    saved++;
  }
  const indexes = new Set();
  for (const p of a.posts) for (const i of p.rawIndexes || []) indexes.add(i);
  for (const index of [...indexes].slice(0, 10)) {
    const raw = await send("HARVEST_RAW", { index }, 40000).catch(() => null);
    if (!raw?.text) continue;
    await saveEvidence({ kind: "source-data", blob: new Blob([raw.text], { type: "application/json" }), slug: `${slugFor(a, "api")}_${index}`, extension: ".json", source: sourceSnapshot(a), details: { origin: "Respuesta recibida por el navegador", apiUrl: raw.url.slice(0, 500), receivedAt: raw.at }, note: false, copy: false });
    saved++;
  }
  setStatus("ready", `Datos guardados: ${saved} archivos JSON (ficha ${code}).`);
}

// ------------------------------------------------------------------ Descarga multimedia
async function ensureOrigins(urls) {
  const origins = [...new Set(urls.map((u) => { try { return `${new URL(u).origin}/*`; } catch { return ""; } }).filter(Boolean))];
  const missing = [];
  for (const origin of origins) if (!(await chrome.permissions.contains({ origins: [origin] }))) missing.push(origin);
  if (missing.length && !(await chrome.permissions.request({ origins: missing }))) throw new Error("No se ha concedido acceso a los servidores multimedia.");
}

async function knownMedia() {
  // La deduplicación es por publicación: el mismo archivo enlazado desde dos publicaciones distintas conserva ambos vínculos.
  const items = await store.listEvidence();
  const scope = (e) => e.details?.postKey || "";
  return {
    urls: new Map(items.filter((e) => e.details?.mediaUrl).map((e) => [`${scope(e)}|${e.details.mediaUrl}`, e.code])),
    hashes: new Map(items.filter((e) => e.kind.startsWith("media")).map((e) => [`${scope(e)}|${e.sha256}`, e.code]))
  };
}

async function downloadMediaItem(item, a, post, known) {
  if (!item.url) throw new Error("El recurso no tiene una dirección descargable. Usa la grabación de pestaña.");
  const p = post || a.primaryPost || null;
  const pKey = p ? N.postKey(p) : "";
  if (known.urls.has(`${pKey}|${item.url}`)) return { skipped: true, code: known.urls.get(`${pKey}|${item.url}`), reason: "ya guardado" };
  const result = await fetchMedia(item.url, { kind: item.kind });
  const sha = await sha256Blob(result.blob);
  if (known.hashes.has(`${pKey}|${sha}`)) { known.urls.set(`${pKey}|${item.url}`, known.hashes.get(`${pKey}|${sha}`)); return { skipped: true, code: known.hashes.get(`${pKey}|${sha}`), reason: "contenido idéntico ya guardado" }; }
  const suffix = `${item.role === "cover" ? "portada" : item.role === "avatar" ? "avatar" : item.kind === "video" ? "video" : "img"}-${item.index || 1}`;
  const src = p ? { ...sourceSnapshot(a, p.url ? p : null), username: p.author?.username || a.username } : sourceSnapshot(a);
  const record = await saveEvidence({
    kind: result.format.family === "video" ? "media-video" : "media-image", blob: result.blob, slug: `${a.platform}_${src.username || "web"}_${p?.code || a.contentId || ""}_${suffix}`, extension: result.format.extension,
    source: src, note: false,
    details: { mediaUrl: item.url, rawUrl: item.rawUrl && item.rawUrl !== item.url ? item.rawUrl : undefined, mediaIndex: item.index, mediaRole: item.role, width: item.width || undefined, height: item.height || undefined, expiresAt: item.expiresAt || undefined, postId: p?.code || "", postKey: pKey, postUrl: p?.url || "", origin: item.origin, discoveredOn: a.url, http: result.http, mp4Boxes: result.structure?.boxes }
  });
  known.urls.set(`${pKey}|${item.url}`, record.code); known.hashes.set(`${pKey}|${sha}`, record.code);
  if (pKey) downloadedPostKeys.add(pKey);
  return { record };
}

function showBatchReport(title, lines) {
  els.batchReport.hidden = false;
  els.batchReport.innerHTML = `<b>${escapeHtml(title)}</b><br>${lines.map((l) => `<span class="${l.err ? "err" : ""}">${escapeHtml(l.text)}</span>`).join("<br>")}`;
}

async function downloadMany(entries, a) {
  await ensureOrigins(entries.map((e) => e.item.url).filter(Boolean));
  await ensureAnalysisEvidence(a);
  const known = await knownMedia();
  const lines = [];
  let ok = 0, skipped = 0, failed = 0, done = 0;
  const queue = entries.slice();
  const worker = async () => {
    while (queue.length) {
      checkCancel();
      const { item, post } = queue.shift();
      const label = `${item.kind === "video" ? "Vídeo" : "Imagen"} ${post?.code || a.contentId || ""} #${item.index || 1}`;
      try {
        const r = await downloadMediaItem(item, a, post, known);
        if (r.skipped) { skipped++; lines.push({ text: `${label}: omitido (${r.reason}, ${r.code}).` }); } else { ok++; lines.push({ text: `${label}: ${r.record.code} · ${r.record.sha256.slice(0, 12)}…` }); }
      } catch (error) {
        if (error.name === "Cancelled") throw error;
        failed++; lines.push({ text: `${label}: ${error.message}`, err: true });
        await log("Error de descarga", `${label}: ${error.message}`, { level: "error" });
      }
      done++;
      setProgress(done / entries.length, `${done}/${entries.length}`);
      setStatus("busy", `Descargando medios: ${done} de ${entries.length}…`);
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); }
  finally { setProgress(null); showBatchReport(`Descarga: ${ok} guardados, ${skipped} omitidos, ${failed} con error`, lines); renderPosts(lastAnalysis); }
  setStatus(failed ? "error" : "ready", `Descarga terminada: ${ok} guardados, ${skipped} omitidos, ${failed} con error.${failed ? " Para los fallidos usa el grabador de pestaña." : ""}`);
}

// ------------------------------------------------------------------ Listas de la interfaz
function renderMedia(a) {
  const media = a.media;
  const downloadable = media.filter((m) => m.downloadable);
  els.mediaCount.textContent = String(media.length);
  els.downloadAllMedia.hidden = downloadable.length < 2;
  els.downloadAllMedia.textContent = `Descargar todo (${downloadable.length})`;
  if (!media.length) { els.mediaList.className = "media-list empty"; els.mediaList.textContent = "No se han localizado recursos multimedia accesibles."; return; }
  els.mediaList.className = "media-list";
  els.mediaList.innerHTML = media.map((item, i) => `<div class="media-item">
    ${item.kind === "image" && item.url ? `<img class="media-thumb" referrerpolicy="no-referrer" src="${escapeHtml(item.url)}" alt="">` : `<div class="media-thumb">${item.kind === "video" ? "▶" : "▣"}</div>`}
    <div class="item-copy"><strong>${item.kind === "video" ? "Vídeo" : "Imagen"}${item.role && item.role !== "full" ? ` · ${escapeHtml(item.role)}` : ""}${item.index ? ` · #${item.index}` : ""}${item.width ? ` · ${item.width}×${item.height}` : ""}${item.downloadable ? "" : ` · ${escapeHtml(item.note || "no descargable")}`}</strong><span class="small" title="${escapeHtml(item.url)}">${escapeHtml(item.url || "")}</span></div>
    <button class="icon-button" data-media="${i}" title="${item.downloadable ? "Descargar" : "Copiar URL"}">${item.downloadable ? "↓" : "⧉"}</button></div>`).join("");
  els.mediaList.querySelectorAll("[data-media]").forEach((button) => button.addEventListener("click", () => perform(async () => {
    const item = media[Number(button.dataset.media)];
    if (!item.downloadable) { await navigator.clipboard.writeText(item.url); setStatus("ready", `${item.note || "Emisión"}: no es un archivo único descargable (emisión segmentada). Dirección copiada; usa el grabador de pestaña para documentarlo.`); await log("Aviso: recurso no descargable", `${item.note || "emisión segmentada"} ${String(item.url).slice(0, 300)}`, { level: "warn" }); return; }
    await downloadMany([{ item, post: a.primaryPost }], a);
  })));
}

function postLabel(p) { return { image: "Imagen", video: "Vídeo", carousel: "Carrusel", reel: "Reel", story: "Historia", photo: "Fotos", unknown: "?" }[p.type] || p.type; }

function renderPosts(a) {
  const posts = a?.posts || [];
  els.postCount.textContent = String(posts.length);
  els.postActions.hidden = !posts.length || a.pageKind !== "profile";
  if (!posts.length) { els.postList.className = "post-list empty"; els.postList.textContent = "Analiza un perfil o publicación para ver las publicaciones detectadas."; return; }
  els.postList.className = "post-list";
  const shown = posts.slice(0, 300);
  els.postList.innerHTML = shown.map((p) => {
    const key = N.postKey(p);
    const thumb = p.thumb || p.media?.find((m) => m.kind === "image")?.url || "";
    const mediaCount = (p.media || []).filter((m) => m.role !== "cover" && m.url).length;
    const flag = downloadedPostKeys.has(key) ? '<span class="post-flag">✓ descargada</span>' : p.stub ? '<span class="post-flag warn">sin datos</span>' : `${mediaCount} medios`;
    return `<label class="post-item"><input type="checkbox" data-post="${escapeHtml(key)}" ${selected.has(key) ? "checked" : ""}>
      ${thumb ? `<img referrerpolicy="no-referrer" src="${escapeHtml(thumb)}" alt="">` : '<div class="post-thumb">▣</div>'}
      <div class="item-copy"><strong>${escapeHtml(postLabel(p))} · ${escapeHtml(p.code)} · ${escapeHtml((p.takenAt || "").slice(0, 10) || "sin fecha")}</strong><span>${escapeHtml((p.caption || "").slice(0, 110))}</span><span>${flag}</span></div></label>`;
  }).join("") + (posts.length > shown.length ? `<div class="muted-small">Mostrando ${shown.length} de ${posts.length}. Las acciones se aplican a las seleccionadas.</div>` : "");
  els.postList.querySelectorAll("[data-post]").forEach((box) => box.addEventListener("change", () => { box.checked ? selected.add(box.dataset.post) : selected.delete(box.dataset.post); updateSelected(); }));
  updateSelected();
}
function updateSelected() { els.selectedCount.textContent = `${selected.size} seleccionadas`; }

const kindIcon = (kind) => (kind === "media-video" || kind === "recording" ? "▶" : kind === "mhtml" ? "◇" : kind === "analysis" || kind === "source-data" ? "{ }" : "◆");
const INTEGRITY_CHIP = { ok: '<span class="chip chip-ok">Hash comprobado ✔</span>', bad: '<span class="chip chip-bad">HASH NO COINCIDE</span>', missing: '<span class="chip chip-bad">CONTENIDO AUSENTE</span>' };

/** Habilita o deshabilita los controles que dependen de que existan evidencias. */
function syncEvidenceButtons(count = Number(els.evidenceCount.textContent || 0)) {
  for (const button of [els.exportPackage, els.goExport, els.checkIntegrity, els.viewTechnical, els.viewSummary]) button.disabled = busy || count === 0;
}

function evidenceMarkup(item) {
  const info = kindInfo(item.kind);
  const thumb = item.thumb && /^data:image\/jpeg;base64,/.test(item.thumb) ? `<img class="evidence-thumb" src="${escapeHtml(item.thumb)}" alt="">` : `<div class="evidence-thumb">${kindIcon(item.kind)}</div>`;
  return `<div class="evidence-item" data-id="${escapeHtml(item.id)}">${thumb}<div class="item-copy">
    <div class="evidence-head"><strong>${escapeHtml(item.code)} · ${escapeHtml(KIND_LABELS[item.kind] || item.type)}</strong>
      <div class="evidence-tools"><button class="icon-button" data-act="note" title="Añadir o editar la nota del investigador">✎</button><button class="icon-button danger" data-act="delete" title="Eliminar de la sesión">×</button></div></div>
    <div class="evidence-meta">${escapeHtml(item.filename)}</div>
    <div class="evidence-meta">${escapeHtml(formatBytes(item.size))} · ${escapeHtml(formatLocal(item.createdAt, item.utcOffsetMinutes))}</div>
    <div class="evidence-hash"><code title="SHA-256">${escapeHtml(item.sha256 || "—")}</code><button class="icon-button" data-act="copy" title="Copiar SHA-256">⧉</button></div>
    <div class="chips"><span class="chip chip-class" title="${escapeHtml(info.method)}">${escapeHtml(FILE_CLASS_LABELS[info.fileClass])}</span>${INTEGRITY_CHIP[integrityState.get(item.id)] || '<span class="chip">Hash sin recomprobar</span>'}</div>
    ${item.note ? `<div class="evidence-note" title="Dato introducido manualmente">Nota: ${escapeHtml(item.note)}</div>` : ""}
  </div></div>`;
}

async function renderEvidence() {
  const items = await store.listEvidence();
  els.evidenceCount.textContent = String(items.length);
  els.sessionEvidenceCount.textContent = String(items.length);
  els.evidenceBytes.textContent = formatBytes(items.reduce((n, e) => n + (e.size || 0), 0));
  syncEvidenceButtons(items.length);
  downloadedPostKeys = new Set(items.map((e) => e.details?.postKey).filter(Boolean));
  updateSessionWarning(items);
  if (!items.length) { els.evidenceList.className = "evidence-list empty"; els.evidenceList.textContent = "No hay evidencias guardadas en esta sesión."; els.integritySummary.hidden = true; return; }
  els.evidenceList.className = "evidence-list";
  const recent = items.slice(-150).reverse();
  els.evidenceList.innerHTML = recent.map(evidenceMarkup).join("") + (items.length > recent.length ? `<div class="muted-small">Mostrando las ${recent.length} más recientes de ${items.length}. El paquete exportado las incluye todas.</div>` : "");
}

/** Aviso para no mezclar expedientes: evidencias incorporadas con una referencia distinta de la actual. */
function updateSessionWarning(items) {
  const current = els.caseRef.value.trim();
  const others = [...new Set(items.map((e) => e.case?.reference || "").filter((r) => r && current && r !== current))];
  els.sessionWarning.hidden = !others.length;
  if (others.length) els.sessionWarning.textContent = `Hay evidencias incorporadas con otra referencia (${others.slice(0, 3).map((r) => `«${r}»`).join(", ")}). Si se trata de otro expediente, pulsa «Nueva sesión» para no mezclar evidencias. La discrepancia constará en el informe.`;
}

// Acciones sobre una evidencia (delegación de eventos: la lista se repinta a menudo).
els.evidenceList.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-act]");
  const row = event.target.closest(".evidence-item");
  if (!button || !row) return;
  const id = row.dataset.id;
  try {
    const item = await store.getEvidence(id);
    if (!item) { await renderEvidence(); return; }
    if (button.dataset.act === "copy") {
      await navigator.clipboard.writeText(item.sha256);
      setStatus("ready", `SHA-256 de ${item.code} copiado al portapapeles.`);
    } else if (button.dataset.act === "delete") {
      if (busy) { setStatus("busy", "Hay una operación en curso. Espera a que termine para eliminar evidencias."); return; }
      if (!confirm(`¿Eliminar ${item.code} de la sesión local? La acción queda anotada en el registro de actividad y figurará en el informe.`)) return;
      await log("Evidencia eliminada", `${item.code} ${item.filename} sha256=${item.sha256}`, { level: "warn", code: item.code });
      await store.deleteEvidence(id);
      integrityState.delete(id);
      await renderEvidence();
    } else if (button.dataset.act === "note") {
      const existing = row.querySelector(".note-editor");
      if (existing) { existing.remove(); return; }
      const editor = document.createElement("div");
      editor.className = "note-editor";
      const area = document.createElement("textarea");
      area.rows = 2; area.maxLength = 2000; area.value = item.note || ""; area.placeholder = "Nota del investigador sobre esta evidencia";
      const save = document.createElement("button");
      save.className = "button button-secondary button-small"; save.textContent = "Guardar nota";
      save.addEventListener("click", async () => {
        const note = area.value.trim();
        await store.updateEvidence(id, { note });
        await log("Nota de evidencia modificada", `${item.code}: ${note ? "nota actualizada" : "nota eliminada"}`, { code: item.code });
        await renderEvidence();
      });
      editor.append(area, save);
      row.querySelector(".item-copy").append(editor);
      area.focus();
    }
  } catch (error) { setStatus("error", friendlyError(error)); }
});

/** Recalcula el SHA-256 de cada archivo del almacén local y lo compara con el registrado al capturar. */
async function checkIntegrity() {
  const items = await store.listEvidence();
  let ok = 0, bad = 0, missing = 0;
  for (let i = 0; i < items.length; i++) {
    checkCancel();
    const item = items[i];
    const blob = item.hasBlob ? await store.getBlob(item.id) : null;
    if (!blob) { integrityState.set(item.id, "missing"); missing++; }
    else if ((await sha256Blob(blob)) === item.sha256) { integrityState.set(item.id, "ok"); ok++; }
    else { integrityState.set(item.id, "bad"); bad++; }
    setProgress((i + 1) / items.length, `Comprobando ${i + 1}/${items.length}`);
    setStatus("busy", `Recalculando hashes: ${i + 1} de ${items.length}…`);
  }
  setProgress(null);
  const clean = !bad && !missing;
  await log("Comprobación de hashes", `${items.length} archivos: ${ok} coinciden, ${bad} no coinciden, ${missing} sin contenido`, { level: clean ? "info" : "error" });
  els.integritySummary.hidden = false;
  els.integritySummary.className = `integrity-summary ${clean ? "ok" : "bad"}`;
  els.integritySummary.textContent = clean ? `Los ${ok} archivos coinciden con el SHA-256 registrado al capturarlos (${formatLocal(new Date().toISOString())}).` : `Atención: ${bad} archivo(s) no coinciden y ${missing} no tienen contenido. ${ok} coinciden.`;
  await renderEvidence();
  setStatus(clean ? "ready" : "error", clean ? `Integridad local comprobada: ${ok} de ${items.length} archivos coinciden.` : `Integridad local: ${bad} discrepancia(s), ${missing} sin contenido.`);
}

// ------------------------------------------------------------------ Acciones de lote
async function loadMore() {
  const max = Math.max(6, Number(els.loadMax.value) || 60);
  await saveSettings();
  await refreshTargetTab();
  await send("SCROLLER");
  const started = Date.now();
  let stable = 0, steps = 0, items = 0;
  while (Date.now() - started < 240_000) {
    checkCancel();
    const step = await send("AUTOSCROLL_STEP", { waitMs: 2200 }, 30000);
    steps++; items = step.items;
    setProgress(Math.min(1, items / max), `${items} enlaces visibles`);
    setStatus("busy", `Cargando contenido: ${items} publicaciones visibles (paso ${steps})…`);
    if (items >= max) break;
    stable = !step.grew && step.atBottom ? stable + 1 : 0;
    if (stable >= 3) break;
  }
  await send("SCROLL_TO", { y: 0 });
  setProgress(null);
  await log("Carga de contenido", `${steps} pasos, ${items} enlaces visibles`);
  await analyze();
}

async function downloadSelectedPostsMedia() {
  const a = lastAnalysis;
  const chosen = a.posts.filter((p) => selected.has(N.postKey(p)));
  if (!chosen.length) throw new Notice("Selecciona al menos una publicación.");
  const entries = [];
  const missing = [];
  for (const p of chosen) {
    const items = (p.media || []).filter((m) => m.role === "full" || (m.role === "cover" && !(p.media || []).some((x) => x.kind === "video" && x.url)));
    if (!items.some((m) => m.url)) { missing.push(p.code); continue; }
    for (const m of items) entries.push({ item: { ...m, origin: "api" }, post: p });
  }
  await log("Descarga de medios", `${chosen.length} publicaciones seleccionadas`);
  if (entries.length) await downloadMany(entries, a);
  if (missing.length) {
    const text = `Sin datos de medios (solo miniatura): ${missing.join(", ")}. Usa «Abrir y capturar cada seleccionada» para obtenerlos.`;
    if (!entries.length) showBatchReport("Sin medios que descargar", [{ text, err: true }]); else els.batchReport.insertAdjacentHTML("beforeend", `<br><span class="err">${escapeHtml(text)}</span>`);
  }
}

async function capturePostsBatch() {
  const a0 = lastAnalysis;
  const chosen = a0.posts.filter((p) => selected.has(N.postKey(p)) && p.url);
  if (!chosen.length) throw new Notice("Selecciona al menos una publicación.");
  if (!(await ensureAllSites())) throw new Error("El modo lote navega entre publicaciones y necesita el permiso «acceder a todos los sitios» para capturar tras cada navegación.");
  const returnUrl = targetTab.url;
  const withMedia = els.optBatchMedia.checked;
  await saveSettings();
  await log("Lote de capturas", `${chosen.length} publicaciones desde ${returnUrl}`);
  const lines = [];
  try {
    for (let i = 0; i < chosen.length; i++) {
      checkCancel();
      const p = chosen[i];
      setProgress(i / chosen.length, `${i + 1}/${chosen.length} · ${p.code}`);
      setStatus("busy", `Abriendo publicación ${i + 1} de ${chosen.length}: ${p.code}…`);
      try {
        await send("NAVIGATE", { url: p.url }, 45000);
        await sleep(3000);
        await refreshTargetTab();
        const a = await analyze({ quiet: true });
        await stitchedCapture("target");
        if (withMedia) {
          await ensureOrigins(a.media.filter((m) => m.downloadable).map((m) => m.url));
          const known = await knownMedia();
          for (const m of a.media.filter((x) => x.downloadable && x.role !== "avatar")) {
            try { const r = await downloadMediaItem(m, a, a.primaryPost, known); lines.push({ text: `${p.code} #${m.index}: ${r.skipped ? `omitido (${r.code})` : r.record.code}` }); }
            catch (error) { lines.push({ text: `${p.code} #${m.index}: ${error.message}`, err: true }); await log("Error de descarga", `${p.code} #${m.index}: ${error.message}`, { level: "error" }); }
          }
        }
        lines.push({ text: `${p.code}: captura completada.` });
      } catch (error) {
        if (error.name === "Cancelled") throw error;
        lines.push({ text: `${p.code}: ${error.message}`, err: true });
        await log("Error en lote", `${p.code}: ${error.message}`, { level: "error" });
      }
      await sleep(1200);
    }
  } finally {
    setProgress(null);
    try { await send("NAVIGATE", { url: returnUrl }, 45000); await sleep(2500); await analyze({ quiet: true }); } catch { /* la pestaña puede haberse cerrado */ }
    showBatchReport("Lote de capturas", lines);
  }
  setStatus("ready", `Lote terminado (${chosen.length} publicaciones). Se ha vuelto a la página inicial.`);
}

// ------------------------------------------------------------------ Exportación
async function downloadFile(blob, filename, revokeAfterMs = 600_000) {
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({ url, filename, conflictAction: "uniquify", saveAs: false });
    const [item] = await chrome.downloads.search({ id });
    return item?.filename || filename;
  } finally { setTimeout(() => URL.revokeObjectURL(url), revokeAfterMs); }
}

async function exportPackage() {
  setStatus("busy", "Verificando hashes y preparando el paquete…");
  await saveCase(); await saveInstitution();
  if (!(await store.listEvidence()).length) throw new Notice("No hay evidencias que exportar.");
  await log("Exportación", "Inicio de la exportación del paquete");
  let pkg, collected;
  try {
    collected = await collectSession({ onProgress: (fraction, text) => setProgress(fraction * 0.6, text), checkCancel, logAlert: (detail, code) => log("ALERTA integridad", detail, { level: "error", code }) });
    setStatus("busy", "Generando informes y empaquetando…");
    pkg = await buildPackage(collected, { includePdf: els.optIncludePdf.checked, onProgress: (fraction, text) => setProgress(0.6 + fraction * 0.4, text) });
  } finally { setProgress(null); }
  const where = await downloadFile(pkg.blob, `RASTRO-CAPTURE/${pkg.name}`);
  let sidecar = "";
  if (els.optZipHash.checked) {
    try { sidecar = await downloadFile(new Blob([`${pkg.sha256}  ${pkg.name}\n`], { type: "text/plain" }), `RASTRO-CAPTURE/${pkg.name}.sha256`, 120_000); }
    catch (error) { await log("Aviso: archivo .sha256 no creado", error.message, { level: "warn" }); }
  }
  if (pkg.pdfError) await log("Aviso: PDF no generado", pkg.pdfError, { level: "warn" });
  const count = collected.manifest.evidence.length;
  await store.kvSet("lastExport", { at: new Date().toISOString(), seq: collected.manifest.evidence.at(-1).sequence, name: pkg.name, sha256: pkg.sha256 });
  await log("Paquete exportado", `${pkg.name} · ${pkg.blob.size} bytes · SHA-256 ${pkg.sha256}`);
  for (const e of collected.manifest.evidence) integrityState.set(e.id, e.integrityStatus === "verificada" ? "ok" : e.integrityStatus === "contenido-ausente" ? "missing" : "bad");
  els.exportResult.hidden = false;
  els.exportResult.replaceChildren();
  const line = (label, value, mono = false) => { const div = document.createElement("div"); const b = document.createElement("b"); b.textContent = `${label}: `; const span = document.createElement(mono ? "code" : "span"); span.textContent = value; div.append(b, span); els.exportResult.append(div); };
  line("Paquete", where); line("SHA-256 del ZIP", pkg.sha256, true);
  line("Archivo de huella", sidecar || "no generado (opción desactivada)");
  if (pkg.pdfError) line("PDF", `no generado (${pkg.pdfError})`);
  await renderEvidence();
  const bad = collected.bad;
  setStatus(bad ? "error" : "ready", bad ? `Paquete exportado con ${bad} archivo(s) cuya huella NO coincide o falta. Revisa el informe. ${where}` : `Paquete exportado (${count} evidencias, todas verificadas): ${where}`);
}

async function openTool(page) {
  await saveCase(); await saveInstitution();
  await chrome.tabs.create({ url: chrome.runtime.getURL(page) });
}

// ------------------------------------------------------------------ Sesión
function renderSession() {
  els.sessionId.textContent = session?.id || "—";
  els.sessionId.title = session ? `Sesión iniciada el ${formatLocal(session.startedAt, session.utcOffsetMinutes)}` : "";
}

function resetAnalysisUi() {
  catalog.posts.clear(); catalog.accounts.clear(); selected.clear(); downloadedPostKeys = new Set(); analysisSaved = { hash: "", code: "" };
  lastAnalysis = null; integrityState.clear();
  els.analysis.className = "analysis empty"; els.analysis.textContent = "Todavía no se ha analizado la pestaña.";
  els.platformBadge.textContent = "SIN ANALIZAR"; els.mediaCount.textContent = "0"; els.postCount.textContent = "0"; els.postActions.hidden = true; els.batchReport.hidden = true; els.downloadAllMedia.hidden = true;
  els.mediaList.className = "media-list empty"; els.mediaList.textContent = "Analiza la página para localizar imágenes y vídeos.";
  els.postList.className = "post-list empty"; els.postList.textContent = "Analiza un perfil o publicación para ver las publicaciones detectadas.";
  els.exportResult.hidden = true; els.integritySummary.hidden = true;
}

/** Cierra la sesión actual (borra evidencias, registro y datos del expediente) y abre otra. El perfil institucional se conserva. */
async function newSession() {
  const items = await store.listEvidence();
  const last = await store.kvGet("lastExport");
  const pending = items.filter((e) => !last || e.seq > last.seq).length;
  const warning = items.length ? `Se eliminarán ${items.length} evidencias locales (${pending} sin exportar).${pending ? "\n\n⚠ Hay evidencias que NO se han incluido en ningún paquete ZIP. Exporta antes de continuar." : ""}\n\n¿Iniciar una sesión nueva?` : "¿Iniciar una sesión nueva? Se vaciarán los datos del expediente; el perfil institucional se conserva.";
  if (!confirm(warning)) return;
  session = await store.startNewSession();
  resetAnalysisUi();
  for (const el of [els.caseRef, els.caseProceedings, els.caseName, els.caseObservations, els.captureNote]) el.value = "";
  if (!els.instKeepLogo.checked) { await ctx.removeLogo(); institutionLogo = ""; renderLogo(); }
  await saveCase(); await renderEvidence(); renderSession();
  await log("Sesión iniciada", session.id);
  setStatus("ready", `Nueva sesión preparada (${session.id}).`);
}

// ------------------------------------------------------------------ Personalización institucional
function renderLogo() {
  els.logoPreview.replaceChildren();
  els.logoRemove.hidden = !institutionLogo;
  els.logoChoose.textContent = institutionLogo ? "Cambiar escudo o logotipo" : "Cargar escudo o logotipo";
  if (!institutionLogo) { els.logoPreview.className = "logo-preview empty"; els.logoPreview.textContent = "Sin escudo"; return; }
  els.logoPreview.className = "logo-preview";
  const img = document.createElement("img");
  img.src = institutionLogo; img.alt = "Escudo o logotipo de la unidad";
  els.logoPreview.append(img);
}

els.logoChoose.addEventListener("click", () => els.logoFile.click());
els.logoFile.addEventListener("change", async () => {
  const file = els.logoFile.files?.[0];
  els.logoFile.value = "";
  if (!file) return;
  try {
    const result = await ctx.sanitizeLogoFile(file);
    await ctx.saveLogo(result.dataUrl);
    institutionLogo = result.dataUrl;
    renderLogo();
    els.logoInfo.textContent = `${result.format} · ${result.width}×${result.height} px · guardado en este navegador`;
    setStatus("ready", "Escudo institucional cargado. Aparecerá en el encabezado de los informes.");
  } catch (error) { setStatus("error", error.message); }
});
els.logoRemove.addEventListener("click", async () => {
  await ctx.removeLogo(); institutionLogo = ""; renderLogo();
  els.logoInfo.textContent = "PNG, JPG o SVG · máx. 5 MB";
  setStatus("ready", "Escudo institucional eliminado.");
});

// ------------------------------------------------------------------ Pestañas y configuración
function showTab(name) {
  document.querySelectorAll(".tab").forEach((tab) => { const on = tab.dataset.tab === name; tab.classList.toggle("is-active", on); tab.setAttribute("aria-selected", String(on)); });
  document.querySelectorAll(".view").forEach((view) => { const on = view.dataset.view === name; view.hidden = !on; view.classList.toggle("is-active", on); });
  if (name === "config") refreshConfig().catch(console.error);
}
document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => showTab(tab.dataset.tab)));

async function refreshConfig() {
  const summary = await store.storageSummary();
  els.cfgEvidence.textContent = `${summary.evidenceCount} · ${formatBytes(summary.bytes)}`;
  els.cfgLog.textContent = String(summary.logEntries);
  try { const estimate = await navigator.storage.estimate(); els.cfgUsage.textContent = `${formatBytes(estimate.usage || 0)}${estimate.quota ? ` de ${formatBytes(estimate.quota)} disponibles` : ""}`; }
  catch { els.cfgUsage.textContent = "no disponible"; }
  const all = await chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
  els.cfgAllSites.textContent = all ? "Concedido" : "No concedido";
  els.cfgRevokeSites.hidden = !all;
}
els.cfgRevokeSites.addEventListener("click", async () => {
  try { await chrome.permissions.remove({ origins: ["<all_urls>"] }); setStatus("ready", "Permiso de acceso a todos los sitios retirado."); }
  catch (error) { setStatus("error", `No se pudo retirar el permiso: ${error.message}`); }
  await refreshConfig();
});
$("#cfgClearInstitution").addEventListener("click", async () => {
  if (!confirm("¿Borrar el perfil institucional (unidad, dependencia, identificador, lugar) y el escudo guardados en este navegador?")) return;
  await chrome.storage.local.remove([ctx.INSTITUTION_KEY, ctx.LOGO_KEY]);
  for (const el of [els.caseUnit, els.instDepartment, els.caseInvestigator, els.instPlace]) el.value = "";
  els.instKeepLogo.checked = true; institutionLogo = ""; renderLogo();
  await saveCase();
  setStatus("ready", "Perfil institucional borrado.");
});
$("#cfgClearAll").addEventListener("click", () => perform(async () => {
  const count = (await store.listEvidence()).length;
  if (!confirm(`¿Borrar TODOS los datos de RASTRO CAPTURE en este navegador?\n\nSe eliminarán ${count} evidencias, el registro, los datos del expediente, el perfil institucional, el escudo y las preferencias. Los archivos ya exportados o copiados en Descargas no se tocan.`)) return;
  await store.clearAll();
  await chrome.storage.local.clear();
  location.reload();
}));

// ------------------------------------------------------------------ Control
async function perform(task) {
  if (busy) { setStatus("busy", "Hay otra operación en curso. Espera a que termine o pulsa Cancelar."); return; }
  busy = true; cancelRequested = false;
  const buttons = [...document.querySelectorAll("button:not(#cancelTask):not(.tab)")];
  buttons.forEach((b) => { b.disabled = true; });
  try { await saveSettings(); await task(); }
  catch (error) {
    console.error(error);
    const cancelled = error.name === "Cancelled";
    setStatus(cancelled || error.name === "Notice" ? "ready" : "error", friendlyError(error)); setProgress(null);
    // Los errores de operación y las cancelaciones constan como incidencias; las validaciones de uso, no.
    if (error.name !== "Notice") await log(cancelled ? "Operación cancelada" : "Error de operación", friendlyError(error), { level: cancelled ? "warn" : "error" });
  }
  finally {
    busy = false;
    document.querySelectorAll("button:not(#cancelTask):not(.tab)").forEach((b) => { b.disabled = false; });
    syncEvidenceButtons();
  }
}

$("#analyze").addEventListener("click", () => perform(analyze));
$("#captureVisible").addEventListener("click", () => perform(captureVisible));
$("#capturePost").addEventListener("click", () => perform(() => stitchedCapture("target")));
$("#capturePage").addEventListener("click", () => perform(() => stitchedCapture("page")));
$("#saveMhtml").addEventListener("click", () => perform(saveMhtml));
$("#saveData").addEventListener("click", () => perform(savePageData));
$("#loadMore").addEventListener("click", () => perform(loadMore));
$("#downloadPostsMedia").addEventListener("click", () => perform(downloadSelectedPostsMedia));
$("#capturePostsBatch").addEventListener("click", () => perform(capturePostsBatch));
els.downloadAllMedia.addEventListener("click", () => perform(async () => {
  const a = lastAnalysis;
  await downloadMany(a.media.filter((m) => m.downloadable).map((item) => ({ item, post: a.primaryPost })), a);
}));
els.exportPackage.addEventListener("click", () => perform(exportPackage));
els.goExport.addEventListener("click", () => { showTab("informes"); els.exportPackage.scrollIntoView({ block: "center" }); els.exportPackage.focus(); });
els.checkIntegrity.addEventListener("click", () => perform(checkIntegrity));
els.openVerifier.addEventListener("click", () => openTool("verify.html").catch((error) => setStatus("error", error.message)));
els.viewTechnical.addEventListener("click", () => openTool("report.html?mode=tecnico").catch((error) => setStatus("error", error.message)));
els.viewSummary.addEventListener("click", () => openTool("report.html?mode=resumido").catch((error) => setStatus("error", error.message)));
els.cancelTask.addEventListener("click", () => { cancelRequested = true; setStatus("busy", "Cancelando…"); });
$("#selectAllPosts").addEventListener("click", () => { (lastAnalysis?.posts || []).forEach((p) => selected.add(N.postKey(p))); renderPosts(lastAnalysis); });
$("#selectNonePosts").addEventListener("click", () => { selected.clear(); renderPosts(lastAnalysis); });

els.openRecorder.addEventListener("click", () => perform(async () => {
  await refreshTargetTab();
  await saveCase();
  const result = await send("OPEN_RECORDER");
  setStatus("ready", `Grabador abierto para ${result.host}. Sigue las instrucciones de esa ventana.`);
}));

$("#clearCase").addEventListener("click", () => perform(newSession));
$("#cfgClearSession").addEventListener("click", () => perform(newSession));

// Guardado automático de los campos manuales (expediente e institución por separado).
let caseTimer, institutionTimer;
[els.caseRef, els.caseProceedings, els.caseName, els.caseObservations].forEach((input) => input.addEventListener("input", () => {
  clearTimeout(caseTimer);
  caseTimer = setTimeout(async () => { await saveCase(); if (input === els.caseRef) updateSessionWarning(await store.listEvidence()); }, 300);
}));
[els.caseUnit, els.instDepartment, els.caseInvestigator, els.instPlace, els.instKeepLogo].forEach((input) => input.addEventListener(input.type === "checkbox" ? "change" : "input", () => { clearTimeout(institutionTimer); institutionTimer = setTimeout(saveInstitution, 300); }));
[els.optIncludePdf, els.optZipHash, els.optHideFixed, els.optCopyDownloads, els.optBatchMedia].forEach((input) => input.addEventListener("change", () => saveSettings().catch(console.error)));

// ------------------------------------------------------------------ Inicio
const version = chrome.runtime.getManifest().version;
els.cfgVersion.textContent = `v${version}`;
els.footVersion.textContent = `v${version} · Procesamiento local · SHA-256`;
if (version !== TOOL.version) console.warn(`RASTRO: versión del manifest (${version}) distinta de la del generador de informes (${TOOL.version}).`);
await loadInstitution();
await loadCase();
await loadSettings();
const hadSession = Boolean(await store.getSession());
session = await store.ensureSession();
renderSession();
if (!hadSession) await log("Sesión iniciada", session.id);
const savedCatalog = await store.kvGet("catalog");
for (const p of savedCatalog?.posts || []) catalog.posts.set(N.postKey(p), p);
for (const a of savedCatalog?.accounts || []) catalog.accounts.set(`${a.platform}:${a.username.toLowerCase()}`, a);
await renderEvidence();
const evidenceChannel = new BroadcastChannel("rastro-capture-evidence");
evidenceChannel.addEventListener("message", () => renderEvidence().catch(console.error));
try {
  const tab = await refreshTargetTab();
  await send("START_MONITOR").catch(() => {});
  setStatus("ready", new URL(tab.url).hostname || "Pestaña preparada.");
} catch (error) { setStatus("error", error.message); }
