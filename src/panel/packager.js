// src/panel/packager.js · reúne la sesión, comprueba la integridad y compone el paquete de evidencias
// Lo usan el panel (exportación ZIP) y el visor de informes. Todo el proceso es local.
import * as store from "../lib/store.js";
import { sha256Blob, sha256Hex, utf8Bytes } from "../lib/sha256.js";
import { createZipBlob } from "../lib/zipWriter.js";
import { safeName, EVIDENCE_ROOT } from "../lib/paths.js";
import { buildManifest, buildReportModel, renderReportHtml, inventoryCsv, postsCsv, logCsv, readmeText } from "../lib/report.js";
import { renderReportPdf } from "../lib/pdf.js";
import { loadCase, loadInstitution, loadLogo, environment, imagePreview, videoPreview, toJpegDataUrl, rastroLogoDataUrl } from "./context.js";

export const packageName = (caseData, date = new Date()) =>
  `RASTRO_CAPTURE_${safeName(caseData.reference || caseData.proceedings || "SIN-REFERENCIA", "SIN-REFERENCIA", 60)}_${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z.zip`;

/**
 * Lee la sesión local, recalcula el SHA-256 de cada evidencia y prepara manifiesto y recursos gráficos.
 * @returns {{manifest, assets, files:Array<{path,blob,sha256}>, bad:number, name:string, session}}
 */
export async function collectSession({ onProgress = () => {}, checkCancel = () => {}, previews = true, logAlert = async () => {}, name = "" } = {}) {
  const [caseData, institution, session, items] = await Promise.all([loadCase(), loadInstitution(), store.ensureSession(), store.listEvidence()]);
  const files = [];
  const previewMap = {};
  let bad = 0;
  const imageCount = items.filter((e) => /^(screenshot|media-image)/.test(e.kind)).length;
  const maxDim = imageCount <= 40 ? 1100 : imageCount <= 150 ? 640 : 320;
  for (let i = 0; i < items.length; i++) {
    checkCancel();
    const item = items[i];
    const blob = item.hasBlob ? await store.getBlob(item.id) : null;
    if (!blob) { item.integrityVerified = false; item.blobMissing = true; bad++; await logAlert(`${item.code} ${item.filename}: el contenido no está en el almacén local.`, item.code); continue; }
    const hash = await sha256Blob(blob);
    item.integrityVerified = hash === item.sha256;
    if (!item.integrityVerified) { bad++; await logAlert(`${item.code} ${item.filename}: hash actual ${hash} ≠ registrado ${item.sha256}`, item.code); }
    files.push({ path: `${EVIDENCE_ROOT}/${item.zipPath}`, blob, sha256: hash });
    if (previews) {
      const preview = /^(screenshot|media-image)/.test(item.kind) ? await imagePreview(blob, maxDim) : /^(media-video|recording)$/.test(item.kind) ? await videoPreview(blob, Math.min(maxDim, 900)) : "";
      if (preview) previewMap[item.code] = preview;
    }
    onProgress((i + 1) / items.length, `Verificando ${i + 1}/${items.length}`);
  }
  const saved = await store.kvGet("catalog");
  const catalog = { posts: saved?.posts || [], accounts: saved?.accounts || [] };
  const log = await store.listLog();
  const generatedAt = new Date();
  const zipName = name || packageName(caseData, generatedAt);
  const manifest = buildManifest({ caseData, institution, session, environment: environment(), evidence: items, catalog, log, generatedAt: generatedAt.toISOString(), packageName: zipName });
  const institutionLogo = await loadLogo();
  const assets = { institutionLogo, institutionLogoJpeg: await toJpegDataUrl(institutionLogo), rastroLogo: await rastroLogoDataUrl().catch(() => ""), previews: previewMap };
  return { manifest, assets, files, bad, name: zipName, session, catalog, log };
}

/** Genera un informe a partir de una sesión recogida. `format`: "html" | "pdf". */
export function renderReport(collected, mode, format = "html") {
  const model = buildReportModel(collected.manifest, mode, { previewCodes: Object.keys(collected.assets.previews) });
  if (format === "pdf") return renderReportPdf(model, collected.assets, { createdAt: new Date(collected.manifest.generatedAt) }).bytes;
  return renderReportHtml(model, collected.assets);
}

/**
 * Compone el ZIP autocontenido. No modifica los archivos de evidencia. Devuelve el Blob y su SHA-256.
 * Estructura: <raíz>/{evidencias,informes,registros,metadatos}/… + README_EVIDENCIAS.txt
 */
export async function buildPackage(collected, { includePdf = true, onProgress = () => {} } = {}) {
  const { manifest, files, catalog, log, name } = collected;
  const root = `${name.replace(/\.zip$/i, "")}/`;
  const filesByPost = {};
  for (const e of manifest.evidence) if (e.details?.postKey) (filesByPost[e.details.postKey] ||= []).push(e.code);
  const docs = [];
  const doc = (path, role, mime, content) => docs.push({ path, role, mime, bytes: typeof content === "string" ? utf8Bytes(content) : content });
  doc("informes/informe_tecnico.html", "Informe técnico completo (HTML autónomo)", "text/html", renderReport(collected, "tecnico"));
  doc("informes/informe_resumido.html", "Informe resumido para diligencias (HTML autónomo)", "text/html", renderReport(collected, "resumido"));
  let pdfError = "";
  if (includePdf) {
    try {
      doc("informes/informe_tecnico.pdf", "Informe técnico completo (PDF)", "application/pdf", renderReport(collected, "tecnico", "pdf"));
      doc("informes/informe_resumido.pdf", "Informe resumido para diligencias (PDF)", "application/pdf", renderReport(collected, "resumido", "pdf"));
    } catch (error) { pdfError = error?.message || String(error); }
  }
  doc("registros/actividad.json", "Cronología de operaciones e incidencias", "application/json", JSON.stringify({ schema: manifest.schema, sessionId: manifest.session.id, generatedAt: manifest.generatedAt, activityLog: manifest.activityLog, incidents: manifest.incidents }, null, 2));
  doc("registros/actividad.csv", "Cronología de operaciones (CSV)", "text/csv", logCsv(manifest.activityLog));
  doc("registros/evidencias.csv", "Inventario de evidencias (CSV)", "text/csv", inventoryCsv(manifest.evidence));
  if (catalog.posts.length) doc("registros/publicaciones.csv", "Publicaciones detectadas (CSV)", "text/csv", postsCsv(catalog.posts, filesByPost));
  doc("README_EVIDENCIAS.txt", "Instrucciones del paquete y de verificación", "text/plain", readmeText(manifest, { zipName: name, hasPdf: includePdf && !pdfError }));

  manifest.documents = [];
  for (const d of docs) { d.sha256 = await sha256Hex(d.bytes); manifest.documents.push({ path: d.path, role: d.role, fileClass: "derivado", mime: d.mime, size: d.bytes.length, sha256: d.sha256 }); }
  const manifestBytes = utf8Bytes(JSON.stringify(manifest, null, 2));
  const sums = [...files.map((f) => `${f.sha256}  ${f.path}`), ...docs.map((d) => `${d.sha256}  ${d.path}`), `${await sha256Hex(manifestBytes)}  metadatos/manifest.json`];
  const entries = [
    { path: `${root}README_EVIDENCIAS.txt`, bytes: docs.find((d) => d.path === "README_EVIDENCIAS.txt").bytes },
    { path: `${root}metadatos/manifest.json`, bytes: manifestBytes },
    { path: `${root}metadatos/SHA256SUMS.txt`, bytes: utf8Bytes(`${sums.join("\n")}\n`) },
    ...docs.filter((d) => d.path !== "README_EVIDENCIAS.txt").map((d) => ({ path: root + d.path, bytes: d.bytes })),
    ...files.map((f) => ({ path: root + f.path, blob: f.blob }))
  ];
  const { blob } = await createZipBlob(entries, (n, total) => onProgress(n / total, `Empaquetando ${n}/${total}`));
  return { blob, name, sha256: await sha256Blob(blob), pdfError, entryCount: entries.length };
}
