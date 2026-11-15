// RASTRO CAPTURE · verificador independiente de integridad (página de la extensión)
// Abre un ZIP exportado, una carpeta extraída o un conjunto de archivos con su manifiesto, recalcula los
// SHA-256 y los compara con los declarados. Todo se procesa localmente; no usa la sesión de captura.
import { openZip } from "./src/lib/zipReader.js";
import { sha256Blob } from "./src/lib/sha256.js";
import { verifyPackage, unreadablePackage, verificationReportHtml, STATE, STATE_LABELS } from "./src/lib/verify.js";
import { formatLocal, formatBytes } from "./src/lib/paths.js";
import { rastroLogoDataUrl } from "./src/panel/context.js";

const $ = (selector) => document.querySelector(selector);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const version = chrome.runtime.getManifest().version;
$("#ver").textContent = `RASTRO CAPTURE v${version}`;
let last = null;
let running = false;

function progress(done, total, text) {
  $("#working").hidden = false;
  $("#workFill").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  $("#workText").textContent = text;
}

const ROW_CLASS = { [STATE.OK]: "ok", [STATE.HASH]: "bad", [STATE.MISSING]: "bad", [STATE.EXTRA]: "warn", [STATE.READ]: "bad", [STATE.MANIFEST]: "bad" };

function render(result, source) {
  last = { result, source };
  $("#working").hidden = true;
  $("#result").hidden = false;
  $("#verdict").className = `verdict ${result.status}`;
  $("#verdict").textContent = result.statusLabel;
  $("#counts").innerHTML = Object.values(STATE).map((s) => `<span class="pill ${result.counts[s] ? ROW_CLASS[s] : ""}">${esc(STATE_LABELS[s])}: ${result.counts[s] || 0}</span>`).join("");
  const m = result.manifest, z = result.zip;
  const row = (k, v, mono = false) => `<tr><th>${esc(k)}</th><td${mono ? ' class="mono"' : ""}>${esc(v)}</td></tr>`;
  $("#summary").innerHTML = [
    row("Origen examinado", source), row("Fecha y hora de la verificación", `${formatLocal(result.verifiedAt)} · ${result.verifiedAt} UTC`),
    result.reason ? row("Motivo", result.reason) : "",
    m ? row("Manifiesto", `${m.path} · esquema ${m.schema}`) + row("SHA-256 del manifiesto examinado", m.sha256, true) + row("Paquete generado", `${m.generatedAt} UTC · ${m.tool?.name || ""} ${m.tool?.version || ""}`) + row("Sesión / referencia / diligencias", `${m.sessionId || "—"} / ${m.reference || "—"} / ${m.proceedings || "—"}`) + row("Evidencias declaradas", m.evidenceCount) : "",
    z ? row("SHA-256 del ZIP (calculado)", z.sha256, true) + row("Archivo .sha256 del ZIP", z.sidecar ? (z.sidecar.match ? "COINCIDE con la huella calculada" : `NO COINCIDE · declarado ${z.sidecar.expected}`) : "No aportado: no se ha comparado la huella del paquete completo") : "",
    row("Archivos examinados", result.total)
  ].join("");
  $("#detail").hidden = !result.items.length;
  $("#rows").innerHTML = result.items.map((it, i) => `<tr class="${ROW_CLASS[it.state]}"><td>${i + 1}</td><td>${esc(it.code)}</td><td>${esc(it.path)}${it.size === null || it.size === undefined ? "" : `<br><span class="muted">${esc(formatBytes(it.size))}</span>`}</td><td><span class="res">${esc(STATE_LABELS[it.state])}</span>${it.detail ? `<br><span class="muted">${esc(it.detail)}</span>` : ""}</td><td class="mono">${it.expected ? `Declarado: ${esc(it.expected)}<br>` : ""}${it.actual ? `Calculado: ${esc(it.actual)}` : ""}</td></tr>`).join("");
  $("#result").scrollIntoView({ block: "start" });
}

async function run(source, task) {
  if (running) return;
  running = true;
  $("#result").hidden = true; $("#detail").hidden = true;
  try { render(await task(), source); }
  catch (error) { console.error(error); render(unreadablePackage(error?.message || String(error)), source); }
  finally { running = false; }
}

async function verifyZip(zipFile, sidecarFile) {
  progress(0, 1, `Calculando el SHA-256 de ${zipFile.name}…`);
  const zip = { name: zipFile.name, size: zipFile.size, sha256: await sha256Blob(zipFile), sidecar: null };
  if (sidecarFile) {
    const expected = (await sidecarFile.text()).match(/[0-9a-fA-F]{64}/)?.[0]?.toLowerCase() || "";
    zip.sidecar = { name: sidecarFile.name, expected: expected || "(el archivo no contiene un SHA-256)", match: Boolean(expected) && expected === zip.sha256 };
  }
  let entries;
  try { entries = await openZip(zipFile); }
  catch (error) { return unreadablePackage(`No se pudo abrir el ZIP: ${error?.message || error}`, { path: zipFile.name, zip }); }
  const result = await verifyPackage(entries.map((e) => ({ path: e.path, size: e.size, read: e.read })), { zip, onProgress: (done, total, path) => progress(done, total, `Comprobando ${done}/${total}: ${path}`) });
  if (zip.sidecar && !zip.sidecar.match && result.status === "integro") { result.status = "incidencias"; result.statusLabel = "CON INCIDENCIAS: los archivos coinciden con el manifiesto, pero el SHA-256 del ZIP no coincide con el archivo .sha256 aportado"; }
  return result;
}

function handleSelection(fileList, kind) {
  const files = [...fileList];
  if (!files.length) return;
  const zipFile = files.find((f) => /\.zip$/i.test(f.name));
  if (kind !== "dir" && zipFile) {
    const sidecar = files.find((f) => /\.sha256$/i.test(f.name));
    run(`ZIP: ${zipFile.name}${sidecar ? ` + ${sidecar.name}` : ""}`, () => verifyZip(zipFile, sidecar));
    return;
  }
  const list = files.map((f) => ({ path: kind === "dir" ? f.webkitRelativePath || f.name : f.name, size: f.size, read: async () => f }));
  const label = kind === "dir" ? `Carpeta: ${(files[0].webkitRelativePath || "").split("/")[0] || "seleccionada"} (${files.length} archivos)` : `Archivos sueltos (${files.length})`;
  run(label, () => verifyPackage(list, { onProgress: (done, total, path) => progress(done, total, `Comprobando ${done}/${total}: ${path}`) }));
}

for (const [button, input, kind] of [["#pickZip", "#zipInput", "zip"], ["#pickDir", "#dirInput", "dir"], ["#pickFiles", "#filesInput", "files"]]) {
  $(button).addEventListener("click", () => $(input).click());
  $(input).addEventListener("change", (event) => { handleSelection(event.target.files, kind); event.target.value = ""; });
}
const drop = $("#drop");
for (const type of ["dragenter", "dragover"]) drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add("over"); });
for (const type of ["dragleave", "drop"]) drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove("over"); });
drop.addEventListener("drop", (event) => handleSelection(event.dataTransfer?.files || [], "zip"));
// Evita que el navegador abra el archivo si se suelta fuera de la zona prevista.
for (const type of ["dragover", "drop"]) window.addEventListener(type, (event) => event.preventDefault());

$("#saveReport").addEventListener("click", async () => {
  if (!last) return;
  const html = verificationReportHtml(last.result, { rastroLogo: await rastroLogoDataUrl().catch(() => ""), toolVersion: version, localTime: formatLocal(last.result.verifiedAt), source: last.source });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  try { await chrome.downloads.download({ url, filename: `RASTRO-CAPTURE/verificacion_${last.result.verifiedAt.replace(/[-:]/g, "").slice(0, 15)}Z.html`, conflictAction: "uniquify", saveAs: false }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 120_000); }
});
