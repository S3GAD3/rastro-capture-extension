// Pruebas de la v0.5.0: manifiesto (esquema 3), informes (técnico y resumido, HTML y PDF), verificador de
// integridad, lector ZIP, descarga con reintento y coherencia del paquete de la extensión. Datos ficticios.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createZip, crc32 } from "../src/lib/zipWriter.js";
import { openZip, isSafeZipPath } from "../src/lib/zipReader.js";
import { utf8Bytes } from "../src/lib/sha256.js";
import { buildManifest, buildReportModel, renderReportHtml, reportHtml, readmeText, inventoryCsv, TOOL, SCHEMA } from "../src/lib/report.js";
import { renderReportPdf, toWinAnsi, wrapText, jpegInfo, dataUrlBytes } from "../src/lib/pdf.js";
import { verifyPackage, unreadablePackage, verificationReportHtml, manifestProblem, parseSums, STATE } from "../src/lib/verify.js";
import { fetchMedia } from "../src/lib/mediaFetch.js";
import { sessionLabel, KIND_INFO, KIND_LABELS, formatBytes } from "../src/lib/paths.js";
import { sampleInput, sampleManifest, assets } from "./fixtures/sample.js";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// ------------------------------------------------------------------ Manifiesto
test("manifiesto esquema 3: sesión, evidencias con todos los campos exigidos y clase original/derivado", () => {
  const m = sampleManifest();
  assert.equal(m.schema, SCHEMA);
  assert.equal(m.schema, "RASTRO-CAPTURE/3");
  assert.match(m.session.id, /^RC-\d{8}-\d{6}-[0-9A-F]{6}$/);
  assert.equal(m.tool.version, TOOL.version);
  for (const e of m.evidence) {
    assert.match(e.code, /^EV-\d{4}$/);
    assert.ok(e.id && e.filename && e.path.startsWith("evidencias/"), "identificador, nombre y ruta relativa");
    assert.ok(Number.isInteger(e.size) && e.mime, "tamaño en bytes y tipo MIME");
    assert.match(e.sha256, /^[0-9a-f]{64}$/);
    assert.ok(e.createdAt && e.createdLocal, "fecha de incorporación UTC y local");
    assert.ok(e.sourceUrl, "URL de origen");
    assert.ok(e.captureMethod.length > 20, "método de captura");
    assert.ok(Array.isArray(e.warnings), "advertencias");
    assert.ok(["original", "captura", "derivado"].includes(e.fileClass), "clase documental");
  }
  assert.equal(m.evidence.find((e) => e.kind === "media-image").fileClass, "original");
  assert.equal(m.evidence.find((e) => e.kind === "screenshot-visible").fileClass, "captura");
  assert.equal(m.evidence.find((e) => e.kind === "screenshot-page").fileClass, "derivado");
  assert.deepEqual(m.evidence.find((e) => e.code === "EV-0005").warnings, ["Extractor web genérico: no se reconoce Instagram ni TikTok."]);
  assert.equal(m.incidents.length, 1, "el error de descarga del registro consta como incidencia");
  assert.equal(m.incidents[0].level, "error");
  for (const kind of Object.keys(KIND_LABELS)) assert.ok(KIND_INFO[kind], `falta la descripción de método para ${kind}`);
});

test("manifiesto: discrepancias de integridad, contenido ausente y mezcla de referencias constan como incidencias", () => {
  const input = sampleInput();
  input.evidence[1].integrityVerified = false;
  input.evidence[2].integrityVerified = false; input.evidence[2].blobMissing = true;
  input.evidence[3].case = { reference: "OTRO-EXPEDIENTE" };
  const m = buildManifest(input);
  assert.equal(m.evidence[1].integrityStatus, "hash-diferente");
  assert.equal(m.evidence[2].integrityStatus, "contenido-ausente");
  assert.equal(m.summary.allVerified, false);
  const actions = m.incidents.map((i) => i.action);
  for (const wanted of ["Huella no coincidente", "Contenido ausente", "Referencia distinta", "Error de descarga"]) assert.ok(actions.includes(wanted), wanted);
});

test("los datos manuales, automáticos e inferidos se separan en el manifiesto", () => {
  const m = sampleManifest();
  assert.equal(m.institution.unit, "Unidad Ficticia de Investigación Tecnológica");
  assert.equal(m.case.proceedings, "DP 0000/2026 (ficticias)");
  assert.ok(m.dataOrigin.A && m.dataOrigin.M && m.dataOrigin.I);
  assert.ok(m.dataOrigin.inferredFields.some((f) => /platform/.test(f)));
});

// ------------------------------------------------------------------ Informes HTML
const SECTIONS_TECH = ["1. Identificación de la actuación", "2. Identificación del recurso", "3. Descripción técnica de la captura", "4. Relación de evidencias", "5. Integridad de evidencias", "6. Cronología de operaciones", "7. Observaciones del investigador", "8. Limitaciones técnicas", "9. Anexo de evidencias"];

test("informe técnico: las nueve secciones, tabla de evidencias con hashes y logotipos incrustados", () => {
  const m = sampleManifest();
  const a = assets();
  const html = reportHtml(m, { mode: "tecnico", assets: a });
  let cursor = -1;
  for (const title of SECTIONS_TECH) { const at = html.indexOf(title); assert.ok(at > cursor, `sección ausente o desordenada: ${title}`); cursor = at; }
  for (const e of m.evidence) { assert.ok(html.includes(e.sha256), `hash de ${e.code}`); assert.ok(html.includes(e.filename), `archivo de ${e.code}`); }
  assert.ok(html.includes(a.institutionLogo), "escudo institucional incrustado");
  assert.ok(html.includes(a.rastroLogo), "logotipo RASTRO CAPTURE incrustado");
  assert.ok(html.indexOf(a.institutionLogo) < html.indexOf("1. Identificación"), "el escudo va en el encabezado");
  assert.ok(html.indexOf(a.rastroLogo) > html.indexOf("9. Anexo"), "el logotipo RASTRO va en el pie");
  assert.ok(html.includes(a.previews["EV-0002"]), "vista previa de la captura en el anexo");
  assert.match(html, /RC-20261115-125700-A1B2C3/);
  assert.match(html, /Europe\/Madrid · UTC\+01:00/);
  assert.match(html, /Creado por S3GAD3/);
});

test("informes autónomos: sin scripts, sin recursos externos y con CSP restrictiva", () => {
  const m = sampleManifest();
  for (const mode of ["tecnico", "resumido"]) {
    const html = reportHtml(m, { mode, assets: assets() });
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /<link\b/i);
    assert.doesNotMatch(html, /<iframe|<object|<embed/i);
    for (const src of html.match(/<img[^>]+src="[^"]+"/g) || []) assert.match(src, /src="data:image\/(png|jpeg);base64,/, "toda imagen va incrustada como data: URI");
    assert.doesNotMatch(html, /url\(/i, "sin recursos externos en CSS");
    assert.doesNotMatch(html, /@import/i);
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"/);
    assert.match(html, /@page\{size:A4/);
    assert.match(html, /counter\(page\)/, "paginación en la impresión");
    assert.match(html, /thead\{display:table-header-group\}/);
    assert.match(html, /tr\{break-inside:avoid\}/);
  }
});

test("informe: los datos llevan su procedencia y las inferencias su fundamento", () => {
  const m = sampleManifest();
  const model = buildReportModel(m, "tecnico");
  const rows = model.blocks.filter((b) => b.t === "kv").flatMap((b) => b.rows);
  const by = (label) => rows.filter((r) => r.label === label);
  assert.ok(by("Unidad investigadora").every((r) => r.origin === "M"));
  assert.ok(by("Número de diligencias").every((r) => r.origin === "M"));
  assert.ok(by("Identificador de la sesión").every((r) => r.origin === "A"));
  assert.ok(by("URL completa").every((r) => r.origin === "A"));
  const platform = by("Plataforma");
  assert.equal(platform.length, 2);
  assert.ok(platform.every((r) => r.origin === "I" && /nombre de host/.test(r.basis)), "la plataforma es una inferencia con fundamento");
  assert.ok(by("Tipo de contenido").every((r) => r.origin === "I" && r.basis));
  assert.equal(by("Usuario o identificador del perfil")[0].origin, "A", "coincide con los datos entregados por la plataforma");
  assert.ok(rows.every((r) => ["A", "M", "I"].includes(r.origin)), "todo dato tiene procedencia");
  // Sin datos de plataforma, el usuario procede de la URL: es una inferencia.
  const input = sampleInput();
  for (const e of input.evidence) if (e.source.platform === "Instagram") { e.source = { ...e.source, post: null, account: null }; }
  input.catalog = { accounts: [], posts: [] };
  const inferred = buildReportModel(buildManifest(input), "tecnico").blocks.filter((b) => b.t === "kv").flatMap((b) => b.rows);
  const user = inferred.find((r) => r.label === "Usuario o identificador del perfil");
  assert.equal(user.origin, "I");
  assert.match(user.basis, /URL/);
  const html = reportHtml(m, { assets: assets() });
  assert.match(html, /class="o-tag o-I"/);
  assert.match(html, /Fundamento: Deducida del nombre de host de la URL\./);
  assert.match(html, /Procedencia de los datos/);
});

test("informe resumido: breve, con unidad, diligencias, recurso, operaciones, archivos, hashes, incidencias y paquete", () => {
  const m = sampleManifest();
  const a = assets();
  const summary = reportHtml(m, { mode: "resumido", assets: a });
  const technical = reportHtml(m, { mode: "tecnico", assets: a });
  for (const title of ["1. Datos de la actuación", "2. Recurso o perfil examinado", "3. Operaciones realizadas", "4. Relación de archivos obtenidos y huellas SHA-256", "5. Incidencias relevantes", "6. Observaciones del investigador", "7. Paquete de evidencias y verificación"]) assert.ok(summary.includes(title), title);
  assert.ok(summary.includes(a.institutionLogo));
  assert.match(summary, /Unidad Ficticia de Investigación Tecnológica/);
  assert.match(summary, /DP 0000\/2026 \(ficticias\)/);
  for (const e of m.evidence) assert.ok(summary.includes(e.sha256));
  assert.ok(summary.includes(m.packageName), "referencia al paquete completo");
  assert.match(summary, /Error de descarga/);
  assert.ok(!summary.includes("9. Anexo de evidencias"));
  const strip = (h) => h.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, "").length;
  assert.ok(strip(summary) < strip(technical) * 0.6, "el resumido es sensiblemente más breve");
  assert.match(summary, /no acreditan por sí mismas la autoría/);
  assert.doesNotMatch(summary + technical, /es el autor|pertenece a |acredita la autoría/i, "sin afirmaciones de atribución");
});

test("informe: el contenido de terceros y los campos manuales se escapan; los enlaces solo son http(s) o relativos al paquete", () => {
  const evil = `<img src=x onerror=alert(1)>"><script>alert(2)</script>`;
  const input = sampleInput({ evil });
  input.caseData.observations = evil; input.institution.unit = evil; input.caseData.proceedings = `"};body{display:none}/*${evil}`;
  input.evidence[1].note = evil;
  input.evidence[2].details.mediaUrl = "javascript:alert(3)";
  input.evidence[4].source = { ...input.evidence[4].source, url: "javascript:alert(4)", canonicalUrl: "javascript:alert(4)" };
  for (const mode of ["tecnico", "resumido"]) {
    const html = reportHtml(buildManifest(input), { mode, assets: assets() });
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /href="javascript:/i);
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    // El valor manual queda dentro de una cadena CSS: comillas, llaves y barras van escapadas (\22, \7b, \7d…).
    assert.ok(!style.includes('"};body{') && !style.includes("body{display:none}"), "un campo manual no puede inyectar CSS en las cajas de página");
    assert.ok(mode !== "tecnico" || style.includes("\\22 \\7d ;body\\7b display:none\\7d "), "las comillas y llaves del valor se escapan");
    for (const href of html.match(/href="[^"]+"/g) || []) assert.match(href, /^href="(https?:\/\/|\.\.\/evidencias\/)/, href);
  }
});

test("una imagen incrustada no válida no llega al HTML", () => {
  const html = reportHtml(sampleManifest(), { assets: { institutionLogo: 'data:image/svg+xml,<svg onload="alert(1)">', rastroLogo: "https://externo.example/logo.png", previews: { "EV-0002": "javascript:alert(1)" } } });
  assert.doesNotMatch(html, /svg\+xml|externo\.example|javascript:/);
});

// ------------------------------------------------------------------ PDF
function checkPdf(bytes) {
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"), "cabecera PDF");
  assert.ok(text.trimEnd().endsWith("%%EOF"), "fin de archivo");
  const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.ok(text.slice(startxref).startsWith("xref\n"), "startxref apunta a la tabla xref");
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((off, i) => assert.ok(text.slice(off).startsWith(`${i + 1} 0 obj\n`), `desplazamiento del objeto ${i + 1}`));
  for (const m of text.matchAll(/\/Length (\d+) >>\nstream\n/g)) assert.equal(text.slice(m.index + m[0].length + Number(m[1]), m.index + m[0].length + Number(m[1]) + 11), "\nendstream\n", "longitud de flujo exacta");
  return { text, pages: Number(text.match(/\/Type \/Pages \/Count (\d+)/)[1]) };
}
const pdfStrings = (text) => [...text.matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("\n");

test("PDF técnico y resumido: estructura válida, A4, paginación, encabezado institucional e imágenes incrustadas", () => {
  const m = sampleManifest();
  const a = assets();
  const technical = renderReportPdf(buildReportModel(m, "tecnico", { previewCodes: Object.keys(a.previews) }), a, { createdAt: new Date(m.generatedAt) });
  const summary = renderReportPdf(buildReportModel(m, "resumido"), a, { createdAt: new Date(m.generatedAt) });
  const t = checkPdf(technical.bytes), s = checkPdf(summary.bytes);
  assert.equal(t.pages, technical.pages);
  assert.ok(t.pages > s.pages && s.pages <= 3, `técnico ${t.pages} pág., resumido ${s.pages} pág.`);
  assert.match(t.text, /\/MediaBox \[0 0 595\.28 841\.89\]/);
  const strings = pdfStrings(t.text);
  for (let n = 1; n <= t.pages; n++) assert.ok(strings.includes(`P\u00e1gina ${n} de ${t.pages}`), `pie de la página ${n}`);
  assert.equal(strings.split("UNIDAD FICTICIA DE INVESTIGACI\u00d3N TECNOL\u00d3GICA").length - 1, t.pages, "encabezado en todas las páginas");
  for (const title of SECTIONS_TECH) assert.ok(strings.includes(Buffer.from(title, "latin1").toString("latin1")), title);
  for (const e of m.evidence) assert.ok(strings.replace(/\n/g, "").includes(e.sha256) || e.sha256.match(/.{1,29}/g).every((part) => strings.includes(part.slice(0, 20))), `hash de ${e.code} en el PDF`);
  assert.equal((t.text.match(/\/Subtype \/Image/g) || []).length, 4, "escudo, logotipo RASTRO y dos vistas previas");
  assert.equal((s.text.match(/\/Subtype \/Image/g) || []).length, 2, "escudo y logotipo RASTRO");
  assert.equal(technical.replaced, 1, "el emoji del texto se sustituye y se advierte");
  assert.ok(strings.includes("no representables"));
  assert.match(t.text, /\/CreationDate \(D:20261115130601Z\)/);
});

test("PDF: tablas largas repiten cabecera, no parten filas y el documento sigue siendo válido con 300 evidencias", () => {
  const input = sampleInput();
  const base = input.evidence[2];
  input.evidence = Array.from({ length: 300 }, (_, i) => ({ ...base, id: `id-${i}`, seq: i + 1, code: `EV-${String(i + 1).padStart(4, "0")}`, filename: `EV-${String(i + 1).padStart(4, "0")}_archivo.jpg`, zipPath: `medios/x/EV-${String(i + 1).padStart(4, "0")}_archivo.jpg`, sha256: sha(String(i)) }));
  const m = buildManifest(input);
  const out = renderReportPdf(buildReportModel(m, "resumido"), assets());
  const { text, pages } = checkPdf(out.bytes);
  assert.ok(pages > 5);
  const strings = pdfStrings(text);
  assert.ok(strings.split("\nSHA-256\n").length - 1 >= pages - 2, "la cabecera de la tabla se repite en cada página");
  // Ninguna línea de texto queda por debajo del margen inferior (salvo el pie) ni por encima del encabezado.
  for (const stream of text.split("\nstream\n").slice(1)) {
    const body = stream.split("\nendstream")[0];
    for (const mm of body.matchAll(/ Tf (-?[\d.]+) (-?[\d.]+) Td/g)) { const y = Number(mm[2]); assert.ok(y >= 20 && y <= 830, `texto fuera de página (y=${y})`); }
  }
  assert.ok(strings.includes("EV-0300"));
});

test("PDF: codificación WinAnsi, ajuste de líneas y lectura de JPEG", () => {
  assert.deepEqual(toWinAnsi("Año «ñ» €"), { text: "A\u00f1o \u00ab\u00f1\u00bb \u0080", replaced: 0 });
  assert.equal(toWinAnsi("a😀b").replaced, 1);
  assert.equal(toWinAnsi("a\u200bb\u0001c").text, "abc");
  const lines = wrapText("a".repeat(200), "M", 6, 100);
  assert.ok(lines.length > 5 && lines.every((l) => l.length * 3.6 <= 100.01));
  assert.equal(lines.join(""), "a".repeat(200), "el ajuste por caracteres no pierde contenido");
  assert.deepEqual(wrapText("uno dos\ntres", "R", 8, 500), ["uno dos", "tres"]);
  const logo = dataUrlBytes(assets().rastroLogo);
  assert.deepEqual(jpegInfo(logo), { width: 360, height: 279, components: 3 });
  assert.equal(jpegInfo(new Uint8Array([1, 2, 3, 4])), null);
  assert.equal(dataUrlBytes("data:image/png;base64,AAAA"), null, "solo se incrustan JPEG");
});

// ------------------------------------------------------------------ Verificador
const enc = (t) => new TextEncoder().encode(t);
function demoPackage({ root = "RASTRO_CAPTURE_DEMO/" } = {}) {
  const files = { "evidencias/capturas/EV-0001_a.png": new Uint8Array([137, 80, 78, 71, 1, 2, 3]), "evidencias/medios/web/sin-usuario/EV-0002_b.jpg": new Uint8Array([255, 216, 255, 9, 9]), "evidencias/datos-origen/EV-0003_c.json": enc('{"x":1}') };
  const docs = { "informes/informe_tecnico.html": enc("<!doctype html><p>informe</p>"), "README_EVIDENCIAS.txt": enc("leeme") };
  const manifest = { schema: "RASTRO-CAPTURE/3", tool: { name: "RASTRO CAPTURE", version: "0.5.0" }, generatedAt: "2026-11-15T13:06:01.000Z", session: { id: "RC-20261115-125700-A1B2C3" }, case: { reference: "EXP-FICT", proceedings: "DP 0/2026" },
    evidence: Object.entries(files).map(([path, bytes], i) => ({ code: `EV-000${i + 1}`, path, size: bytes.length, sha256: sha(bytes) })),
    documents: Object.entries(docs).map(([path, bytes]) => ({ path, sha256: sha(bytes), size: bytes.length })) };
  const manifestBytes = enc(JSON.stringify(manifest, null, 2));
  const all = { ...files, ...docs, "metadatos/manifest.json": manifestBytes };
  const sums = enc(`${Object.entries(all).map(([p, b]) => `${sha(b)}  ${p}`).join("\n")}\n`);
  const entries = [...Object.entries(all), ["metadatos/SHA256SUMS.txt", sums]].map(([path, bytes]) => ({ path: root + path, bytes }));
  return { entries, manifest, root };
}
const asFiles = (entries) => entries.map((e) => ({ path: e.path, size: e.bytes.length, read: async () => new Blob([e.bytes]) }));
const stateOf = (result, suffix) => result.items.find((i) => i.path.endsWith(suffix))?.state;

test("verificador: paquete íntegro leído desde el ZIP (coincidencia correcta en todos los archivos)", async () => {
  const { entries } = demoPackage();
  const zip = new Blob([createZip(entries)]);
  const opened = await openZip(zip);
  assert.equal(opened.length, entries.length);
  const result = await verifyPackage(opened);
  assert.equal(result.status, "integro");
  assert.equal(result.counts[STATE.OK], 6, "3 evidencias + 2 documentos + el manifiesto (vía SHA256SUMS)");
  assert.equal(result.total, 6);
  assert.equal(result.manifest.sessionId, "RC-20261115-125700-A1B2C3");
  assert.match(result.items.find((i) => i.code === "EV-0001").declaredBy, /manifiesto \+ SHA256SUMS/);
});

test("verificador: distingue hash diferente, archivo ausente, archivo adicional y error de lectura", async () => {
  const { entries } = demoPackage();
  const tampered = entries.map((e) => ({ ...e, bytes: new Uint8Array(e.bytes) }));
  tampered.find((e) => e.path.endsWith("EV-0001_a.png")).bytes[5] ^= 0xff;           // modificado
  const without = tampered.filter((e) => !e.path.endsWith("EV-0002_b.jpg"));          // ausente
  without.push({ path: "RASTRO_CAPTURE_DEMO/evidencias/intruso.exe", bytes: enc("x") }); // adicional
  const files = asFiles(without);
  files.find((f) => f.path.endsWith("EV-0003_c.json")).read = async () => { throw new Error("disco dañado"); }; // ilegible
  const result = await verifyPackage(files);
  assert.equal(result.status, "incidencias");
  assert.equal(stateOf(result, "EV-0001_a.png"), STATE.HASH);
  assert.equal(stateOf(result, "EV-0002_b.jpg"), STATE.MISSING);
  assert.equal(stateOf(result, "intruso.exe"), STATE.EXTRA);
  assert.equal(stateOf(result, "EV-0003_c.json"), STATE.READ);
  assert.equal(stateOf(result, "informe_tecnico.html"), STATE.OK);
  assert.deepEqual([result.counts[STATE.HASH], result.counts[STATE.MISSING], result.counts[STATE.EXTRA], result.counts[STATE.READ]], [1, 1, 1, 1]);
  const item = result.items.find((i) => i.path.endsWith("EV-0001_a.png"));
  assert.notEqual(item.actual, item.expected);
  assert.match(item.actual, /^[0-9a-f]{64}$/);
});

test("verificador: detecta la alteración de un solo byte en un informe y la del propio manifiesto", async () => {
  const { entries } = demoPackage();
  const doc = entries.map((e) => (e.path.endsWith("informe_tecnico.html") ? { ...e, bytes: enc("<!doctype html><p>informe!</p>") } : e));
  assert.equal(stateOf(await verifyPackage(asFiles(doc)), "informe_tecnico.html"), STATE.HASH);
  // Manifiesto retocado (se cambia el hash declarado de una evidencia): SHA256SUMS lo delata.
  const forged = entries.map((e) => {
    if (!e.path.endsWith("metadatos/manifest.json")) return e;
    const m = JSON.parse(new TextDecoder().decode(e.bytes)); m.evidence[0].sha256 = "0".repeat(64);
    return { ...e, bytes: enc(JSON.stringify(m)) };
  });
  const result = await verifyPackage(asFiles(forged));
  assert.equal(result.status, "incidencias");
  assert.equal(stateOf(result, "metadatos/manifest.json"), STATE.HASH);
  assert.equal(stateOf(result, "EV-0001_a.png"), STATE.HASH);
});

test("verificador: manifiesto inválido o ausente, y paquete ilegible", async () => {
  assert.equal((await verifyPackage([])).status, "manifiesto-invalido");
  assert.equal((await verifyPackage(asFiles([{ path: "foto.png", bytes: enc("x") }]))).status, "manifiesto-invalido");
  const bad = (text) => verifyPackage(asFiles([{ path: "p/metadatos/manifest.json", bytes: enc(text) }]));
  assert.match((await bad("{no es json")).reason, /JSON/);
  assert.match((await bad('{"manifest_version":3,"name":"x"}')).reason, /esquema/);
  assert.match((await bad('{"schema":"RASTRO-CAPTURE/3","evidence":[{"path":"a","sha256":"zz"}]}')).reason, /SHA-256/);
  assert.match((await bad('{"schema":"RASTRO-CAPTURE/3","evidence":[{"path":"../../etc/passwd","sha256":"' + "a".repeat(64) + '"}]}')).reason, /no segura/);
  assert.equal((await bad("[]")).counts[STATE.MANIFEST], 1);
  assert.equal(manifestProblem({ schema: "RASTRO-CAPTURE/3", evidence: [] }), "");
  const unreadable = unreadablePackage("ZIP truncado");
  assert.equal(unreadable.status, "error-lectura");
  assert.equal(unreadable.counts[STATE.READ], 1);
  await assert.rejects(openZip(new Blob([enc("esto no es un zip, solo texto de relleno")])), /directorio central/);
});

test("verificador: carpeta extraída sin carpeta raíz, archivos sueltos localizados por nombre y paquetes de la v0.4.0", async () => {
  const { entries, root } = demoPackage();
  const flat = entries.map((e) => ({ ...e, path: e.path.slice(root.length) }));
  assert.equal((await verifyPackage(asFiles(flat))).status, "integro");
  const loose = entries.filter((e) => !e.path.endsWith("SHA256SUMS.txt") && !/informes|README/.test(e.path)).map((e) => ({ ...e, path: e.path.split("/").pop() }));
  const result = await verifyPackage(asFiles(loose));
  assert.equal(result.counts[STATE.OK], 3);
  assert.match(result.items.find((i) => i.code === "EV-0001").detail, /Localizado por nombre/);
  assert.equal(result.counts[STATE.MISSING], 2, "los documentos declarados que no se aportan constan como ausentes");
  // Esquema 2 (v0.4.0): MANIFEST.json y SHA256SUMS.txt en la raíz.
  const a = new Uint8Array([1, 2, 3]), report = enc("<p>informe</p>");
  const v2 = enc(JSON.stringify({ schema: "RASTRO-CAPTURE/2", evidence: [{ code: "EV-0001", path: "capturas/EV-0001_a.png", sha256: sha(a) }] }));
  const legacy = [{ path: "capturas/EV-0001_a.png", bytes: a }, { path: "INFORME.html", bytes: report }, { path: "MANIFEST.json", bytes: v2 }, { path: "SHA256SUMS.txt", bytes: enc(`${sha(a)}  capturas/EV-0001_a.png\n${sha(report)}  INFORME.html\n${sha(v2)}  MANIFEST.json\n`) }];
  const old = await verifyPackage(asFiles(legacy));
  assert.equal(old.status, "integro");
  assert.equal(old.total, 3);
});

test("verificador: admite un ZIP recomprimido con DEFLATE y rechaza rutas peligrosas", async () => {
  const { entries } = demoPackage();
  // ZIP con método 8 (deflate) construido a mano, como lo generaría otra herramienta.
  const parts = [], central = [];
  let offset = 0;
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const e of entries) {
    const name = enc(e.path), comp = new Uint8Array(deflateRawSync(e.bytes)), crc = crc32(e.bytes);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 8, 0, 0, 0, 33, 0, ...u32(crc), ...u32(comp.length), ...u32(e.bytes.length), ...u16(name.length), 0, 0]);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 8, 0, 0, 0, 33, 0, ...u32(crc), ...u32(comp.length), ...u32(e.bytes.length), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset)]), name);
    parts.push(local, name, comp); offset += local.length + name.length + comp.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const zip = new Blob([...parts, ...central, new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(entries.length), ...u16(entries.length), ...u32(centralSize), ...u32(offset), 0, 0])]);
  const opened = await openZip(zip);
  assert.ok(opened.every((e) => e.method === 8));
  assert.equal((await verifyPackage(opened)).status, "integro");
  for (const p of ["../x", "/abs", "a/../../b", "c:\\x", "C:/x", "a\\b", ""]) assert.equal(isSafeZipPath(p), false, p);
  assert.equal(isSafeZipPath("evidencias/capturas/EV-0001.png"), true);
  await assert.rejects(openZip(new Blob([createZip([{ path: "../fuera.txt", bytes: enc("x") }])])), /ruta no segura/);
});

test("informe de verificación: autónomo, con resultado global, detalle y la advertencia sobre autenticidad", async () => {
  const { entries } = demoPackage();
  entries[0].bytes = new Uint8Array([9, 9, 9]);
  const result = await verifyPackage(asFiles(entries), { zip: { name: "paquete<script>.zip", size: 10, sha256: "a".repeat(64), sidecar: { match: false, expected: "b".repeat(64) } } });
  const html = verificationReportHtml(result, { rastroLogo: assets().rastroLogo, toolVersion: "0.5.0", localTime: "2026-11-15 14:10:00 (UTC+01:00)", source: "ZIP: paquete<script>.zip" });
  assert.match(html, /CON INCIDENCIAS/);
  assert.match(html, /Hash diferente/);
  assert.match(html, /NO COINCIDE/);
  assert.match(html, /No acredita la autenticidad de origen/);
  assert.match(html, /2026-11-15 14:10:00/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /default-src 'none'/);
  assert.deepEqual([...parseSums(`${"a".repeat(64)}  x/y.png\n${"B".repeat(64)} *z.bin\nbasura\n`)], [["x/y.png", "a".repeat(64)], ["z.bin", "b".repeat(64)]]);
});

// ------------------------------------------------------------------ Paquete: README, CSV, nombres
test("README del paquete explica la organización, originales/derivados y los tres métodos de verificación", () => {
  const text = readmeText(sampleManifest(), { zipName: "RASTRO_CAPTURE_X.zip", hasPdf: true });
  for (const wanted of ["evidencias/", "informes/", "registros/", "metadatos/", "manifest.json", "informe_tecnico.pdf", "sha256sum -c metadatos/SHA256SUMS.txt", "Get-FileHash", "RASTRO_CAPTURE_X.zip.sha256", "Verificar integridad", "ORIGINALES Y DERIVADOS", "autenticidad de origen", "RC-20261115-125700-A1B2C3"]) assert.ok(text.includes(wanted), wanted);
  assert.ok(!readmeText(sampleManifest(), { hasPdf: false }).includes("informe_tecnico.pdf"), "los opcionales solo se citan si existen");
  const csv = inventoryCsv(sampleManifest().evidence);
  assert.match(csv, /Clase;Archivo;SHA-256/);
  assert.match(csv, /evidencias\/capturas\/EV-0002/);
  assert.match(sessionLabel(new Date("2026-11-15T12:57:00Z"), "a1b2c3d4"), /^RC-20261115-125700-A1B2C3$/);
  assert.equal(formatBytes(1536), "1.5 KB");
});

// ------------------------------------------------------------------ Descarga
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1]);
const okResponse = () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(jpeg.length) } });

test("descarga: reintenta una vez ante fallos transitorios y conserva los bytes recibidos sin transformar", async () => {
  let calls = 0;
  const flaky = async () => { if (++calls === 1) throw new TypeError("Failed to fetch"); return okResponse(); };
  const result = await fetchMedia("https://cdn.example/a.jpg", { kind: "image", fetchImpl: flaky, retryDelayMs: 1 });
  assert.equal(calls, 2);
  assert.equal(result.http.attempts, 2);
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), jpeg);
  calls = 0;
  const server = async () => (++calls === 1 ? new Response("x", { status: 503 }) : okResponse());
  assert.equal((await fetchMedia("https://cdn.example/a.jpg", { kind: "image", fetchImpl: server, retryDelayMs: 1 })).http.attempts, 2);
});

test("descarga: los 4xx no se reintentan y explican la limitación sin eludir controles de acceso", async () => {
  for (const [status, pattern] of [[401, /exige autenticación; la herramienta no elude/], [403, /acceso denegado o enlace caducado/], [404, /no encontrado/], [429, /demasiadas peticiones/]]) {
    let calls = 0;
    await assert.rejects(fetchMedia("https://cdn.example/a.jpg", { kind: "image", fetchImpl: async () => { calls++; return new Response("no", { status }); }, retryDelayMs: 1 }), pattern);
    assert.equal(calls, 1, `sin reintento para ${status}`);
  }
  await assert.rejects(fetchMedia("https://cdn.example/a.jpg", { kind: "image", fetchImpl: async () => { throw new TypeError("net"); }, retryDelayMs: 1 }), /No se pudo conectar/);
});

// ------------------------------------------------------------------ Coherencia y seguridad del paquete de la extensión
test("versión única y permisos sin ampliar respecto de la v0.4.0", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, TOOL.version);
  assert.equal(JSON.parse(read("package.json")).version, TOOL.version);
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "declarativeNetRequest", "desktopCapture", "downloads", "pageCapture", "scripting", "sidePanel", "storage", "tabs", "unlimitedStorage"]);
  assert.equal(manifest.host_permissions.length, 11);
  assert.ok(manifest.host_permissions.every((h) => /instagram|fbcdn|tiktok|byteoversea|ibytedtos|muscdn/.test(h)));
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  for (const forbidden of ["cookies", "webRequest", "debugger", "history", "management", "nativeMessaging"]) assert.ok(!manifest.permissions.includes(forbidden), forbidden);
});

test("CSP de las páginas de la extensión: solo scripts propios, sin eval ni objetos", () => {
  const csp = JSON.parse(read("manifest.json")).content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /base-uri 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline|script-src[^;]*https?:/);
});

test("páginas de la extensión: sin scripts en línea, sin recursos remotos y con la identidad del proyecto", () => {
  const pages = ["sidepanel.html", "recorder.html", "report.html", "verify.html"];
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${page}: script en línea`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, `${page}: manejador en línea`);
    assert.doesNotMatch(html, /(src|href)="(https?:)?\/\//i, `${page}: recurso remoto`);
    assert.match(html, /assets\/rastro-capture-mark\.png/, `${page}: logotipo oficial`);
    assert.doesNotMatch(html, /\b0\.4\.0\b/, `${page}: versión antigua`);
  }
  const panel = read("sidepanel.html");
  assert.match(panel, /Creado por S3GAD3/);
  assert.match(panel, /Kit RASTRO/);
  for (const tab of ["captura", "evidencias", "informes", "config"]) assert.match(panel, new RegExp(`data-view="${tab}"`));
  for (const id of ["analyze", "capturePost", "captureVisible", "capturePage", "saveMhtml", "saveData", "openRecorder", "loadMore", "selectAllPosts", "selectNonePosts", "downloadPostsMedia", "capturePostsBatch", "downloadAllMedia", "exportPackage", "clearCase", "cancelTask", "optHideFixed", "optCopyDownloads", "optBatchMedia", "loadMax", "captureNote", "caseRef"]) assert.match(panel, new RegExp(`id="${id}"`), `control original ausente: ${id}`);
});

test("código: sin eval, sin telemetría, sin acceso a cookies y sin dependencias externas", () => {
  const files = ["service-worker.js", "sidepanel.js", "recorder.js", "report-view.js", "verify.js", "extractor.js", ...readdirSync(new URL("../src/lib/", import.meta.url)).map((f) => `src/lib/${f}`), ...readdirSync(new URL("../src/panel/", import.meta.url)).map((f) => `src/panel/${f}`), ...readdirSync(new URL("../src/page/", import.meta.url)).map((f) => `src/page/${f}`)];
  for (const file of files) {
    const code = read(file);
    assert.doesNotMatch(code, /\beval\s*\(|new Function\s*\(/, `${file}: eval`);
    assert.doesNotMatch(code, /document\.cookie|chrome\.cookies/, `${file}: cookies`);
    assert.doesNotMatch(code, /sendBeacon|google-analytics|gtag\(|sentry|mixpanel/i, `${file}: telemetría`);
    assert.doesNotMatch(code, /from\s+["']https?:|import\s*\(\s*["']https?:/, `${file}: importación remota`);
    assert.doesNotMatch(code, /document\.write\s*\(/, `${file}: document.write`);
  }
  assert.equal(JSON.parse(read("package.json")).dependencies, undefined);
  const worker = read("service-worker.js");
  assert.match(worker, /trustedSender\(sender\)/, "el service worker valida el origen de los mensajes");
});
