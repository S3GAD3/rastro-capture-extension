// src/lib/verify.js · verificador independiente de paquetes de evidencias
// Lógica pura (se prueba en Node). Recibe una lista de archivos con lectura diferida, localiza el manifiesto,
// recalcula el SHA-256 de cada archivo y lo compara con los valores declarados.
//
// IMPORTANTE: la verificación acredita la INTEGRIDAD de los archivos respecto del manifiesto aportado.
// No acredita la autenticidad de origen: una coincidencia de hashes no demuestra quién creó el contenido,
// cuándo se publicó ni que el propio manifiesto no haya sido sustituido junto con los archivos.
import { sha256Blob } from "./sha256.js";

export const STATE = {
  OK: "ok",
  HASH: "hash-diferente",
  MISSING: "ausente",
  EXTRA: "adicional",
  READ: "error-lectura",
  MANIFEST: "manifiesto-invalido"
};
export const STATE_LABELS = {
  [STATE.OK]: "Coincidencia correcta",
  [STATE.HASH]: "Hash diferente",
  [STATE.MISSING]: "Archivo ausente",
  [STATE.EXTRA]: "Archivo adicional no declarado",
  [STATE.READ]: "Error de lectura",
  [STATE.MANIFEST]: "Manifiesto inválido"
};
export const GLOBAL_LABELS = {
  integro: "ÍNTEGRO: todos los archivos declarados coinciden con el manifiesto",
  incidencias: "CON INCIDENCIAS: hay archivos que no coinciden, faltan o no están declarados",
  "manifiesto-invalido": "MANIFIESTO INVÁLIDO: no se ha podido realizar la verificación",
  "error-lectura": "ERROR DE LECTURA: no se ha podido abrir el paquete aportado"
};

const HEX64 = /^[0-9a-f]{64}$/i;
const norm = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
const baseName = (p) => norm(p).split("/").pop();

/** Interpreta un fichero tipo `sha256sum` («<hash>  <ruta>» por línea). */
export function parseSums(text) {
  const map = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) map.set(norm(m[2].trim()), m[1].toLowerCase());
  }
  return map;
}

function invalid(reason, extra = {}) {
  return {
    status: "manifiesto-invalido", statusLabel: GLOBAL_LABELS["manifiesto-invalido"], reason, verifiedAt: new Date().toISOString(),
    manifest: null, items: [{ path: extra.path || "(manifiesto)", state: STATE.MANIFEST, declaredBy: "", expected: "", actual: "", size: null, detail: reason }],
    counts: { [STATE.OK]: 0, [STATE.HASH]: 0, [STATE.MISSING]: 0, [STATE.EXTRA]: 0, [STATE.READ]: 0, [STATE.MANIFEST]: 1 }, total: 0, zip: extra.zip || null
  };
}

/** Resultado para un paquete que no se puede abrir (ZIP corrupto, truncado, cifrado…). */
export function unreadablePackage(reason, { path = "(paquete)", zip = null } = {}) {
  const base = invalid(reason, { path, zip });
  return { ...base, status: "error-lectura", statusLabel: GLOBAL_LABELS["error-lectura"], items: [{ ...base.items[0], state: STATE.READ }], counts: { ...base.counts, [STATE.MANIFEST]: 0, [STATE.READ]: 1 } };
}

/** Comprueba la forma mínima de un manifiesto de RASTRO CAPTURE (esquemas 2 y 3). Devuelve "" si es válido. */
export function manifestProblem(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return "El manifiesto no es un objeto JSON.";
  if (typeof manifest.schema !== "string" || !/^RASTRO-CAPTURE\/\d+$/.test(manifest.schema)) return "El manifiesto no declara un esquema RASTRO-CAPTURE reconocido.";
  if (!Array.isArray(manifest.evidence)) return "El manifiesto no contiene la relación de evidencias.";
  const seen = new Set();
  for (const [i, e] of manifest.evidence.entries()) {
    if (!e || typeof e.path !== "string" || !e.path) return `La evidencia nº ${i + 1} no declara ruta de archivo.`;
    const p = norm(e.path);
    if (p.split("/").includes("..")) return `La evidencia nº ${i + 1} declara una ruta no segura.`;
    if (typeof e.sha256 !== "string" || !HEX64.test(e.sha256)) return `La evidencia ${e.code || `nº ${i + 1}`} no declara un SHA-256 válido.`;
    if (seen.has(p)) return `El manifiesto declara dos veces la ruta ${p}.`;
    seen.add(p);
  }
  for (const d of manifest.documents || []) {
    if (!d || typeof d.path !== "string" || (d.sha256 && !HEX64.test(d.sha256))) return "El manifiesto contiene un documento mal declarado.";
  }
  return "";
}

/**
 * @param {Array<{path:string,size?:number,read:()=>Promise<Blob>}>} files  Archivos del paquete (ZIP abierto, carpeta o selección suelta).
 * @param {{onProgress?:(done:number,total:number,path:string)=>void, hashBlob?:(b:Blob)=>Promise<string>, zip?:object}} [options]
 */
export async function verifyPackage(files, { onProgress, hashBlob = sha256Blob, zip = null } = {}) {
  const list = (files || []).map((f) => ({ ...f, path: norm(f.path) })).filter((f) => f.path);
  if (!list.length) return invalid("No se ha aportado ningún archivo.", { zip });

  // 1) Localizar el manifiesto (esquema 3: metadatos/manifest.json · esquema 2: MANIFEST.json en la raíz).
  const candidates = list.filter((f) => /(^|\/)metadatos\/manifest\.json$/.test(f.path));
  const legacy = list.filter((f) => /(^|\/)MANIFEST\.json$/.test(f.path));
  const loose = list.filter((f) => /^manifest\.json$/i.test(baseName(f.path)));
  const manifestFile = [...candidates, ...legacy, ...loose].sort((a, b) => a.path.length - b.path.length)[0];
  if (!manifestFile) return invalid("No se ha encontrado metadatos/manifest.json (ni MANIFEST.json) entre los archivos aportados.", { zip });
  const manifestRel = /(^|\/)metadatos\/manifest\.json$/.test(manifestFile.path) ? "metadatos/manifest.json" : baseName(manifestFile.path);
  const root = manifestFile.path.endsWith(manifestRel) ? manifestFile.path.slice(0, manifestFile.path.length - manifestRel.length) : "";

  let manifest;
  let manifestBlob;
  try {
    manifestBlob = await manifestFile.read();
    manifest = JSON.parse(await manifestBlob.text());
  } catch (error) {
    return invalid(`El manifiesto no se puede leer o no es JSON válido (${error?.message || error}).`, { path: manifestFile.path, zip });
  }
  const problem = manifestProblem(manifest);
  if (problem) return invalid(problem, { path: manifestFile.path, zip });

  // 2) Índices de los archivos aportados, relativos a la raíz del paquete.
  const byRel = new Map();
  const outside = [];
  for (const f of list) {
    if (root && !f.path.startsWith(root)) { outside.push(f); continue; }
    byRel.set(f.path.slice(root.length), f);
  }
  const byBase = new Map();
  for (const [rel, f] of byRel) { const b = baseName(rel); byBase.set(b, byBase.has(b) ? null : { rel, f }); }
  const used = new Set([manifestRel]);
  const locate = (rel) => {
    if (byRel.has(rel)) { used.add(rel); return { file: byRel.get(rel), by: "ruta" }; }
    const alt = byBase.get(baseName(rel));
    if (alt && !used.has(alt.rel)) { used.add(alt.rel); return { file: alt.f, by: "nombre" }; }
    return null;
  };

  // 3) Declaraciones: manifiesto (evidencias y documentos) y, si existe, SHA256SUMS.txt.
  const declared = new Map(); // rel -> { expected:Set, by:[], code, size }
  const declare = (rel, hash, by, extra = {}) => {
    const key = norm(rel);
    const d = declared.get(key) || { rel: key, hashes: new Map(), code: "", size: null };
    if (hash) d.hashes.set(by, hash.toLowerCase());
    else if (!d.hashes.size) d.noHash = by;
    Object.assign(d, Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null && v !== "")));
    declared.set(key, d);
  };
  for (const e of manifest.evidence) declare(e.path, e.sha256, "manifiesto", { code: e.code, size: Number.isFinite(e.size) ? e.size : null });
  for (const d of manifest.documents || []) declare(d.path, d.sha256 || "", "manifiesto");
  let sumsRel = "";
  for (const rel of ["metadatos/SHA256SUMS.txt", "SHA256SUMS.txt"]) if (byRel.has(rel)) { sumsRel = rel; break; }
  let sumsError = "";
  if (sumsRel) {
    used.add(sumsRel);
    try {
      const sums = parseSums(await (await byRel.get(sumsRel).read()).text());
      for (const [rel, hash] of sums) declare(rel, hash, "SHA256SUMS");
    } catch (error) { sumsError = error?.message || String(error); }
  }

  // 4) Recalcular y comparar.
  const items = [];
  const entries = [...declared.values()];
  let done = 0;
  for (const d of entries) {
    const by = [...d.hashes.keys()].join(" + ") || d.noHash || "";
    const expectedList = [...new Set(d.hashes.values())];
    const item = { path: d.rel, code: d.code || "", declaredBy: by, expected: expectedList.join(" / "), actual: "", size: null, state: STATE.OK, detail: "" };
    const found = d.rel === manifestRel ? { file: manifestFile, by: "ruta" } : locate(d.rel);
    if (!found) { item.state = STATE.MISSING; item.detail = "Declarado pero no presente entre los archivos aportados."; }
    else {
      try {
        const blob = d.rel === manifestRel ? manifestBlob : await found.file.read();
        item.size = blob.size;
        item.actual = await hashBlob(blob);
        if (!expectedList.length) item.detail = "Declarado sin huella: no se puede comparar.";
        else if (expectedList.length > 1) { item.state = STATE.HASH; item.detail = "El manifiesto y SHA256SUMS.txt declaran huellas distintas para este archivo."; }
        else if (item.actual !== expectedList[0]) { item.state = STATE.HASH; item.detail = "El contenido actual no coincide con la huella declarada."; }
        if (item.state === STATE.OK && d.size !== null && d.size !== blob.size) item.detail = `Tamaño declarado ${d.size} B, actual ${blob.size} B.`;
        if (found.by === "nombre") item.detail = `${item.detail ? `${item.detail} ` : ""}Localizado por nombre de archivo (no por ruta).`.trim();
      } catch (error) { item.state = STATE.READ; item.detail = `No se pudo leer el archivo: ${error?.message || error}`; }
    }
    items.push(item);
    onProgress?.(++done, entries.length, d.rel);
  }

  // 5) Archivos presentes que nadie declara.
  for (const [rel, f] of byRel) {
    if (used.has(rel) || declared.has(rel)) continue;
    items.push({ path: rel, code: "", declaredBy: "", expected: "", actual: "", size: f.size ?? null, state: STATE.EXTRA, detail: "Presente en el paquete pero no declarado en el manifiesto ni en SHA256SUMS.txt." });
  }
  for (const f of outside) items.push({ path: f.path, code: "", declaredBy: "", expected: "", actual: "", size: f.size ?? null, state: STATE.EXTRA, detail: "Archivo situado fuera de la carpeta del paquete." });
  if (sumsError) items.push({ path: sumsRel, code: "", declaredBy: "", expected: "", actual: "", size: null, state: STATE.READ, detail: `No se pudo leer SHA256SUMS.txt: ${sumsError}` });

  const counts = Object.fromEntries(Object.values(STATE).map((s) => [s, 0]));
  for (const it of items) counts[it.state]++;
  const clean = items.every((it) => it.state === STATE.OK);
  const status = clean ? "integro" : "incidencias";
  return {
    status, statusLabel: GLOBAL_LABELS[status], reason: "", verifiedAt: new Date().toISOString(),
    manifest: {
      path: manifestFile.path, schema: manifest.schema, tool: manifest.tool || null, generatedAt: manifest.generatedAt || "",
      sessionId: manifest.session?.id || "", reference: manifest.case?.reference || "", proceedings: manifest.case?.proceedings || "",
      evidenceCount: manifest.evidence.length, sha256: await hashBlob(manifestBlob), sums: sumsRel
    },
    items, counts, total: items.length, zip
  };
}

// ------------------------------------------------------------------- Informe de verificación (HTML autónomo)
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

export function verificationReportHtml(result, { rastroLogo = "", toolVersion = "", localTime = "", source = "" } = {}) {
  const cls = { [STATE.OK]: "ok", [STATE.HASH]: "bad", [STATE.MISSING]: "bad", [STATE.EXTRA]: "warn", [STATE.READ]: "bad", [STATE.MANIFEST]: "bad" };
  const rows = result.items.map((it, i) => `<tr class="${cls[it.state]}"><td>${i + 1}</td><td>${esc(it.code)}</td><td class="path">${esc(it.path)}</td><td><b>${esc(STATE_LABELS[it.state])}</b>${it.detail ? `<br><span class="muted">${esc(it.detail)}</span>` : ""}</td><td class="mono">${it.expected ? `Declarado: ${esc(it.expected)}<br>` : ""}${it.actual ? `Calculado: ${esc(it.actual)}` : ""}</td><td>${it.size === null || it.size === undefined ? "" : esc(it.size)}</td></tr>`).join("");
  const m = result.manifest;
  const counts = Object.values(STATE).map((s) => `<tr><th>${esc(STATE_LABELS[s])}</th><td>${result.counts[s] || 0}</td></tr>`).join("");
  const zip = result.zip;
  const zipRows = zip ? `<tr><th>Archivo ZIP examinado</th><td>${esc(zip.name)} (${esc(zip.size)} B)</td></tr><tr><th>SHA-256 del ZIP (calculado)</th><td class="mono">${esc(zip.sha256 || "no calculado")}</td></tr>${zip.sidecar ? `<tr><th>Comparación con el archivo .sha256 aportado</th><td class="${zip.sidecar.match ? "okc" : "badc"}"><b>${zip.sidecar.match ? "COINCIDE" : "NO COINCIDE"}</b>${zip.sidecar.match ? "" : `<br><span class="mono">Declarado: ${esc(zip.sidecar.expected)}</span>`}</td></tr>` : `<tr><th>Archivo .sha256 del ZIP</th><td>No aportado: no se ha comparado la huella del paquete completo.</td></tr>`}` : "";
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<title>Informe de verificación de integridad</title><style>
*{box-sizing:border-box}body{margin:0;background:#eef2f6;color:#12233a;font:13px/1.5 "Segoe UI",Roboto,Arial,sans-serif}
header{background:#0b1f3f;color:#fff;padding:20px 28px}header h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:#b9cbe0}
main{max-width:1100px;margin:0 auto;padding:20px}section{background:#fff;border:1px solid #c9d5e2;border-radius:6px;padding:16px 18px;margin:0 0 16px}
h2{margin:0 0 10px;font-size:16px;color:#0b1f3f;border-bottom:2px solid #1d4f91;padding-bottom:5px}
table{border-collapse:collapse;width:100%;font-size:12px;table-layout:fixed}th,td{border:1px solid #c9d5e2;padding:5px 7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#e8eef5}
table.kv th{width:270px}.mono{font-family:Consolas,"Courier New",monospace;font-size:10.5px}.muted{color:#5a6f86}.path{font-size:11px}
.verdict{font-size:15px;font-weight:700;padding:10px 12px;border-radius:5px;border:1px solid}.v-integro{background:#e6f5ec;border-color:#2e8b57;color:#17643a}.v-incidencias,.v-manifiesto-invalido,.v-error-lectura{background:#fdeaea;border-color:#c0392b;color:#8e1b12}
tr.ok td:nth-child(4) b,.okc{color:#17643a}tr.bad td:nth-child(4) b,.badc{color:#a11d13}tr.warn td:nth-child(4) b{color:#8a5a00}
.note{background:#fff8e1;border:1px solid #e0c36a;border-radius:5px;padding:9px 11px}
footer{display:flex;align-items:center;gap:10px;justify-content:center;color:#5a6f86;padding:14px;font-size:11px}footer img{height:30px;border-radius:3px}
thead{display:table-header-group}tr{break-inside:avoid}@page{size:A4 landscape;margin:12mm}@media print{body{background:#fff}section{border:0;padding:0}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><header><h1>Informe de verificación de integridad</h1><p>RASTRO CAPTURE — Kit RASTRO · Verificación local de un paquete de evidencias</p></header><main>
<section><h2>Resultado global</h2><p class="verdict v-${esc(result.status)}">${esc(result.statusLabel)}</p>${result.reason ? `<p><b>Motivo:</b> ${esc(result.reason)}</p>` : ""}
<table class="kv"><tr><th>Fecha y hora de la verificación (UTC)</th><td>${esc(result.verifiedAt)}${localTime ? ` · hora local ${esc(localTime)}` : ""}</td></tr>
<tr><th>Origen examinado</th><td>${esc(source || (zip ? zip.name : "Archivos seleccionados"))}</td></tr>
<tr><th>Herramienta de verificación</th><td>RASTRO CAPTURE ${esc(toolVersion)} (verificación local, sin envío de datos)</td></tr>
${m ? `<tr><th>Manifiesto</th><td>${esc(m.path)} · esquema ${esc(m.schema)}</td></tr><tr><th>SHA-256 del manifiesto examinado</th><td class="mono">${esc(m.sha256)}</td></tr>
<tr><th>Paquete generado</th><td>${esc(m.generatedAt)} UTC · ${esc(m.tool?.name || "")} ${esc(m.tool?.version || "")}</td></tr>
<tr><th>Sesión / referencia / diligencias</th><td>${esc(m.sessionId || "—")} / ${esc(m.reference || "—")} / ${esc(m.proceedings || "—")}</td></tr>
<tr><th>Evidencias declaradas en el manifiesto</th><td>${esc(m.evidenceCount)}</td></tr>` : ""}${zipRows}</table></section>
<section><h2>Resumen por resultado</h2><table class="kv">${counts}<tr><th>Total de archivos examinados</th><td>${esc(result.total)}</td></tr></table></section>
<section><h2>Detalle de los archivos examinados</h2><table><thead><tr><th style="width:36px">Nº</th><th style="width:70px">Evidencia</th><th style="width:24%">Archivo</th><th style="width:22%">Resultado</th><th>SHA-256</th><th style="width:80px">Bytes</th></tr></thead><tbody>${rows}</tbody></table></section>
<section><h2>Alcance y limitaciones de esta verificación</h2><p class="note">Esta verificación compara el SHA-256 actual de cada archivo con el valor declarado en el manifiesto aportado (y en SHA256SUMS.txt, si existe). Acredita la <b>integridad respecto de ese manifiesto</b>: que los archivos no han cambiado desde que se generó. <b>No acredita la autenticidad de origen</b>: una coincidencia de hashes no demuestra por sí misma quién creó el contenido, cuándo fue publicado, ni que el manifiesto no haya sido sustituido junto con los archivos. Para esto último debe contrastarse el SHA-256 del paquete ZIP o del manifiesto con el valor consignado en las diligencias en el momento de la exportación.</p></section>
</main><footer>${rastroLogo ? `<img src="${esc(rastroLogo)}" alt="RASTRO CAPTURE">` : ""}<span>Generado localmente por RASTRO CAPTURE ${esc(toolVersion)} — Kit RASTRO · Creado por S3GAD3</span></footer></body></html>`;
}
