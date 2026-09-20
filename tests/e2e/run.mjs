// Pruebas end-to-end de RASTRO CAPTURE en Chromium real (ver README de tests).
// Uso:  PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs xvfb-run -a node run.mjs
import { launch } from "./harness.mjs";
import { requestLog } from "./server.mjs";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sharp = (await import(process.env.SHARP_MODULE || "sharp")).default;
const results = { pass: 0, fail: 0, failures: [] };
const check = (name, condition, extra = "") => {
  if (condition) { results.pass++; console.log(`  ✔ ${name}`); }
  else { results.fail++; results.failures.push(name); console.log(`  ✘ ${name} ${extra}`); }
};
const section = (title) => console.log(`\n▶ ${title}`);

// Copia de la extensión con permiso adicional para la web genérica de pruebas (en producción es un permiso opcional).
const extCopy = mkdtempSync(path.join(os.tmpdir(), "rastro-ext-"));
cpSync(path.join(here, "../.."), extCopy, { recursive: true, filter: (src) => !/[\\/](tests|node_modules|\.git)([\\/]|$)/.test(src.replace(path.join(here, "../.."), "")) });
const manifest = JSON.parse(readFileSync(path.join(extCopy, "manifest.json"), "utf8"));
// Simula que el investigador ya concedió «acceder a todos los sitios» (el navegador lo pregunta con un cuadro que Playwright no puede pulsar).
manifest.host_permissions.push("<all_urls>");
writeFileSync(path.join(extCopy, "manifest.json"), JSON.stringify(manifest));

// ------------------------------------------------------------------ Migración v2 → v3 (perfil limpio)
section("Migración del expediente de v0.3.0 (IndexedDB v2 → v3)");
{
  const env = await launch(extCopy);
  const page = await env.context.newPage();
  await page.goto(`chrome-extension://${env.extId}/recorder.html?tabId=0`);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open("rastro-capture", 2);
    r.onupgradeneeded = () => r.result.createObjectStore("evidence", { keyPath: "id" });
    r.onsuccess = () => {
      const db = r.result; const tx = db.transaction("evidence", "readwrite");
      tx.objectStore("evidence").put({ id: "old-1", createdAt: "2026-01-01T00:00:00.000Z", type: "Captura visible", filename: "Instagram_1_visible.png", sha256: "abc", blob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) });
      tx.objectStore("evidence").put({ id: "old-2", createdAt: "2026-01-02T00:00:00.000Z", type: "Vídeo descargado", filename: "v.mp4", sha256: "def", blob: new Blob([new Uint8Array([4, 5])], { type: "video/mp4" }) });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  const migrated = await page.evaluate(async () => {
    const store = await import("./src/lib/store.js");
    const list = await store.listEvidence();
    const blob = await store.getBlob("old-1");
    return { codes: list.map((e) => e.code), kinds: list.map((e) => e.kind), size: blob?.size, hasBlobInRecord: "blob" in list[0], next: (await store.addEvidence({ kind: "analysis", slug: "x", extension: ".json", sha256: "z" }, new Blob(["{}"]))).code };
  });
  check("los registros antiguos conservan contenido y reciben código correlativo", migrated.codes.join() === "EV-0001,EV-0002" && migrated.size === 3, JSON.stringify(migrated));
  check("el tipo se deduce del registro antiguo", migrated.kinds.join() === "screenshot-visible,media-video", migrated.kinds.join());
  check("el blob ya no va dentro del registro y el siguiente código continúa la serie", !migrated.hasBlobInRecord && migrated.next === "EV-0003", migrated.next);
  await env.close();
}

// ------------------------------------------------------------------ Entorno principal
const env = await launch(extCopy);
const { context, sw, extId } = env;
await sw.evaluate(() => chrome.storage.local.set({ rastroSettings: { copyDownloads: false, hideFixed: true, loadMax: 60, batchMedia: true }, rastroCaptureCase: { reference: "EXP-2026-014", name: "Caso de prueba", investigator: "Agente 1", unit: "Unidad X" } }));

const tabIdFor = (pattern) => sw.evaluate(async (p) => (await chrome.tabs.query({ url: p }))[0]?.id, pattern);
const idle = async (panel) => { await panel.waitForTimeout(250); await panel.waitForFunction(() => !document.querySelector("#analyze").disabled, null, { timeout: 180000 }); };
const click = async (panel, selector) => {
  try { await panel.click(selector, { timeout: 15000 }); }
  catch (error) {
    const state = await panel.evaluate((sel) => { const e = document.querySelector(sel); return { hidden: e?.hidden, disabled: e?.disabled, text: e?.textContent, status: document.querySelector("#statusText").textContent, media: document.querySelector("#mediaCount").textContent }; }, selector);
    console.log("  ! no se pudo pulsar", selector, JSON.stringify(state)); throw error;
  }
  await idle(panel);
};
const status = (panel) => panel.evaluate(() => ({ kind: document.querySelector("#status").className, text: document.querySelector("#statusText").textContent }));
const evidence = (panel) => panel.evaluate(async () => (await (await import("./src/lib/store.js")).listEvidence()).map(({ thumb, ...e }) => e));
const blobBytes = (panel, id) => panel.evaluate(async (i) => { const b = await (await import("./src/lib/store.js")).getBlob(i); const u = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000)); return btoa(s); }, id).then((b64) => Buffer.from(b64, "base64"));
const sumBy = (list, kind) => list.filter((e) => e.kind === kind);

async function openPanel(tabId) {
  const url = `chrome-extension://${extId}/sidepanel.html?tabId=${tabId}`;
  const [panel] = await Promise.all([context.waitForEvent("page"), sw.evaluate((u) => chrome.windows.create({ url: u, type: "popup", width: 460, height: 900, focused: false }), url)]);
  await panel.waitForLoadState("load");
  await panel.waitForFunction(() => document.querySelector("#statusText").textContent.length > 0);
  await panel.evaluate(() => {
    window.__zips = [];
    chrome.downloads.download = async (o) => { const b = await (await fetch(o.url)).blob(); window.__zips.push({ name: o.filename, blob: b }); return 1; };
    chrome.downloads.search = async () => [{ filename: "/simulado" }];
    window.confirm = () => true;
  });
  const errors = [];
  panel.on("pageerror", (e) => errors.push(e.message));
  panel.errors = errors;
  return panel;
}

// ------------------------------------------------------------------ Instagram: publicación con carrusel
section("Instagram · publicación (carrusel imagen + imagen + vídeo, scroll interno, vídeo blob:)");
const igPage = await context.newPage();
await igPage.goto("https://www.instagram.com/p/ABC123/", { waitUntil: "load" });
await igPage.waitForTimeout(1200);
let igTab = await tabIdFor("https://www.instagram.com/*");
let panel = await openPanel(igTab);
await click(panel, "#analyze");
let st = await status(panel);
check("el análisis termina sin error", !/error/.test(st.kind), st.text);
const analysisText = await panel.textContent("#analysis");
check("detecta plataforma, tipo y código de la publicación", /Instagram/.test(analysisText) && /publicación/.test(analysisText) && /ABC123/.test(analysisText));
check("extrae usuario, fecha y hashtags desde los datos de la plataforma", /usuario_prueba/.test(analysisText) && /2026-08-01/.test(analysisText) && /#osint/.test(analysisText), analysisText.slice(0, 300));
const mediaRows = await panel.$$eval("#mediaList .media-item", (n) => n.map((x) => x.textContent));
check("lista TODAS las diapositivas del carrusel (2 imágenes + vídeo + portada), sin duplicados ni URLs falsas", mediaRows.length === 4, `${mediaRows.length}: ${mediaRows.join(" | ")}`);
check("no aparece la URL de la propia página como recurso", !mediaRows.some((r) => /instagram\.com\/p\/ABC123/.test(r)));
check("el vídeo se ofrece sin bytestart/byteend (fichero completo)", !mediaRows.some((r) => /bytestart/.test(r)));

await click(panel, "#downloadAllMedia");
st = await status(panel);
check("Descargar todo: 4 guardados y 0 errores", /4 guardados, 0 omitidos, 0 con error/.test(st.text), st.text);
let ev = await evidence(panel);
const media = ev.filter((e) => e.kind.startsWith("media"));
check("las imágenes y el vídeo son archivos válidos con extensión y MIME reales", media.some((e) => e.mime === "video/mp4" && e.filename.endsWith(".mp4")) && media.filter((e) => e.mime === "image/jpeg").length === 3, JSON.stringify(media.map((e) => [e.filename, e.mime])));
check("cada archivo tiene código único y ruta ordenada por plataforma/usuario/publicación", new Set(media.map((e) => e.code)).size === 4 && media.every((e) => e.zipPath.startsWith("medios/instagram/usuario_prueba/ABC123/")), media.map((e) => e.zipPath).join(" | "));
check("se guardan cabeceras HTTP y estructura MP4 de cada descarga", media.every((e) => e.details.http?.contentType) && media.find((e) => e.kind === "media-video").details.mp4Boxes?.includes("moov"));
check("se registra la ficha de análisis (JSON) de origen", sumBy(ev, "analysis").length === 1);

await click(panel, "#capturePage");
st = await status(panel);
check("Página completa termina sin error", !/error/.test(st.kind), st.text);
ev = await evidence(panel);
const pageShots = sumBy(ev, "screenshot-page");
check("se guarda al menos una imagen de página completa", pageShots.length >= 1);
if (pageShots.length) {
  const scrollHeight = await igPage.evaluate(() => document.querySelector("#scroller").scrollHeight);
  const shot = await blobBytes(panel, pageShots[0].id);
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rowKind = (y) => { let g = 0, r = 0; for (let x = 0; x < info.width; x += 8) { const i = (y * info.width + x) * 3; if (data[i] < 30 && data[i + 1] > 225 && data[i + 2] < 30) g++; if (data[i] > 225 && data[i + 1] < 30 && data[i + 2] < 30) r++; } const n = Math.ceil(info.width / 8); return g > n * 0.25 ? "g" : r > n * 0.25 ? "r" : ""; };
  let green = 0, red = 0, greenRuns = 0, prev = "";
  for (let y = 0; y < info.height; y++) { const k = rowKind(y); if (k === "g") green++; if (k === "r") red++; if (k === "g" && prev !== "g") greenRuns++; prev = k; }
  check(`la captura mide todo el contenido del scroll interno (${info.height}px ≈ ${scrollHeight}px, antes solo la ventana visible)`, Math.abs(info.height - scrollHeight) <= 3, `alto=${info.height} esperado=${scrollHeight}`);
  check("el marcador verde del centro aparece UNA sola vez y con su altura exacta (sin huecos ni duplicados en la unión)", greenRuns === 1 && Math.abs(green - 60) <= 1, `filas=${green} tramos=${greenRuns}`);
  check("el marcador rojo del final está presente (se llegó al fondo)", Math.abs(red - 60) <= 1, `filas=${red}`);
  check("la barra fija de login no queda repetida en la captura", pageShots[0].details.fixedHidden >= 2, `ocultados=${pageShots[0].details.fixedHidden}`);
  check("se registra la región, el modo de scroll y el número de tramos", pageShots[0].details.scrollMode === "element" && pageShots[0].details.frames >= 3, JSON.stringify(pageShots[0].details));
}
await click(panel, "#capturePost");
ev = await evidence(panel);
check("Publicación completa guarda el elemento detectado", sumBy(ev, "screenshot-post").length >= 1 && !/error/.test((await status(panel)).kind), (await status(panel)).text);
await click(panel, "#captureVisible");
check("Vista visible guarda un PNG", sumBy(await evidence(panel), "screenshot-visible").length === 1);
await click(panel, "#saveMhtml");
ev = await evidence(panel);
const mhtml = sumBy(ev, "mhtml")[0];
check("MHTML se guarda como evidencia con hash", Boolean(mhtml) && mhtml.size > 1000 && /^[0-9a-f]{64}$/.test(mhtml.sha256), (await status(panel)).text);
if (mhtml) check("el MHTML tiene formato válido", /^(From:|Subject:|MIME-Version|Date:|Snapshot)/m.test((await blobBytes(panel, mhtml.id)).subarray(0, 400).toString()));
await click(panel, "#saveData");
ev = await evidence(panel);
check("Guardar datos: JSON de origen embebido en la página", sumBy(ev, "source-data").length >= 1, (await status(panel)).text);
check("el panel no produjo errores de JavaScript", panel.errors.length === 0, panel.errors.join("; "));

// ------------------------------------------------------------------ Exportación
section("Exportación del paquete ZIP");
await click(panel, "#exportPackage");
st = await status(panel);
check("la exportación verifica todos los hashes", /todas verificadas/.test(st.text), st.text);
const zipB64 = await panel.evaluate(async () => { const z = window.__zips.find((x) => x.name.endsWith(".zip")); const u = new Uint8Array(await z.blob.arrayBuffer()); let s = ""; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000)); return { name: z.name, b64: btoa(s) }; });
const workDir = mkdtempSync(path.join(os.tmpdir(), "rastro-zip-"));
writeFileSync(path.join(workDir, "p.zip"), Buffer.from(zipB64.b64, "base64"));
execFileSync("unzip", ["-q", "p.zip", "-d", "x"], { cwd: workDir });
const listing = execFileSync("find", ["x", "-type", "f"], { cwd: workDir }).toString().split("\n").filter(Boolean);
for (const f of ["INFORME.html", "MANIFEST.json", "SHA256SUMS.txt", "evidencias.csv", "registro-actividad.csv", "LEEME-VERIFICACION.txt"]) check(`el paquete contiene ${f}`, listing.includes(`x/${f}`));
let sumsOk = true;
try { execFileSync("sha256sum", ["-c", "SHA256SUMS.txt", "--quiet"], { cwd: path.join(workDir, "x") }); } catch { sumsOk = false; }
check("`sha256sum -c SHA256SUMS.txt` valida todos los ficheros del paquete", sumsOk);
const man = JSON.parse(readFileSync(path.join(workDir, "x/MANIFEST.json"), "utf8"));
check("MANIFEST: caso, investigador, entorno y verificación de integridad", man.case.investigator === "Agente 1" && man.environment.timezone && man.evidence.every((e) => e.integrityVerified) && man.schema === "RASTRO-CAPTURE/2");
check("MANIFEST: cada evidencia lleva origen (URL, plataforma, usuario) y fecha UTC + local", man.evidence.filter((e) => e.kind !== "source-data").every((e) => e.source?.platform === "Instagram" && e.createdAt && e.createdLocal));
check("los nombres de archivo del ZIP son únicos", new Set(man.evidence.map((e) => e.path)).size === man.evidence.length);
const report = await context.newPage();
const cspErrors = [];
report.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
await report.goto(`file://${path.join(workDir, "x/INFORME.html")}`);
await report.waitForTimeout(800);
const imgs = await report.evaluate(() => [...document.images].map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute("src") })));
check(`el informe HTML carga todas sus imágenes desde el paquete (${imgs.length})`, imgs.length >= 4 && imgs.every((i) => i.ok), JSON.stringify(imgs.filter((i) => !i.ok)));
check("el informe no infringe su propia política CSP", cspErrors.length === 0, cspErrors.join("; "));
const reportText = await report.textContent("body");
check("el informe muestra ficha de la publicación, hashtags, huellas y verificación", /Publicación de prueba|Publicación ABC123/.test(reportText) && /#osint/.test(reportText) && /verificado al exportar/.test(reportText) && /EV-0001/.test(reportText));
await report.close();
rmSync(workDir, { recursive: true, force: true });
await panel.close();

// ------------------------------------------------------------------ Instagram: perfil
section("Instagram · perfil con carga infinita, selección, descarga masiva y lote");
await igPage.goto("https://www.instagram.com/usuario_prueba/", { waitUntil: "load" });
await igPage.waitForTimeout(1500);
panel = await openPanel(await tabIdFor("https://www.instagram.com/*"));
await click(panel, "#analyze");
let posts = await panel.$$eval("#postList .post-item", (n) => n.length);
check("el perfil muestra las 6 primeras publicaciones con sus datos de API", posts === 6, `${posts}`);
const profileText = await panel.textContent("#analysis");
check("ficha de la cuenta: seguidores, publicaciones y biografía", /1500|1\.2K|1,2/.test(profileText) || /Seguidores/.test(profileText), profileText.slice(0, 250));
await panel.fill("#loadMax", "12");
await click(panel, "#loadMore");
posts = await panel.$$eval("#postList .post-item", (n) => n.length);
check("«Cargar más contenido» desplaza y detecta las 12 publicaciones", posts === 12, `${posts} · ${(await status(panel)).text}`);
const withData = await panel.$$eval("#postList .post-item", (n) => n.filter((x) => !/sin datos/.test(x.textContent)).length);
check("las 12 publicaciones tienen datos de medios (no solo miniatura)", withData === 12, `${withData}`);
await click(panel, "#selectAllPosts");
await click(panel, "#downloadPostsMedia");
st = await status(panel);
ev = await evidence(panel);
const mediaP = ev.filter((e) => e.kind.startsWith("media") && /^P\d+$/.test(e.details.postId));
const mediaTotalBefore = ev.filter((e) => e.kind.startsWith("media")).length;
check("descarga masiva: 18 archivos (3 carruseles×3, 3 reels, 6 imágenes) sin errores", mediaP.length === 18 && /0 con error/.test(st.text), `${mediaP.length} · ${st.text}`);
const byPost = {};
for (const e of mediaP) byPost[e.details.postId] = (byPost[e.details.postId] || 0) + 1;
check("cada archivo queda vinculado a su publicación (carpeta y postKey)", Object.keys(byPost).length === 12 && mediaP.every((e) => e.zipPath.includes(`/${e.details.postId}/`) && e.details.postKey));
check("todas las publicaciones quedan marcadas como descargadas", (await panel.$$eval("#postList .post-item", (n) => n.filter((x) => /descargada/.test(x.textContent)).length)) === 12);
await click(panel, "#downloadPostsMedia");
st = await status(panel);
check("repetir la descarga no duplica nada (todo omitido)", /0 guardados, 18 omitidos/.test(st.text) && (await evidence(panel)).filter((e) => e.kind.startsWith("media")).length === mediaTotalBefore, st.text);

await click(panel, "#selectNonePosts");
await panel.check('[data-post="Instagram:P002"]');
await panel.check('[data-post="Instagram:P003"]');
const before = (await evidence(panel)).length;
await click(panel, "#capturePostsBatch");
st = await status(panel);
ev = await evidence(panel);
check("lote «abrir y capturar»: navega, captura cada publicación y vuelve al perfil", /Lote terminado/.test(st.text) && ev.length > before && igPage.url().endsWith("/usuario_prueba/"), `${st.text} · url=${igPage.url()}`);
const batchShots = ev.filter((e) => e.kind === "screenshot-post" && /P00[23]/.test(e.source?.url || e.filename));
check("el lote guarda una captura por cada publicación seleccionada", batchShots.length >= 2, `${batchShots.length}`);
await click(panel, "#capturePage");
ev = await evidence(panel);
check("Página completa del perfil (scroll de ventana) termina sin error", !/error/.test((await status(panel)).kind), (await status(panel)).text);
check("el panel no produjo errores de JavaScript", panel.errors.length === 0, panel.errors.join("; "));
await panel.close();

// ------------------------------------------------------------------ TikTok
section("TikTok · vídeo (CDN que exige Referer) y perfil");
const ttPage = await context.newPage();
await ttPage.goto("https://www.tiktok.com/@tiktok_user/video/7000000000000000001", { waitUntil: "load" });
await ttPage.waitForTimeout(1200);
requestLog.length = 0;
panel = await openPanel(await tabIdFor("https://www.tiktok.com/*"));
await click(panel, "#analyze");
const ttText = await panel.textContent("#analysis");
check("TikTok: detecta usuario, vídeo y descripción desde el JSON embebido", /tiktok_user/.test(ttText) && /7000000000000000001/.test(ttText) && /osint/.test(ttText), ttText.slice(0, 250));
const ttMedia = await panel.$$eval("#mediaList .media-item", (n) => n.map((x) => x.textContent));
check("TikTok: ofrece el vídeo y la portada", ttMedia.some((r) => /Vídeo/.test(r)) && ttMedia.some((r) => /portada|cover/i.test(r)), ttMedia.join(" | "));
await click(panel, "#downloadAllMedia");
st = await status(panel);
ev = await evidence(panel);
check("TikTok: el vídeo se descarga (el CDN respondería 403 sin Referer)", ev.some((e) => e.kind === "media-video" && e.size > 10000), st.text);
const extRequests = requestLog.filter((r) => r.host.includes("tiktokcdn") && r.path.startsWith("/video/tos/"));
check("las peticiones de descarga al CDN de TikTok llevan Referer de tiktok.com", extRequests.length > 0 && extRequests.every((r) => r.referer.startsWith("https://www.tiktok.com/")), JSON.stringify(extRequests.slice(0, 2)));
await click(panel, "#captureVisible");
await panel.close();
await ttPage.goto("https://www.tiktok.com/@tiktok_user", { waitUntil: "load" });
await ttPage.waitForTimeout(1200);
panel = await openPanel(await tabIdFor("https://www.tiktok.com/*"));
await click(panel, "#analyze");
posts = await panel.$$eval("#postList .post-item", (n) => n.length);
check("TikTok perfil: 8 vídeos detectados desde item_list", posts === 8, `${posts}`);
await click(panel, "#selectAllPosts");
await click(panel, "#downloadPostsMedia");
ev = await evidence(panel);
check("TikTok perfil: descarga los vídeos seleccionados", ev.filter((e) => e.kind === "media-video").length >= 8, (await status(panel)).text);
await panel.close();

// ------------------------------------------------------------------ Web genérica
section("Web genérica · imágenes (incl. perezosas), vídeo y página completa con cabecera fija");
const webPage = await context.newPage();
await webPage.goto("https://news.example-web.test/article", { waitUntil: "load" });
await webPage.waitForTimeout(800);
panel = await openPanel(await tabIdFor("https://news.example-web.test/*"));
await click(panel, "#analyze");
const webMedia = await panel.$$eval("#mediaList .media-item", (n) => n.map((x) => x.textContent));
check("web: detecta imágenes normales, perezosa (data-src), og:image y el vídeo <source>", webMedia.length >= 4 && webMedia.some((r) => /Vídeo/.test(r)), `${webMedia.length}: ${webMedia.join(" | ")}`);
check("web: sin recursos falsos de la URL de la página", !webMedia.some((r) => /example-web\.test\/article/.test(r)));
await click(panel, "#downloadAllMedia");
ev = await evidence(panel);
const webEv = ev.filter((e) => e.source?.platform === "Web");
check("web: descarga imágenes y vídeo validados", webEv.filter((e) => e.kind === "media-image").length >= 3 && webEv.filter((e) => e.kind === "media-video").length === 1, (await status(panel)).text);
await click(panel, "#capturePage");
ev = await evidence(panel);
const webShot = sumBy(ev, "screenshot-page").filter((e) => e.source?.platform === "Web")[0];
const webH = await webPage.evaluate(() => document.documentElement.scrollHeight);
check(`web: captura de página completa con scroll de ventana (${webShot?.details.pixelHeight}px ≈ ${webH}px)`, Boolean(webShot) && Math.abs(webShot.details.pixelHeight - webH) <= 3 && webShot.details.scrollMode === "window", JSON.stringify(webShot?.details));
await panel.close();

// ------------------------------------------------------------------ Página muy larga (varias partes)
section("Página de 24 000 px · división automática en partes y unión sin costuras");
await webPage.goto("https://news.example-web.test/long", { waitUntil: "load" });
await webPage.waitForTimeout(500);
panel = await openPanel(await tabIdFor("https://news.example-web.test/*"));
await click(panel, "#analyze");
const before2 = (await evidence(panel)).length;
await click(panel, "#capturePage");
ev = await evidence(panel);
const longParts = ev.slice(before2).filter((e) => e.kind === "screenshot-page").sort((a, b) => a.details.part - b.details.part);
const longH = await webPage.evaluate(() => document.documentElement.scrollHeight);
check(`se divide en varias partes (${longParts.length}) de como máximo 14 000 px`, longParts.length >= 2 && longParts.every((p) => p.details.pixelHeight <= 14000), longParts.map((p) => p.details.pixelHeight).join(","));
check(`la suma de las partes coincide con la altura de la página (${longParts.reduce((n, p) => n + p.details.pixelHeight, 0)} ≈ ${longH})`, Math.abs(longParts.reduce((n, p) => n + p.details.pixelHeight, 0) - longH) <= 3);
check("cada parte sabe cuántas partes forman la captura", longParts.every((p) => p.details.parts === longParts.length));
let offset = 0, badBlocks = 0, checkedBlocks = 0;
const wanted = new Map();
for (let i = 0; i < 200; i++) wanted.set(40 + i * 120 + 60, [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256]);
for (const part of longParts) {
  const { data, info } = await sharp(await blobBytes(panel, part.id)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const [y, rgb] of wanted) {
    if (y < offset || y >= offset + info.height) continue;
    const i = ((y - offset) * info.width + 10) * 3;
    checkedBlocks++;
    if (Math.abs(data[i] - rgb[0]) > 2 || Math.abs(data[i + 1] - rgb[1]) > 2 || Math.abs(data[i + 2] - rgb[2]) > 2) badBlocks++;
  }
  offset += info.height;
}
check(`los 200 bloques de color están en su sitio exacto, incluida la costura entre partes (${checkedBlocks} comprobados)`, checkedBlocks === 200 && badBlocks === 0, `mal=${badBlocks} comprobados=${checkedBlocks}`);
await panel.close();

// ------------------------------------------------------------------ Resultado
console.log(`\nResultado: ${results.pass} correctas, ${results.fail} fallidas`);
if (results.fail) console.log("Fallos:\n - " + results.failures.join("\n - "));
await env.close();
rmSync(extCopy, { recursive: true, force: true });
process.exit(results.fail ? 1 : 0);
