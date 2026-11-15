import { sha256Blob } from "./src/lib/sha256.js";
import { validateMediaBytes } from "./src/lib/mediaValidation.js";
import * as store from "./src/lib/store.js";
import { safeName, formatLocal } from "./src/lib/paths.js";

const $ = (selector) => document.querySelector(selector);
const els = { targetTitle: $("#targetTitle"), targetUrl: $("#targetUrl"), status: $("#status"), start: $("#start"), stop: $("#stop"), recording: $("#recording"), timer: $("#timer"), result: $("#result"), preview: $("#preview"), fileName: $("#fileName"), filePath: $("#filePath"), hash: $("#hash") };
let targetTab = null;
let stream = null;
let recorder = null;
let chunks = [];
let startedAt = 0;
let timerId = null;
let finalizing = false;
let previewUrl = "";

function setStatus(kind, message) {
  els.status.className = `status ${kind}`;
  els.status.querySelector("p").textContent = message;
}

function platformFor(url) {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)tiktok\.com$/i.test(host)) return "TikTok";
    if (/(^|\.)instagram\.com$/i.test(host)) return "Instagram";
  } catch { /* URL no válida */ }
  return "Web";
}

const mimeType = () => ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) || "";

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  els.timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function chooseDesktopSource() {
  return new Promise((resolve, reject) => {
    chrome.desktopCapture.chooseDesktopMedia(["tab", "audio"], (streamId, options) => {
      const error = chrome.runtime.lastError;
      if (error) { reject(new Error(error.message)); return; }
      if (!streamId) { reject(new DOMException("Selección de pestaña cancelada.", "NotAllowedError")); return; }
      resolve({ streamId, canRequestAudioTrack: Boolean(options?.canRequestAudioTrack) });
    });
  });
}

async function selectTabStream() {
  const { streamId, canRequestAudioTrack } = await chooseDesktopSource();
  const desktopSource = { chromeMediaSource: "desktop", chromeMediaSourceId: streamId };
  return navigator.mediaDevices.getUserMedia({
    video: { mandatory: { ...desktopSource, maxWidth: 1920, maxHeight: 1920, maxFrameRate: 30 } },
    audio: canRequestAudioTrack ? { mandatory: desktopSource } : false
  });
}

async function startRecording() {
  if (!chrome.desktopCapture?.chooseDesktopMedia || !navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) throw new Error("Este navegador no ofrece la API desktopCapture necesaria.");
  setStatus("busy", "Abriendo el selector nativo… elige la pestaña objetivo.");
  const selected = await selectTabStream();
  const videoTrack = selected.getVideoTracks()[0];
  if (!videoTrack) throw new Error("El navegador no proporcionó una pista de vídeo.");
  stream = selected;
  chunks = [];
  startedAt = Date.now();
  const type = mimeType();
  recorder = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 5_000_000 } : undefined);
  recorder.addEventListener("dataavailable", (event) => { if (event.data?.size) chunks.push(event.data); });
  recorder.addEventListener("error", (event) => setStatus("error", event.error?.message || "La grabación se ha interrumpido."));
  videoTrack.addEventListener("ended", () => finalizeRecording().catch(recordingFailed), { once: true });
  recorder.start(1000);
  els.start.disabled = true;
  els.stop.disabled = false;
  els.recording.hidden = false;
  updateTimer();
  timerId = setInterval(updateTimer, 1000);
  setStatus("ready", `Grabando ${videoTrack.label || "la pestaña seleccionada"}. Usa Dejar de compartir para terminar y guardar.`);
  await store.addLog("Grabación iniciada", { url: targetTab?.url || "", detail: videoTrack.label || "pestaña seleccionada" }).catch(() => {});
  await chrome.action.setBadgeBackgroundColor({ color: "#c44757" }).catch(() => {});
  await chrome.action.setBadgeText({ text: "REC" }).catch(() => {});
  setTimeout(async () => {
    if (!targetTab?.id) return;
    await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
    await chrome.windows.update(targetTab.windowId, { focused: true }).catch(() => {});
  }, 500);
}

async function downloadBlob(blob, relativePath, reference) {
  const objectUrl = URL.createObjectURL(blob);
  const ref = safeName(reference || "sin-referencia", "sin-referencia", 60);
  const id = await chrome.downloads.download({ url: objectUrl, filename: `RASTRO-CAPTURE/${ref}/${relativePath}`, conflictAction: "uniquify", saveAs: false });
  const matches = await chrome.downloads.search({ id });
  setTimeout(() => URL.revokeObjectURL(objectUrl), 300_000);
  return matches[0]?.filename || `Descargas/RASTRO-CAPTURE/${ref}/${relativePath}`;
}

async function finalizeRecording() {
  if (finalizing || !recorder) return;
  finalizing = true;
  clearInterval(timerId);
  els.stop.disabled = true;
  setStatus("busy", "Finalizando el WebM, calculando SHA-256 y guardando…");
  if (recorder.state !== "inactive") {
    const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.stop();
    await stopped;
  }
  const endedAt = Date.now();
  const hasAudio = Boolean(stream?.getAudioTracks().length);
  stream?.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: "video/webm" });
  if (!blob.size) throw new Error("La grabación está vacía.");
  const head = new Uint8Array(await blob.slice(0, 4096).arrayBuffer());
  if (validateMediaBytes(head, { kind: "vídeo directo", contentType: recorder.mimeType }).mime !== "video/webm") throw new Error("El grabador no produjo un contenedor WebM válido.");
  const sha256 = await sha256Blob(blob);
  const { rastroCaptureCase } = await chrome.storage.local.get("rastroCaptureCase");
  const platform = platformFor(targetTab?.url);
  let host = "pestana";
  try { host = new URL(targetTab.url).hostname; } catch { /* sin URL */ }
  const source = { url: targetTab?.url || "", canonicalUrl: targetTab?.url || "", title: targetTab?.title || "", platform, pageKind: "recording", contentType: "navegación grabada", contentId: "", username: "" };
  const record = await store.addEvidence({
    kind: "recording", slug: `${platform}_${host}_grabacion`, extension: ".webm", sha256, thumb: "", mime: "video/webm", note: "",
    case: rastroCaptureCase || {}, source, utcOffsetMinutes: -new Date().getTimezoneOffset(), createdLocal: formatLocal(new Date().toISOString(), -new Date().getTimezoneOffset()),
    details: { startedAt: new Date(startedAt).toISOString(), endedAt: new Date(endedAt).toISOString(), durationSeconds: Math.round((endedAt - startedAt) / 1000), hasAudio, note: "WebM generado por MediaRecorder; sin tabla de búsqueda interna (no permite saltos en algunos reproductores)." }
  }, blob);
  let path = "Guardada en el expediente; la copia de Descargas no pudo crearse.";
  try { path = await downloadBlob(blob, record.zipPath, rastroCaptureCase?.reference); await store.updateEvidence(record.id, { details: { downloadPath: path } }); }
  catch (error) { path += ` (${error.message})`; await store.addLog("Aviso: copia en Descargas no creada", { url: source.url, detail: `${record.code}: ${error.message}`, level: "warn", code: record.code }).catch(() => {}); }
  await store.addLog("Grabación de pestaña", { url: source.url, detail: `${record.filename} · ${Math.round((endedAt - startedAt) / 1000)} s`, code: record.code }).catch(() => {});
  const channel = new BroadcastChannel("rastro-capture-evidence");
  channel.postMessage({ type: "updated" });
  channel.close();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  els.preview.src = previewUrl;
  els.fileName.textContent = `${record.code} · ${record.filename}`;
  els.filePath.textContent = path;
  els.hash.textContent = sha256;
  els.result.hidden = false;
  els.recording.hidden = true;
  await chrome.action.setBadgeText({ text: "" }).catch(() => {});
  setStatus("ready", `Grabación guardada como ${record.code}. Ubicación: ${path}`);
  recorder = null; stream = null; chunks = []; finalizing = false;
  els.start.disabled = false;
}

function showError(error) {
  console.error(error);
  finalizing = false;
  els.start.disabled = false;
  els.stop.disabled = true;
  els.recording.hidden = true;
  clearInterval(timerId);
  stream?.getTracks().forEach((track) => track.stop());
  setStatus("error", error?.name === "NotAllowedError" ? "Grabación cancelada o no autorizada. Vuelve a intentarlo y selecciona la pestaña objetivo." : (error?.message || String(error)));
}

/** Fallo durante la grabación: consta como incidencia de la sesión (una cancelación del selector no lo es). */
function recordingFailed(error) {
  if (error?.name !== "NotAllowedError") store.addLog("Error de grabación", { url: targetTab?.url || "", detail: error?.message || String(error), level: "error" }).catch(() => {});
  showError(error);
}
els.start.addEventListener("click", () => startRecording().catch(recordingFailed));
els.stop.addEventListener("click", () => finalizeRecording().catch(recordingFailed));
window.addEventListener("beforeunload", (event) => { if (recorder?.state === "recording") event.preventDefault(); });

document.querySelector("#version").textContent = `v${chrome.runtime.getManifest().version}`;
const tabId = Number(new URL(location.href).searchParams.get("tabId"));
if (!Number.isInteger(tabId) || !tabId) {
  showError(new Error("No se ha recibido una pestaña objetivo válida. Cierra esta ventana y abre el grabador desde RASTRO CAPTURE."));
} else {
  chrome.tabs.get(tabId).then((tab) => {
    targetTab = tab;
    els.targetTitle.textContent = tab.title || "Pestaña sin título";
    els.targetUrl.textContent = tab.url || "";
  }).catch(showError);
}
