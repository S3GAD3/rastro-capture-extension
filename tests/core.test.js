import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createZip, readZipEntries } from "../src/lib/zipWriter.js";
import { sha256Hex, utf8Bytes } from "../src/lib/sha256.js";
import { sniffMedia, validateMediaBytes } from "../src/lib/mediaValidation.js";

test("SHA-256 usa los bytes exactos", async () => {
  assert.equal(await sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("el paquete ZIP conserva rutas y contenido", () => {
  const input = [
    { path: "MANIFEST.json", bytes: utf8Bytes('{"ok":true}') },
    { path: "capturas/prueba.png", bytes: new Uint8Array([1, 2, 3, 4]) }
  ];
  const output = readZipEntries(createZip(input));
  assert.deepEqual(output.map((item) => item.path), input.map((item) => item.path));
  assert.deepEqual([...output[1].bytes], [1, 2, 3, 4]);
});

test("el ZIP rechaza contenido alterado", () => {
  const zip = createZip([{ path: "evidencia.txt", bytes: utf8Bytes("original") }]);
  const dataOffset = 30 + utf8Bytes("evidencia.txt").length;
  zip[dataOffset + 1] ^= 0xff;
  assert.throws(() => readZipEntries(zip));
});

test("reconoce MP4 y WebM por firma, no por extensión", () => {
  const mp4 = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webm = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 1, 0, 0, 0]);
  assert.equal(sniffMedia(mp4)?.mime, "video/mp4");
  assert.equal(sniffMedia(webm)?.mime, "video/webm");
});

test("distingue una imagen AVIF de un vídeo MP4", () => {
  const avif = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(validateMediaBytes(avif, { kind: "imagen" }).mime, "image/avif");
  assert.throws(() => validateMediaBytes(avif, { kind: "vídeo directo" }), /contiene realmente/);
});

test("rechaza HTML o JSON renombrado como vídeo", () => {
  assert.throws(() => validateMediaBytes(utf8Bytes("<!doctype html><title>Error</title>"), { kind: "vídeo directo", contentType: "text/html" }), /página o datos/);
  assert.throws(() => validateMediaBytes(utf8Bytes('{"status":"forbidden"}'), { kind: "vídeo directo", contentType: "application/json" }), /página o datos/);
});

test("el paquete contiene todos los módulos y páginas de ejecución", () => {
  for (const file of ["manifest.json", "sidepanel.html", "sidepanel.js", "styles.css", "recorder.html", "recorder.js", "recorder.css", "report.html", "report-view.js", "verify.html", "verify.js", "tools.css", "service-worker.js", "extractor.js", "src/lib/sha256.js", "src/lib/zipWriter.js", "src/lib/zipReader.js", "src/lib/mediaValidation.js", "src/lib/mediaFetch.js", "src/lib/store.js", "src/lib/paths.js", "src/lib/report.js", "src/lib/pdf.js", "src/lib/verify.js", "src/panel/context.js", "src/panel/packager.js", "src/page/normalize.js", "src/page/hook.js", "assets/rastro-capture-mark.png", "assets/rastro-capture-logo.jpg", "assets/rastro-capture-logo-report.jpg", "icons/icon16.png", "icons/icon128.png"]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `Falta ${file}`);
  }
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, "0.5.0");
  assert.equal(manifest.permissions.includes("tabCapture"), false);
  assert.equal(manifest.permissions.includes("desktopCapture"), true);
  const panel = readFileSync(new URL("../sidepanel.js", import.meta.url), "utf8");
  const recorder = readFileSync(new URL("../recorder.js", import.meta.url), "utf8");
  assert.match(panel, /chrome\.downloads\.download/);
  assert.match(panel, /RASTRO-CAPTURE\//);
  assert.match(recorder, /chrome\.desktopCapture\.chooseDesktopMedia/);
  assert.doesNotMatch(recorder, /getDisplayMedia/);
});

import { Sha256, sha256Blob } from "../src/lib/sha256.js";
import { createZipBlob } from "../src/lib/zipWriter.js";
import { createHash, randomBytes } from "node:crypto";
import { toCsv, reportHtml, buildManifest, escapeHtml } from "../src/lib/report.js";
import { inspectMp4 } from "../src/lib/mediaValidation.js";
import { evidenceFilename, folderFor, formatLocal } from "../src/lib/paths.js";

test("SHA-256 incremental coincide con node:crypto en longitudes límite", () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 65537]) {
    const data = randomBytes(len);
    const h = new Sha256();
    for (let o = 0, step = 1; o < len; o += step, step = (step * 3 + 7) % 200 + 1) h.update(new Uint8Array(data.subarray(o, o + step)));
    assert.equal(h.digestHex(), createHash("sha256").update(data).digest("hex"), `len ${len}`);
  }
});

test("sha256Blob usa la ruta incremental por encima de 48 MB con el mismo resultado", async () => {
  const data = randomBytes(50 * 1024 * 1024);
  assert.equal(await sha256Blob(new Blob([data])), createHash("sha256").update(data).digest("hex"));
});

test("createZipBlob genera un ZIP válido sin duplicar contenido", async () => {
  const { blob } = await createZipBlob([{ path: "a/b.txt", bytes: utf8Bytes("hola") }, { path: "g.bin", blob: new Blob([new Uint8Array(1_000_000).fill(7)]) }]);
  const back = readZipEntries(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(back.map((e) => [e.path, e.bytes.length]), [["a/b.txt", 4], ["g.bin", 1_000_000]]);
});

test("detecta MP4 incompleto (tramo parcial) y acepta uno con moov", async () => {
  const box = (type, size) => { const b = new Uint8Array(size); new DataView(b.buffer).setUint32(0, size); b.set([...type].map((c) => c.charCodeAt(0)), 4); return b; };
  const ok = new Blob([box("ftyp", 24), box("moov", 40), box("mdat", 100)]);
  assert.equal((await inspectMp4(ok)).complete, true);
  const cut = new Blob([box("ftyp", 24), box("mdat", 500)].map((b, i) => (i ? b.subarray(0, 200) : b)));
  assert.equal((await inspectMp4(cut)).complete, false);
});

test("CSV neutraliza fórmulas y escapa separadores", () => {
  const csv = toCsv([{ label: "t", get: (r) => r }], ["=HYPERLINK(\"x\")", "a;b", "+1"]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"a;b"/);
  assert.match(csv, /'\+1/);
});

test("el informe escapa contenido de terceros y no admite enlaces javascript:", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const manifest = buildManifest({ caseData: { reference: evil }, evidence: [{ code: "EV-0001", seq: 1, id: "1", kind: "screenshot-visible", type: "x", filename: "a.png", zipPath: "capturas/a.png", mime: "image/png", size: 10, sha256: "a".repeat(64), createdAt: "2026-01-01T00:00:00Z", integrityVerified: true, source: { platform: "Web", url: "javascript:alert(1)", description: evil, post: { caption: evil, hashtags: [], mentions: [], taggedUsers: [], metrics: {}, media: [] } }, details: {} }] });
  const html = reportHtml(manifest) + reportHtml(manifest, { mode: "resumido" });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Content-Security-Policy/);
  assert.equal(escapeHtml("<&>"), "&lt;&amp;&gt;");
});

test("nombres únicos por código y fechas locales con desplazamiento", () => {
  assert.equal(evidenceFilename("EV-0007", "Instagram usuario/1", ".jpg"), "EV-0007_Instagram-usuario-1.jpg");
  assert.equal(folderFor("media-video", { platform: "Instagram", username: "u", postId: "ABC" }), "medios/instagram/u/ABC");
  assert.equal(formatLocal("2026-09-19T19:03:12Z", 120), "2026-09-19 21:03:12 (UTC+02:00)");
});
