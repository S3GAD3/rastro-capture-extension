// src/panel/context.js · datos del expediente, perfil institucional y entorno (almacenamiento local del navegador)
// Dos ámbitos separados para no arrastrar datos de una investigación a otra:
//   - rastroInstitution (+ rastroInstitutionLogo): preferencias institucionales REUTILIZABLES entre sesiones.
//   - rastroCaptureCase: datos ESPECÍFICOS del expediente en curso; se vacían al iniciar una sesión nueva.
export const CASE_KEY = "rastroCaptureCase";
export const INSTITUTION_KEY = "rastroInstitution";
export const LOGO_KEY = "rastroInstitutionLogo";

const EMPTY_CASE = { reference: "", proceedings: "", name: "", observations: "" };
const EMPTY_INSTITUTION = { unit: "", department: "", investigatorId: "", place: "", keepLogo: true };
const str = (v, max) => String(v ?? "").slice(0, max);

export async function loadCase() {
  const { [CASE_KEY]: c } = await chrome.storage.local.get(CASE_KEY);
  return { ...EMPTY_CASE, reference: str(c?.reference, 80), proceedings: str(c?.proceedings, 80), name: str(c?.name, 160), observations: str(c?.observations, 6000) };
}
export async function saveCase(data) {
  const next = { reference: str(data.reference, 80).trim(), proceedings: str(data.proceedings, 80).trim(), name: str(data.name, 160).trim(), observations: str(data.observations, 6000).trim() };
  await chrome.storage.local.set({ [CASE_KEY]: next });
  return next;
}

/** Perfil institucional. Si procede de la v0.4.0 (unidad e investigador guardados en el expediente), se adopta una sola vez. */
export async function loadInstitution() {
  const { [INSTITUTION_KEY]: inst, [CASE_KEY]: legacy } = await chrome.storage.local.get([INSTITUTION_KEY, CASE_KEY]);
  if (!inst && (legacy?.unit || legacy?.investigator)) {
    const adopted = { ...EMPTY_INSTITUTION, unit: str(legacy.unit, 160), investigatorId: str(legacy.investigator, 120) };
    await chrome.storage.local.set({ [INSTITUTION_KEY]: adopted });
    return adopted;
  }
  return { ...EMPTY_INSTITUTION, unit: str(inst?.unit, 160), department: str(inst?.department, 160), investigatorId: str(inst?.investigatorId, 120), place: str(inst?.place, 160), keepLogo: inst?.keepLogo !== false };
}
export async function saveInstitution(data) {
  const next = { unit: str(data.unit, 160).trim(), department: str(data.department, 160).trim(), investigatorId: str(data.investigatorId, 120).trim(), place: str(data.place, 160).trim(), keepLogo: data.keepLogo !== false };
  await chrome.storage.local.set({ [INSTITUTION_KEY]: next });
  return next;
}
export async function loadLogo() {
  const { [LOGO_KEY]: logo } = await chrome.storage.local.get(LOGO_KEY);
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo || "") ? logo : "";
}
export const saveLogo = (dataUrl) => chrome.storage.local.set({ [LOGO_KEY]: dataUrl });
export const removeLogo = () => chrome.storage.local.remove(LOGO_KEY);

export const environment = () => ({
  userAgent: navigator.userAgent, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  utcOffsetMinutes: -new Date().getTimezoneOffset(), screen: `${screen.width}x${screen.height}`, extensionVersion: chrome.runtime.getManifest().version
});

// ------------------------------------------------------------------ Imágenes
const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("No se pudo decodificar la imagen.")); img.src = src; });

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); });
}

function drawScaled(source, width, height, maxDim, background) {
  const scale = Math.min(1, maxDim / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d", { alpha: !background });
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/**
 * Convierte el archivo elegido por el investigador (PNG, JPG o SVG) en un PNG rasterizado de como máximo 600 px.
 * El logotipo NUNCA se guarda ni se incrusta en su forma original: se decodifica como imagen (un SVG cargado así no
 * ejecuta scripts ni carga recursos externos) y se vuelve a codificar desde un lienzo, lo que descarta metadatos,
 * scripts y contenido activo.
 */
export async function sanitizeLogoFile(file) {
  if (!file) throw new Error("No se ha seleccionado ningún archivo.");
  if (file.size > MAX_LOGO_BYTES) throw new Error("El logotipo supera 5 MB. Usa una imagen más ligera.");
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const isPng = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
  const isJpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  const text = new TextDecoder().decode(head).replace(/^﻿/, "").trimStart().toLowerCase();
  const isSvg = !isPng && !isJpeg && (text.startsWith("<svg") || (text.startsWith("<?xml") || text.startsWith("<!--") || text.startsWith("<!doctype svg")) && /<svg[\s>]/.test(new TextDecoder().decode(new Uint8Array(await file.slice(0, 4096).arrayBuffer())).toLowerCase()));
  if (!isPng && !isJpeg && !isSvg) throw new Error("Formato no admitido. El logotipo debe ser PNG, JPG o SVG.");
  const typed = new Blob([file], { type: isPng ? "image/png" : isJpeg ? "image/jpeg" : "image/svg+xml" });
  const url = URL.createObjectURL(typed);
  try {
    const img = await loadImage(url);
    const width = img.naturalWidth || 512, height = img.naturalHeight || 512;
    if (width < 16 || height < 16) throw new Error("La imagen es demasiado pequeña para usarla como logotipo.");
    return { dataUrl: drawScaled(img, width, height, 600).toDataURL("image/png"), width, height, format: isPng ? "PNG" : isJpeg ? "JPG" : "SVG (rasterizado)" };
  } finally { URL.revokeObjectURL(url); }
}

/** Aplana una imagen (data: URI) sobre fondo blanco y la codifica como JPEG (necesario para el PDF). */
export async function toJpegDataUrl(dataUrl, { maxDim = 500, background = "#ffffff", quality = 0.9 } = {}) {
  if (!dataUrl) return "";
  try { const img = await loadImage(dataUrl); return drawScaled(img, img.naturalWidth, img.naturalHeight, maxDim, background).toDataURL("image/jpeg", quality); }
  catch { return ""; }
}

/** Vista previa reducida (JPEG) de una imagen de evidencia. Es una representación DERIVADA para los informes. */
export async function imagePreview(blob, maxDim = 1100) {
  if (!blob || !/^image\//.test(blob.type) || blob.size > 80 * 1024 * 1024) return "";
  try {
    const bitmap = await createImageBitmap(blob);
    // Las capturas por tramos pueden ser muy altas: se limita la anchura a maxDim y la altura a 1,6 × maxDim.
    const scale = Math.min(1, maxDim / bitmap.width, (maxDim * 1.6) / bitmap.height);
    const canvas = drawScaled(bitmap, bitmap.width, bitmap.height, Math.max(bitmap.width, bitmap.height) * scale, "#ffffff");
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch { return ""; }
}

/** Fotograma de referencia (JPEG) de un vídeo de evidencia. Mejor esfuerzo: si el navegador no puede decodificarlo, devuelve "". */
export async function videoPreview(blob, maxDim = 900, timeoutMs = 5000) {
  if (!blob || blob.size > 400 * 1024 * 1024) return "";
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true; video.preload = "auto"; video.playsInline = true;
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(""), timeoutMs);
      const grab = () => {
        try {
          if (!video.videoWidth) { clearTimeout(timer); resolve(""); return; }
          const out = drawScaled(video, video.videoWidth, video.videoHeight, maxDim, "#000000").toDataURL("image/jpeg", 0.8);
          clearTimeout(timer); resolve(out);
        } catch { clearTimeout(timer); resolve(""); }
      };
      video.addEventListener("error", () => { clearTimeout(timer); resolve(""); }, { once: true });
      video.addEventListener("loadeddata", () => {
        if (Number.isFinite(video.duration) && video.duration > 0.6) { video.addEventListener("seeked", grab, { once: true }); video.currentTime = Math.min(0.5, video.duration / 2); }
        else grab();
      }, { once: true });
      video.src = url;
    });
  } finally { video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url); }
}

let rastroLogoCache = "";
/** Logotipo de RASTRO CAPTURE incrustable (data: URI JPEG), leído de los recursos de la propia extensión. */
export async function rastroLogoDataUrl() {
  if (!rastroLogoCache) rastroLogoCache = await blobToDataUrl(await (await fetch(chrome.runtime.getURL("assets/rastro-capture-logo-report.jpg"))).blob());
  return rastroLogoCache;
}
