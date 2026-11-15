// RASTRO CAPTURE · visor de informes
// Lee la sesión activa del almacén local, recalcula los hashes y muestra el informe elegido dentro de un
// marco aislado (sin permiso de scripts). Permite imprimir (el navegador ofrece «Guardar como PDF») y
// descargar el informe como HTML autónomo o como PDF generado localmente.
import { collectSession, renderReport } from "./src/panel/packager.js";
import * as store from "./src/lib/store.js";
import { safeName } from "./src/lib/paths.js";

const $ = (selector) => document.querySelector(selector);
const state = $("#state");
const frame = $("#frame");
const buttons = { print: $("#print"), saveHtml: $("#saveHtml"), savePdf: $("#savePdf"), refresh: $("#refresh") };
const NAMES = { tecnico: "informe_tecnico", resumido: "informe_resumido" };
let mode = new URLSearchParams(location.search).get("mode") === "resumido" ? "resumido" : "tecnico";
let collected = null;
let html = "";
let frameUrl = "";

function setState(text, error = false) { state.textContent = text; state.className = error ? "state error" : "state"; }
function setEnabled(on) { for (const b of Object.values(buttons)) b.disabled = !on; buttons.refresh.disabled = false; }

function show() {
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("is-on", b.dataset.mode === mode));
  if (!collected) return;
  html = renderReport(collected, mode, "html");
  if (frameUrl) URL.revokeObjectURL(frameUrl);
  frameUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  frame.src = frameUrl;
  const m = collected.manifest;
  document.title = `${mode === "resumido" ? "Informe resumido" : "Informe técnico"} · ${m.case.proceedings || m.case.reference || m.session.id}`;
  setState(`${m.evidence.length} evidencias · ${collected.bad ? `${collected.bad} con huella NO coincidente` : "hashes comprobados"} · sesión ${m.session.id}`, Boolean(collected.bad));
}

async function load() {
  setEnabled(false); buttons.refresh.disabled = true;
  setState("Leyendo la sesión y comprobando hashes…");
  try {
    collected = await collectSession({ onProgress: (fraction, text) => setState(`${text} (${Math.round(fraction * 100)} %)`) });
    if (!collected.manifest.evidence.length) { frame.removeAttribute("src"); setState("La sesión no contiene evidencias. Captura algo y pulsa Actualizar.", true); buttons.refresh.disabled = false; return; }
    show();
    setEnabled(true);
  } catch (error) { console.error(error); setState(`No se pudo generar el informe: ${error.message}`, true); buttons.refresh.disabled = false; }
}

function fileBase() {
  const m = collected.manifest;
  return `${NAMES[mode]}_${safeName(m.case.reference || m.case.proceedings || m.session.id, "sesion", 60)}`;
}
async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try { await chrome.downloads.download({ url, filename: `RASTRO-CAPTURE/${filename}`, conflictAction: "uniquify", saveAs: true }); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 120_000); }
}

document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.mode; history.replaceState(null, "", `?mode=${mode}`); show(); }));
buttons.print.addEventListener("click", () => { try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (error) { setState(`No se pudo abrir la impresión: ${error.message}`, true); } });
buttons.saveHtml.addEventListener("click", async () => {
  try { await download(new Blob([html], { type: "text/html" }), `${fileBase()}.html`); await store.addLog("Informe descargado", { detail: `${NAMES[mode]}.html`, url: "" }); }
  catch (error) { setState(`Descarga cancelada o fallida: ${error.message}`, true); }
});
buttons.savePdf.addEventListener("click", async () => {
  try { await download(new Blob([renderReport(collected, mode, "pdf")], { type: "application/pdf" }), `${fileBase()}.pdf`); await store.addLog("Informe descargado", { detail: `${NAMES[mode]}.pdf`, url: "" }); }
  catch (error) { setState(`No se pudo generar o descargar el PDF: ${error.message}`, true); }
});
buttons.refresh.addEventListener("click", load);
window.addEventListener("pagehide", () => { if (frameUrl) URL.revokeObjectURL(frameUrl); });

await load();
