// Pruebas end-to-end de RASTRO CAPTURE en Chromium real (ver README de tests).
// Conserva las comprobaciones de la v0.4.0 (captura, descarga, perfiles, lote) y añade las de la v0.5.0:
// interfaz, sesión, personalización institucional, paquete autocontenido, informes HTML/PDF, visor y verificador.
// Uso:  PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs xvfb-run -a node run.mjs
import { launch } from "./harness.mjs";
import { requestLog } from "./server.mjs";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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
// Capturas de pantalla e informes generados durante las pruebas (para revisión manual).
const artifacts = process.env.RASTRO_E2E_ARTIFACTS || path.join(os.tmpdir(), "rastro-e2e-artifacts");
mkdirSync(artifacts, { recursive: true });

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
// La interfaz tiene cuatro secciones y paneles plegables: se muestra la que contiene el control antes de usarlo.
const reveal = (panel, selector) => panel.evaluate((sel) => {
  const el = document.querySelector(sel);
  const view = el?.closest(".view");
  if (view?.hidden) document.querySelector(`.tab[data-tab="${view.dataset.view}"]`).click();
  for (let fold = el?.closest("details"); fold; fold = fold.parentElement?.closest("details")) fold.open = true;
}, selector);
const click = async (panel, selector) => {
  await reveal(panel, selector);
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

// ------------------------------------------------------------------ Interfaz, sesión y personalización institucional
section("Interfaz · logotipo oficial, cuatro secciones, sesión activa y personalización institucional");
{
  const ui = await panel.evaluate(() => ({
    logo: (() => { const i = document.querySelector(".brand-logo"); return i.complete && i.naturalWidth > 0 && /rastro-capture-mark/.test(i.src); })(),
    title: document.querySelector(".brand-copy").textContent, footer: document.querySelector("footer").textContent,
    tabs: [...document.querySelectorAll(".tab")].map((t) => t.dataset.tab), session: document.querySelector("#sessionId").textContent,
    count: document.querySelector("#sessionEvidenceCount").textContent, unit: document.querySelector("#caseUnit").value, tip: document.querySelector("#caseInvestigator").value, ref: document.querySelector("#caseRef").value
  }));
  check("el logotipo oficial RASTRO CAPTURE se carga en la cabecera", ui.logo);
  check("identidad «RASTRO CAPTURE — Kit RASTRO» y pie «Creado por S3GAD3»", /RASTRO\s*CAPTURE/.test(ui.title) && /Kit RASTRO/.test(ui.title) && /Creado por S3GAD3/.test(ui.footer) && /v0\.5\.0/.test(ui.footer), ui.footer);
  check("cuatro secciones: Captura, Evidencias, Informes y Configuración", ui.tabs.join() === "captura,evidencias,informes,config");
  check("la sesión activa muestra identificador único y número de evidencias", /^RC-\d{8}-\d{6}-[0-9A-F]{6}$/.test(ui.session) && Number(ui.count) === (await evidence(panel)).length, `${ui.session} · ${ui.count}`);
  check("los datos de unidad e investigador de la v0.4.0 se adoptan como perfil institucional", ui.unit === "Unidad X" && ui.tip === "Agente 1" && ui.ref === "EXP-2026-014", JSON.stringify(ui));

  await reveal(panel, "#logoChoose");
  await panel.setInputFiles("#logoFile", path.join(here, "../fixtures/escudo-con-script.svg"));
  await panel.waitForFunction(() => document.querySelector("#logoPreview img")?.naturalWidth > 0, null, { timeout: 10000 });
  let stored = await sw.evaluate(async () => (await chrome.storage.local.get("rastroInstitutionLogo")).rastroInstitutionLogo || "");
  check("un SVG se rasteriza a PNG al cargarlo (nunca se guarda con contenido activo) y su script no se ejecuta", /^data:image\/png;base64,/.test(stored) && !(await panel.evaluate(() => "__svgPwned" in window)), stored.slice(0, 40));
  await panel.setInputFiles("#logoFile", { name: "falso.png", mimeType: "image/png", buffer: Buffer.from("<html>esto no es una imagen</html>") });
  await panel.waitForFunction(() => /status-error/.test(document.querySelector("#status").className), null, { timeout: 10000 });
  check("un archivo que no es PNG, JPG ni SVG se rechaza con un mensaje claro", /Formato no admitido/.test((await status(panel)).text), (await status(panel)).text);
  await panel.setInputFiles("#logoFile", path.join(here, "../fixtures/escudo-ficticio.png"));
  await panel.waitForFunction(() => /PNG ·/.test(document.querySelector("#logoInfo").textContent), null, { timeout: 10000 });
  stored = await sw.evaluate(async () => (await chrome.storage.local.get("rastroInstitutionLogo")).rastroInstitutionLogo || "");
  const preview = await panel.evaluate(() => { const i = document.querySelector("#logoPreview img"); return { ok: i?.naturalWidth > 0, w: i?.naturalWidth, h: i?.naturalHeight, remove: !document.querySelector("#logoRemove").hidden, label: document.querySelector("#logoChoose").textContent }; });
  check("el escudo institucional (PNG) se carga, se visualiza y puede cambiarse o eliminarse", preview.ok && preview.w === 400 && preview.remove && /Cambiar/.test(preview.label) && /^data:image\/png;base64,/.test(stored), JSON.stringify(preview));
  await panel.fill("#caseUnit", "Unidad Ficticia de Investigación Tecnológica");
  await panel.fill("#instDepartment", "Grupo de Ciberinteligencia (ejemplo)");
  await panel.fill("#instPlace", "Ciudad de Ejemplo");
  await panel.fill("#caseInvestigator", "TIP 000000 (ficticio)");
  await panel.fill("#caseProceedings", "DP 0000/2026 (ficticias)");
  await panel.fill("#caseObservations", "Observación manual de prueba: publicación localizada mediante búsqueda abierta.");
  await panel.waitForTimeout(600);
  const saved = await sw.evaluate(() => chrome.storage.local.get(["rastroInstitution", "rastroCaptureCase"]));
  check("la configuración institucional y los datos del expediente se guardan por separado y en local", saved.rastroInstitution.department === "Grupo de Ciberinteligencia (ejemplo)" && saved.rastroCaptureCase.proceedings === "DP 0000/2026 (ficticias)" && !("unit" in saved.rastroCaptureCase) && !("proceedings" in saved.rastroInstitution), JSON.stringify(saved));

  await reveal(panel, "#evidenceList");
  const rows = await panel.$$eval("#evidenceList .evidence-item", (n) => n.map((x) => ({ hash: x.querySelector("code").textContent, text: x.textContent })));
  check("la sección Evidencias lista cada archivo con tamaño, fecha, clase y SHA-256 completo", rows.length === ev.length && rows.every((r) => /^[0-9a-f]{64}$/.test(r.hash) && /(B|KB|MB) · \d{4}-\d{2}-\d{2}/.test(r.text) && /(Original|Captura generada|Derivado)/.test(r.text)), `${rows.length}/${ev.length}`);
  const shotId = sumBy(ev, "screenshot-visible")[0].id;
  await panel.click(`.evidence-item[data-id="${shotId}"] [data-act="note"]`);
  await panel.fill(`.evidence-item[data-id="${shotId}"] .note-editor textarea`, "Nota manual de prueba sobre la captura visible.");
  await panel.click(`.evidence-item[data-id="${shotId}"] .note-editor button`);
  await panel.waitForFunction((id) => /Nota manual de prueba/.test(document.querySelector(`.evidence-item[data-id="${id}"]`)?.textContent || ""), shotId);
  check("se puede añadir una observación a una evidencia ya capturada", (await evidence(panel)).find((e) => e.id === shotId).note === "Nota manual de prueba sobre la captura visible.");
  await click(panel, "#checkIntegrity");
  st = await status(panel);
  const chips = await panel.$$eval("#evidenceList .chip-ok", (n) => n.length);
  check("«Comprobar hashes» recalcula el SHA-256 de todos los archivos locales y coincide", /Integridad local comprobada/.test(st.text) && chips === ev.length, `${st.text} · ${chips}`);
}

// ------------------------------------------------------------------ Exportación
section("Exportación del paquete de evidencias autocontenido");
await click(panel, "#exportPackage");
st = await status(panel);
check("la exportación verifica todos los hashes", /todas verificadas/.test(st.text), st.text);
const exported = await panel.evaluate(async () => {
  const b64 = async (blob) => { const u = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode(...u.subarray(k, k + 0x8000)); return btoa(s); };
  const z = window.__zips.find((x) => x.name.endsWith(".zip")); const h = window.__zips.find((x) => x.name.endsWith(".zip.sha256"));
  return { name: z.name, b64: await b64(z.blob), sidecarName: h?.name || "", sidecar: h ? await h.blob.text() : "", shown: document.querySelector("#exportResult").textContent };
});
const workDir = mkdtempSync(path.join(os.tmpdir(), "rastro-zip-"));
const zipName = path.basename(exported.name);
const zipPath = path.join(workDir, zipName);
writeFileSync(zipPath, Buffer.from(exported.b64, "base64"));
const zipSha = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
check("el nombre del paquete identifica la herramienta y la referencia", /^RASTRO_CAPTURE_EXP-2026-014_\d{8}T\d{6}Z\.zip$/.test(zipName), zipName);
check("el SHA-256 del ZIP se entrega en un archivo .sha256 independiente y coincide con los bytes del ZIP", exported.sidecarName.endsWith(`${zipName}.sha256`) && exported.sidecar === `${zipSha}  ${zipName}\n` && exported.shown.includes(zipSha), exported.sidecar);
writeFileSync(path.join(workDir, `${zipName}.sha256`), exported.sidecar);
execFileSync("unzip", ["-q", zipName, "-d", "x"], { cwd: workDir });
const rootName = zipName.replace(/\.zip$/, "");
const pkgDir = path.join(workDir, "x", rootName);
const listing = execFileSync("find", [".", "-type", "f"], { cwd: pkgDir }).toString().split("\n").filter(Boolean).map((f) => f.slice(2));
check("el ZIP contiene una única carpeta raíz con el nombre del paquete", readdirSync(path.join(workDir, "x")).join() === rootName);
for (const f of ["README_EVIDENCIAS.txt", "metadatos/manifest.json", "metadatos/SHA256SUMS.txt", "informes/informe_tecnico.html", "informes/informe_resumido.html", "informes/informe_tecnico.pdf", "informes/informe_resumido.pdf", "registros/actividad.json", "registros/actividad.csv", "registros/evidencias.csv"]) check(`el paquete contiene ${f}`, listing.includes(f));
check("no hay archivos fuera de evidencias/, informes/, registros/, metadatos/ y el README", listing.every((f) => /^(evidencias|informes|registros|metadatos)\//.test(f) || f === "README_EVIDENCIAS.txt"), listing.filter((f) => !/^(evidencias|informes|registros|metadatos)\//.test(f)).join());
let sumsOk = true;
try { execFileSync("sha256sum", ["-c", "metadatos/SHA256SUMS.txt", "--quiet"], { cwd: pkgDir }); } catch { sumsOk = false; }
check("`sha256sum -c metadatos/SHA256SUMS.txt` valida todos los ficheros del paquete", sumsOk);
let sidecarOk = true;
try { execFileSync("sha256sum", ["-c", `${zipName}.sha256`, "--quiet"], { cwd: workDir }); } catch { sidecarOk = false; }
check("`sha256sum -c <paquete>.zip.sha256` valida el ZIP completo", sidecarOk);
const man = JSON.parse(readFileSync(path.join(pkgDir, "metadatos/manifest.json"), "utf8"));
check("MANIFEST: esquema 3, sesión, caso, investigador, entorno y verificación de integridad", man.schema === "RASTRO-CAPTURE/3" && /^RC-/.test(man.session.id) && man.case.investigator === "TIP 000000 (ficticio)" && man.case.proceedings === "DP 0000/2026 (ficticias)" && man.environment.timezone && man.evidence.every((e) => e.integrityVerified));
check("MANIFEST: cada evidencia lleva origen (URL, plataforma, usuario) y fecha UTC + local", man.evidence.filter((e) => e.kind !== "source-data").every((e) => e.source?.platform === "Instagram" && e.createdAt && e.createdLocal));
check("MANIFEST: identificador, ruta relativa, tamaño, MIME, SHA-256, URL de origen, método, advertencias y clase de cada evidencia", man.evidence.every((e) => e.id && e.code && e.path.startsWith("evidencias/") && Number.isInteger(e.size) && e.mime && /^[0-9a-f]{64}$/.test(e.sha256) && e.sourceUrl && e.captureMethod && Array.isArray(e.warnings) && ["original", "captura", "derivado"].includes(e.fileClass) && e.sessionId === man.session.id));
check("MANIFEST: declara los documentos derivados (informes, registros, README) con su hash", man.documents.length >= 8 && man.documents.every((d) => d.fileClass === "derivado" && /^[0-9a-f]{64}$/.test(d.sha256) && listing.includes(d.path)));
check("los nombres de archivo del ZIP son únicos", new Set(man.evidence.map((e) => e.path)).size === man.evidence.length);
const sameBytes = [];
for (const e of man.evidence) { const disk = createHash("sha256").update(readFileSync(path.join(pkgDir, e.path))).digest("hex"); const local = createHash("sha256").update(await blobBytes(panel, e.id)).digest("hex"); sameBytes.push(disk === e.sha256 && local === e.sha256 && statSync(path.join(pkgDir, e.path)).size === e.size); }
check(`los ${man.evidence.length} archivos del paquete son idénticos byte a byte a los capturados (sin modificar)`, sameBytes.every(Boolean));
check("las evidencias descargadas del servidor son los bytes originales del origen", (() => { const v = man.evidence.find((e) => e.kind === "media-video"); return createHash("sha256").update(readFileSync(path.join(here, "fixtures/video1.mp4"))).digest("hex") === v.sha256 && v.fileClass === "original"; })());
const activity = JSON.parse(readFileSync(path.join(pkgDir, "registros/actividad.json"), "utf8"));
check("registros/actividad.json permite reconstruir la secuencia de operaciones", activity.activityLog.length >= man.evidence.length && ["Sesión iniciada", "Análisis", "Captura visible", "Exportación", "Comprobación de hashes", "Nota de evidencia modificada"].every((a) => activity.activityLog.some((l) => l.action === a)) && activity.activityLog.every((l, i, arr) => !i || arr[i - 1].at <= l.at), [...new Set(activity.activityLog.map((l) => l.action))].join(" | "));
const readme = readFileSync(path.join(pkgDir, "README_EVIDENCIAS.txt"), "utf8");
check("README_EVIDENCIAS.txt explica la organización y el método de verificación", /ORGANIZACIÓN DEL PAQUETE/.test(readme) && /sha256sum -c metadatos\/SHA256SUMS\.txt/.test(readme) && readme.includes(`${zipName}.sha256`) && /informe_tecnico\.pdf/.test(readme));
const secrets = listing.filter((f) => !/\.(png|jpg|mp4|webm|pdf)$/.test(f)).map((f) => readFileSync(path.join(pkgDir, f), "utf8")).join("\n");
check("el paquete no contiene cookies ni credenciales de la sesión del navegador", !/sessionid=|csrftoken|Set-Cookie|"cookie"\s*:|Authorization:/i.test(secrets));

const offline = [];
for (const [file, mode] of [["informe_tecnico.html", "tecnico"], ["informe_resumido.html", "resumido"]]) {
  const report = await context.newPage();
  const cspErrors = [], requests = [];
  report.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) cspErrors.push(m.text()); });
  report.on("request", (r) => { if (!/^(file|data):/.test(r.url())) requests.push(r.url()); });
  await report.goto(`file://${path.join(pkgDir, "informes", file)}`);
  await report.waitForTimeout(700);
  const info = await report.evaluate(() => ({
    imgs: [...document.images].map((i) => ({ ok: i.complete && i.naturalWidth > 0, data: i.src.startsWith("data:"), alt: i.alt })), scripts: document.scripts.length,
    crestTop: document.querySelector(".doc-head .crest img")?.getBoundingClientRect().top, rastroTop: document.querySelector(".doc-foot img")?.getBoundingClientRect().top,
    h2: [...document.querySelectorAll("h2")].map((h) => h.textContent), text: document.body.textContent,
    tags: { A: document.querySelectorAll(".o-A").length, M: document.querySelectorAll(".o-M").length, I: document.querySelectorAll(".o-I").length }, basis: [...document.querySelectorAll(".basis")].map((b) => b.textContent),
    links: [...document.querySelectorAll('a[href^="../evidencias/"]')].map((a) => a.getAttribute("href"))
  }));
  offline.push(info);
  check(`${file}: se abre sin conexión, sin peticiones de red ni scripts, y cumple su CSP`, requests.length === 0 && cspErrors.length === 0 && info.scripts === 0, `${requests.join()} ${cspErrors.join()}`);
  check(`${file}: todas las imágenes van incrustadas (${info.imgs.length}) y se visualizan`, info.imgs.length >= 2 && info.imgs.every((i) => i.ok && i.data), JSON.stringify(info.imgs.filter((i) => !i.ok)));
  check(`${file}: escudo institucional arriba y logotipo RASTRO CAPTURE en el pie`, info.imgs.some((i) => /Escudo/.test(i.alt)) && info.imgs.some((i) => i.alt === "RASTRO CAPTURE") && info.crestTop < 200 && info.rastroTop > info.crestTop + 300, `${info.crestTop} / ${info.rastroTop}`);
  check(`${file}: muestra unidad, diligencias, sesión, hashes y observación manual`, /Unidad Ficticia de Investigación Tecnológica/.test(info.text) && /DP 0000\/2026 \(ficticias\)/.test(info.text) && info.text.includes(man.session.id) && man.evidence.every((e) => info.text.includes(e.sha256)) && /Observación manual de prueba/.test(info.text));
  if (mode === "tecnico") {
    check("informe técnico: nueve secciones en orden", info.h2.map((h) => h.slice(0, 2)).join("") === "1.2.3.4.5.6.7.8.9.", info.h2.join(" | "));
    check("informe técnico: ficha de la publicación, hashtags, huellas y verificación", /Publicación ABC123 de prueba/.test(info.text) && /#osint/.test(info.text) && /Coincide/.test(info.text) && /EV-0001/.test(info.text));
    check("informe técnico: separa datos automáticos, manuales e inferidos, y fundamenta las inferencias", info.tags.A > 10 && info.tags.M >= 6 && info.tags.I >= 2 && info.basis.some((b) => /nombre de host/.test(b)) && /Nota manual de prueba/.test(info.text), JSON.stringify(info.tags));
    check("informe técnico: el anexo incluye vistas previas de capturas, imágenes y un fotograma del vídeo", info.imgs.filter((i) => /Vista previa/.test(i.alt)).length >= 6 && info.imgs.some((i) => i.alt === `Vista previa de ${man.evidence.find((e) => e.kind === "media-video").code}`), `${info.imgs.filter((i) => /Vista previa/.test(i.alt)).length}`);
    const broken = info.links.filter((href) => !existsSync(path.join(pkgDir, "informes", decodeURIComponent(href))));
    check(`informe técnico: los ${info.links.length} enlaces a los archivos originales apuntan a ficheros del paquete`, info.links.length >= man.evidence.length && broken.length === 0, broken.join());
  } else {
    check("informe resumido: secciones de actuación, recurso, operaciones, archivos, incidencias y paquete", ["Datos de la actuación", "Recurso o perfil examinado", "Operaciones realizadas", "Relación de archivos", "Incidencias relevantes", "Paquete de evidencias"].every((t) => info.h2.some((h) => h.includes(t))) && info.text.includes(zipName), info.h2.join(" | "));
  }
  if (mode === "tecnico") await report.screenshot({ path: path.join(artifacts, "informe_tecnico_pantalla.png"), fullPage: false });
  await report.close();
}
check("el informe resumido es más breve que el técnico", offline[1].text.length < offline[0].text.length * 0.6, `${offline[1].text.length} vs ${offline[0].text.length}`);

for (const file of ["informe_tecnico.pdf", "informe_resumido.pdf"]) {
  const pdfPath = path.join(pkgDir, "informes", file);
  let qpdf = "", info = "", text = "";
  try { qpdf = execFileSync("qpdf", ["--check", pdfPath], { stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) { qpdf = `ERROR ${e.stdout || ""}${e.stderr || ""}`; }
  try { info = execFileSync("pdfinfo", [pdfPath]).toString(); text = execFileSync("pdftotext", ["-layout", pdfPath, "-"]).toString(); } catch (e) { info = `ERROR ${e.message}`; }
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1] || 0);
  check(`${file}: PDF válido (qpdf), A4, ${pages} páginas con «Página n de N» en todas`, /No syntax or stream encoding errors/.test(qpdf) && /A4/.test(info) && pages >= 1 && Array.from({ length: pages }, (_, i) => text.includes(`Página ${i + 1} de ${pages}`)).every(Boolean), qpdf.slice(0, 200));
  check(`${file}: contiene unidad, diligencias y los hashes de las evidencias`, /UNIDAD FICTICIA/.test(text) && /DP 0000\/2026/.test(text) && man.evidence.every((e) => text.replace(/\s+/g, "").includes(e.sha256) || text.includes(e.sha256.slice(0, 24))));
  const images = execFileSync("pdfimages", ["-list", pdfPath]).toString().split("\n").filter((l) => /jpeg/.test(l)).length;
  check(`${file}: escudo y logotipo incrustados (${images} imágenes)`, images >= 2);
  cpSync(pdfPath, path.join(artifacts, file));
}
cpSync(path.join(pkgDir, "informes/informe_tecnico.html"), path.join(artifacts, "informe_tecnico.html"));
cpSync(path.join(pkgDir, "informes/informe_resumido.html"), path.join(artifacts, "informe_resumido.html"));

// ------------------------------------------------------------------ Visor de informes
section("Visor de informes · HTML autónomo, PDF e impresión");
{
  const viewer = await context.newPage();
  const errors = [], csp = [];
  viewer.on("pageerror", (e) => errors.push(e.message));
  viewer.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await viewer.goto(`chrome-extension://${extId}/report.html?mode=tecnico`);
  await viewer.waitForFunction(() => !document.querySelector("#print").disabled, null, { timeout: 60000 });
  await viewer.evaluate(() => { window.__dl = []; chrome.downloads.download = async (o) => { window.__dl.push({ name: o.filename, blob: await (await fetch(o.url)).blob() }); return 1; }; window.__printed = 0; });
  const frame = viewer.frameLocator("#frame");
  await frame.locator("h1.doc-title").waitFor({ timeout: 15000 });
  const title = await frame.locator("h1.doc-title").textContent();
  const styled = await frame.locator("h2").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  const crest = await frame.locator(".doc-head .crest img").evaluate((i) => i.naturalWidth);
  check("el visor muestra el informe técnico con estilos y escudo dentro de un marco sin scripts", /INFORME TÉCNICO/.test(title) && styled === "rgb(11, 31, 63)" && crest > 0 && (await viewer.getAttribute("#frame", "sandbox")) === "allow-same-origin allow-modals", `${title} ${styled}`);
  await viewer.click("#modeResumido");
  await frame.locator("h1.doc-title", { hasText: "INFORME RESUMIDO" }).waitFor({ timeout: 15000 });
  check("el visor cambia al informe resumido con los mismos datos", (await frame.locator("body").textContent()).includes(man.session.id));
  await viewer.click("#savePdf"); await viewer.click("#saveHtml");
  await viewer.waitForFunction(() => window.__dl.length === 2, null, { timeout: 20000 });
  const dl = await viewer.evaluate(async () => Promise.all(window.__dl.map(async (d) => ({ name: d.name, head: new TextDecoder("latin1").decode(new Uint8Array(await d.blob.slice(0, 15).arrayBuffer())), size: d.blob.size }))));
  check("el visor descarga el informe como PDF y como HTML autónomo", dl.some((d) => /informe_resumido_.*\.pdf$/.test(d.name) && d.head.startsWith("%PDF-1.4")) && dl.some((d) => /informe_resumido_.*\.html$/.test(d.name) && d.head.startsWith("<!doctype html>")), JSON.stringify(dl));
  await viewer.evaluate(() => { document.querySelector("#frame").contentWindow.print = () => { window.__printed++; }; });
  await viewer.click("#print");
  check("«Imprimir / Guardar como PDF» invoca la impresión del informe (no de la barra del visor)", (await viewer.evaluate(() => window.__printed)) === 1);
  check("el visor no produce errores de JavaScript ni infracciones de CSP", errors.length === 0 && csp.length === 0, [...errors, ...csp].join("; "));
  await viewer.close();
}

// ------------------------------------------------------------------ Verificador independiente
section("Verificar integridad · ZIP, carpeta, archivos modificados, ausentes y adicionales");
{
  const verifier = await context.newPage();
  const errors = [];
  verifier.on("pageerror", (e) => errors.push(e.message));
  await verifier.goto(`chrome-extension://${extId}/verify.html`);
  await verifier.evaluate(() => { window.__dl = []; chrome.downloads.download = async (o) => { window.__dl.push({ name: o.filename, text: await (await fetch(o.url)).text() }); return 1; }; });
  const verdict = async () => { await verifier.waitForFunction(() => !document.querySelector("#result").hidden && document.querySelector("#working").hidden, null, { timeout: 120000 }); return verifier.evaluate(() => ({ cls: document.querySelector("#verdict").className, text: document.querySelector("#verdict").textContent, summary: document.querySelector("#summary").textContent, counts: document.querySelector("#counts").textContent, rows: [...document.querySelectorAll("#rows tr")].map((r) => r.textContent) })); };
  const reset = () => verifier.evaluate(() => { document.querySelector("#result").hidden = true; });

  await verifier.setInputFiles("#zipInput", [zipPath, path.join(workDir, `${zipName}.sha256`)]);
  let v = await verdict();
  const expectedFiles = man.evidence.length + man.documents.length + 1;
  check(`ZIP exportado: resultado global ÍNTEGRO con ${expectedFiles} coincidencias correctas`, /integro/.test(v.cls) && v.rows.length === expectedFiles && v.rows.every((r) => /Coincidencia correcta/.test(r)) && new RegExp(`Coincidencia correcta: ${expectedFiles}`).test(v.counts), `${v.text} · ${v.rows.length}`);
  check("ZIP exportado: la huella del ZIP coincide con su archivo .sha256", /COINCIDE con la huella calculada/.test(v.summary) && v.summary.includes(zipSha), v.summary.slice(0, 300));
  check("el verificador lee el manifiesto (sesión, referencia, diligencias)", v.summary.includes(man.session.id) && /EXP-2026-014/.test(v.summary) && /RASTRO-CAPTURE\/3/.test(v.summary));
  await verifier.click("#saveReport");
  await verifier.waitForFunction(() => window.__dl.length === 1);
  const vr = await verifier.evaluate(() => window.__dl[0]);
  check("genera un informe HTML de verificación con fecha, resultado global y detalle", /verificacion_\d{8}T\d{6}Z\.html$/.test(vr.name) && /ÍNTEGRO/.test(vr.text) && /Fecha y hora de la verificación/.test(vr.text) && vr.text.includes(man.evidence[0].sha256) && /No acredita la autenticidad de origen/.test(vr.text) && !/<script/i.test(vr.text));
  writeFileSync(path.join(artifacts, "informe_verificacion.html"), vr.text);

  // Carpeta extraída, sin tocar.
  await reset(); await verifier.setInputFiles("#dirInput", pkgDir);
  v = await verdict();
  check("carpeta extraída: resultado ÍNTEGRO", /integro/.test(v.cls) && v.rows.length === expectedFiles, v.text);

  // Copia manipulada: un byte cambiado, un archivo borrado y un archivo añadido.
  const tampered = path.join(workDir, "manipulado");
  cpSync(pkgDir, tampered, { recursive: true });
  const victim = man.evidence.find((e) => e.kind === "media-image"), gone = man.evidence.find((e) => e.kind === "mhtml");
  const bytes = readFileSync(path.join(tampered, victim.path)); bytes[bytes.length - 20] ^= 0x01; writeFileSync(path.join(tampered, victim.path), bytes);
  rmSync(path.join(tampered, gone.path));
  writeFileSync(path.join(tampered, "evidencias/capturas/archivo_anadido.png"), Buffer.from("no declarado"));
  await reset(); await verifier.setInputFiles("#dirInput", tampered);
  v = await verdict();
  const rowOf = (name) => v.rows.find((r) => r.includes(name)) || "";
  check("carpeta manipulada: resultado global CON INCIDENCIAS", /incidencias/.test(v.cls), v.text);
  check("identifica el archivo modificado (un solo bit) como «Hash diferente» y muestra ambas huellas", /Hash diferente/.test(rowOf(path.basename(victim.path))) && rowOf(path.basename(victim.path)).includes(victim.sha256) && /Calculado: [0-9a-f]{64}/.test(rowOf(path.basename(victim.path))));
  check("identifica el archivo borrado como «Archivo ausente»", /Archivo ausente/.test(rowOf(path.basename(gone.path))));
  check("identifica el archivo añadido como «Archivo adicional no declarado»", /Archivo adicional no declarado/.test(rowOf("archivo_anadido.png")));
  check("los archivos intactos siguen figurando como correctos", v.rows.filter((r) => /Coincidencia correcta/.test(r)).length === expectedFiles - 2 && /Hash diferente: 1/.test(v.counts) && /Archivo ausente: 1/.test(v.counts) && /adicional no declarado: 1/.test(v.counts), v.counts);

  // El paquete manipulado, recomprimido con otra herramienta (DEFLATE), frente al .sha256 original.
  execFileSync("zip", ["-q", "-r", "recomprimido.zip", "."], { cwd: tampered });
  await reset(); await verifier.setInputFiles("#zipInput", [path.join(tampered, "recomprimido.zip"), path.join(workDir, `${zipName}.sha256`)]);
  v = await verdict();
  check("ZIP recomprimido y manipulado: detecta las incidencias y que la huella del ZIP NO COINCIDE", /incidencias/.test(v.cls) && /NO COINCIDE/.test(v.summary) && /Hash diferente: 1/.test(v.counts), v.summary.slice(0, 200));

  // Archivos sueltos con su manifiesto.
  await reset(); await verifier.setInputFiles("#filesInput", [path.join(pkgDir, "metadatos/manifest.json"), ...man.evidence.slice(0, 3).map((e) => path.join(pkgDir, e.path))]);
  v = await verdict();
  check("archivos sueltos con su manifiesto: los aportados coinciden y los no aportados constan como ausentes", v.rows.filter((r) => /Coincidencia correcta/.test(r)).length === 3 && /Localizado por nombre/.test(v.rows.join()) && /incidencias/.test(v.cls), v.counts);

  // Manifiesto inválido y ZIP ilegible.
  const badDir = path.join(workDir, "invalido"); mkdirSync(path.join(badDir, "metadatos"), { recursive: true });
  writeFileSync(path.join(badDir, "metadatos/manifest.json"), "{ esto no es JSON");
  await reset(); await verifier.setInputFiles("#dirInput", badDir);
  v = await verdict();
  check("manifiesto ilegible: resultado «Manifiesto inválido» con el motivo", /manifiesto-invalido/.test(v.cls) && /JSON/.test(v.summary) && /Manifiesto inválido: 1/.test(v.counts), v.text);
  writeFileSync(path.join(workDir, "roto.zip"), readFileSync(zipPath).subarray(0, 5000));
  await reset(); await verifier.setInputFiles("#zipInput", path.join(workDir, "roto.zip"));
  v = await verdict();
  check("ZIP truncado: resultado «Error de lectura» sin bloquear la página", /error-lectura/.test(v.cls) && /Error de lectura: 1/.test(v.counts), v.text);
  check("el verificador no produce errores de JavaScript y no altera la sesión de captura", errors.length === 0 && (await evidence(panel)).length === ev.length, errors.join("; "));
  await verifier.screenshot({ path: path.join(artifacts, "verificador.png"), fullPage: true });
  await verifier.close();
}
await reveal(panel, "#exportPackage");
await panel.screenshot({ path: path.join(artifacts, "panel_informes.png"), fullPage: true });
await reveal(panel, "#evidenceList");
await panel.screenshot({ path: path.join(artifacts, "panel_evidencias.png"), fullPage: false });
await reveal(panel, "#analyze");
await panel.screenshot({ path: path.join(artifacts, "panel_captura.png"), fullPage: true });
await panel.click("#tab-config"); await panel.waitForTimeout(400);
await panel.screenshot({ path: path.join(artifacts, "panel_config.png"), fullPage: true });
check("Configuración informa del almacenamiento local y del estado de los permisos", /\d+ · [\d.]+ (KB|MB)/.test(await panel.textContent("#cfgEvidence")) && /Concedido/.test(await panel.textContent("#cfgAllSites")) && /v0\.5\.0/.test(await panel.textContent("#cfgVersion")));
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
await reveal(panel, "#loadMax");
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
await reveal(panel, "#postList");
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
// ------------------------------------------------------------------ Cancelación, integridad local alterada y sesión nueva
section("Cancelación, detección de una evidencia alterada y gestión de sesiones");
{
  const beforeCancel = (await evidence(panel)).length;
  await reveal(panel, "#capturePage");
  await panel.click("#capturePage");
  await panel.waitForFunction(() => !document.querySelector("#progress").hidden && /Tramo [2-9]/.test(document.querySelector("#progressText").textContent), null, { timeout: 60000 });
  const box = await panel.locator("#cancelTask").boundingBox();
  const clipped = await panel.evaluate(() => { const b = document.querySelector("#cancelTask").getBoundingClientRect(), p = document.querySelector("#progress").getBoundingClientRect(); return b.bottom > p.bottom + 1 || b.top < p.top - 1; });
  check("el botón Cancelar es visible y accesible durante una operación larga (en la v0.4.0 quedaba recortado)", Boolean(box) && box.height >= 20 && box.width >= 50 && !clipped, JSON.stringify(box));
  await panel.screenshot({ path: path.join(artifacts, "panel_progreso.png"), fullPage: false });
  await panel.click("#cancelTask");
  await idle(panel);
  st = await status(panel);
  const afterCancel = await evidence(panel);
  check("cancelar detiene la operación sin afectar a las evidencias ya guardadas", /cancelada/i.test(st.text) && afterCancel.length >= beforeCancel && afterCancel.slice(0, beforeCancel).every((e) => e.hasBlob), st.text);
  const logAfter = await panel.evaluate(async () => (await (await import("./src/lib/store.js")).listLog()).map((l) => [l.action, l.level]));
  check("la cancelación consta en el registro como incidencia", logAfter.some(([a, l]) => a === "Operación cancelada" && l === "warn"));

  // Un error de una captura no afecta a las anteriores: MHTML de una pestaña cerrada.
  const all = await evidence(panel);
  const victim = all.find((e) => e.kind === "media-image");
  await panel.evaluate(async (id) => {
    const store = await import("./src/lib/store.js");
    const db = await store.openDb();
    await new Promise((resolve, reject) => { const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").put({ id, blob: new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/jpeg" }) }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }, victim.id);
  await click(panel, "#checkIntegrity");
  st = await status(panel);
  const badChip = await panel.evaluate((id) => document.querySelector(`.evidence-item[data-id="${id}"]`)?.textContent || "", victim.id);
  check("«Comprobar hashes» detecta un archivo alterado en el almacén local", /1 discrepancia/.test(st.text) && /error/.test(st.kind) && /HASH NO COINCIDE/.test(badChip), st.text);
  await panel.evaluate(() => { window.__zips = []; });
  await click(panel, "#exportPackage");
  st = await status(panel);
  const z = await panel.evaluate(async () => { const zf = window.__zips.find((x) => x.name.endsWith(".zip")); const { openZip } = await import("./src/lib/zipReader.js"); const entries = await openZip(zf.blob); const read = async (suffix) => (await (await entries.find((e) => e.path.endsWith(suffix)).read()).text()); const m = JSON.parse(await read("metadatos/manifest.json")); return { status: m.evidence.map((e) => [e.id, e.integrityStatus]), incidents: m.incidents.map((i) => i.action), allVerified: m.summary.allVerified, html: await read("informes/informe_resumido.html"), pdfs: entries.filter((e) => e.path.endsWith(".pdf")).length, platforms: m.summary.platforms }; });
  check("la exportación avisa de la huella no coincidente y lo documenta en el manifiesto y en el informe", /NO coincide/.test(st.text) && /error/.test(st.kind) && z.status.find(([id]) => id === victim.id)[1] === "hash-diferente" && !z.allVerified && z.incidents.includes("Huella no coincidente") && /Huella no coincidente/.test(z.html), st.text);
  check("los errores de descarga y avisos de la sesión figuran como incidencias del paquete", z.incidents.includes("Operación cancelada") && z.pdfs === 2, z.incidents.join(" | "));
  check("una sesión puede agrupar capturas de varias plataformas", ["Instagram", "TikTok", "Web"].every((p) => z.platforms.includes(p)), z.platforms.join());

  // Aviso de mezcla de expedientes y eliminación de una evidencia.
  await panel.fill("#caseRef", "OTRO-EXP-999"); await panel.waitForTimeout(700);
  check("al cambiar la referencia con evidencias de otro expediente se muestra un aviso para no mezclarlas", !(await panel.evaluate(() => document.querySelector("#sessionWarning").hidden)) && /EXP-2026-014/.test(await panel.textContent("#sessionWarning")));
  await panel.fill("#caseRef", "EXP-2026-014"); await panel.waitForTimeout(700);
  const total = (await evidence(panel)).length;
  await reveal(panel, "#evidenceList");
  const firstId = await panel.getAttribute("#evidenceList .evidence-item", "data-id");
  await panel.click(`.evidence-item[data-id="${firstId}"] [data-act="delete"]`);
  await panel.waitForFunction((n) => Number(document.querySelector("#evidenceCount").textContent) === n - 1, total);
  const logDel = await panel.evaluate(async () => (await (await import("./src/lib/store.js")).listLog()).filter((l) => l.action === "Evidencia eliminada").length);
  check("se puede eliminar una evidencia antes de cerrar el paquete y la eliminación queda registrada", (await evidence(panel)).length === total - 1 && logDel === 1 && (await panel.textContent("#sessionEvidenceCount")) === String(total - 1));

  // Sesión nueva: se borran evidencias y datos del expediente; el perfil institucional se conserva.
  const oldSession = await panel.textContent("#sessionId");
  await click(panel, "#clearCase");
  const fresh = await panel.evaluate(async () => { const store = await import("./src/lib/store.js"); const s = await chrome.storage.local.get(["rastroInstitution", "rastroCaptureCase", "rastroInstitutionLogo"]); return { session: document.querySelector("#sessionId").textContent, count: (await store.listEvidence()).length, log: (await store.listLog()).map((l) => l.action), ref: document.querySelector("#caseRef").value, proc: document.querySelector("#caseProceedings").value, obs: document.querySelector("#caseObservations").value, unit: document.querySelector("#caseUnit").value, storedCase: s.rastroCaptureCase, storedInst: s.rastroInstitution, logo: Boolean(s.rastroInstitutionLogo), exportDisabled: document.querySelector("#exportPackage").disabled }; });
  check("«Nueva sesión» crea un identificador distinto y vacía evidencias y registro", /^RC-/.test(fresh.session) && fresh.session !== oldSession && fresh.count === 0 && fresh.log.join() === "Sesión iniciada" && fresh.exportDisabled, JSON.stringify(fresh.log));
  check("los datos del expediente no se arrastran a la sesión nueva", fresh.ref === "" && fresh.proc === "" && fresh.obs === "" && fresh.storedCase.reference === "" && fresh.storedCase.proceedings === "" && fresh.storedCase.observations === "", JSON.stringify(fresh.storedCase));
  check("el perfil institucional y el escudo se conservan para futuras sesiones", fresh.unit === "Unidad Ficticia de Investigación Tecnológica" && fresh.storedInst.department === "Grupo de Ciberinteligencia (ejemplo)" && fresh.logo);
  await click(panel, "#captureVisible");
  const one = await evidence(panel);
  check("la primera evidencia de la sesión nueva vuelve a numerarse desde EV-0001 y lleva su sesión", one.some((e) => e.code === "EV-0001") && one.every((e) => e.sessionId === fresh.session), one.map((e) => e.code).join());
  await reveal(panel, "#instKeepLogo");
  await panel.uncheck("#instKeepLogo"); await panel.waitForTimeout(500);
  await click(panel, "#clearCase");
  check("si se desmarca «conservar el escudo», se elimina al iniciar otra sesión", !(await sw.evaluate(async () => (await chrome.storage.local.get("rastroInstitutionLogo")).rastroInstitutionLogo)) && (await panel.evaluate(() => !document.querySelector("#logoPreview img"))));
  await reveal(panel, "#cfgClearAll");
  await Promise.all([panel.waitForNavigation({ timeout: 30000 }), panel.click("#cfgClearAll")]);
  await panel.waitForFunction(() => document.querySelector("#statusText")?.textContent.length > 0);
  const wiped = await sw.evaluate(async () => Object.keys(await chrome.storage.local.get(null)));
  check("«Borrar todos los datos» elimina sesión, expediente, perfil institucional y preferencias", wiped.filter((k) => k !== "rastroSettings").length === 0 && (await panel.inputValue("#caseUnit")) === "", wiped.join());
  check("el panel no produjo errores de JavaScript", panel.errors.length === 0, panel.errors.join("; "));
}
await panel.close();

// ------------------------------------------------------------------ Resultado
console.log(`\nResultado: ${results.pass} correctas, ${results.fail} fallidas`);
if (results.fail) console.log("Fallos:\n - " + results.failures.join("\n - "));
await env.close();
rmSync(extCopy, { recursive: true, force: true });
process.exit(results.fail ? 1 : 0);
