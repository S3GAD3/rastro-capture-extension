// Genera los informes de ejemplo de docs/ejemplos a partir de datos FICTICIOS (tests/fixtures/sample.js).
import { writeFileSync, mkdirSync } from "node:fs";
import { buildReportModel, renderReportHtml } from "../src/lib/report.js";
import { renderReportPdf } from "../src/lib/pdf.js";
import { verifyPackage, verificationReportHtml } from "../src/lib/verify.js";
import { sampleManifest, assets, sha } from "./fixtures/sample.js";

const out = new URL("../docs/ejemplos/", import.meta.url);
mkdirSync(out, { recursive: true });
const manifest = sampleManifest();
const a = assets();
for (const mode of ["tecnico", "resumido"]) {
  const model = buildReportModel(manifest, mode, { previewCodes: Object.keys(a.previews) });
  writeFileSync(new URL(`informe_${mode}_ejemplo.html`, out), renderReportHtml(model, a));
  writeFileSync(new URL(`informe_${mode}_ejemplo.pdf`, out), renderReportPdf(model, a, { createdAt: new Date(manifest.generatedAt) }).bytes);
}
// Verificación de ejemplo: un archivo íntegro y otro alterado.
const enc = (t) => new TextEncoder().encode(t);
const good = enc("contenido íntegro"), bad = enc("contenido original");
const m = enc(JSON.stringify({ schema: "RASTRO-CAPTURE/3", tool: manifest.tool, generatedAt: manifest.generatedAt, session: { id: manifest.session.id }, case: manifest.case, evidence: [{ code: "EV-0001", path: "evidencias/capturas/EV-0001_ejemplo.png", sha256: sha(good) }, { code: "EV-0002", path: "evidencias/capturas/EV-0002_ejemplo.png", sha256: sha(bad) }] }));
const file = (path, bytes) => ({ path, size: bytes.length, read: async () => new Blob([bytes]) });
const result = await verifyPackage([file("metadatos/manifest.json", m), file("evidencias/capturas/EV-0001_ejemplo.png", good), file("evidencias/capturas/EV-0002_ejemplo.png", enc("contenido alterado"))]);
result.verifiedAt = "2026-11-16T09:00:00.000Z";
writeFileSync(new URL("informe_verificacion_ejemplo.html", out), verificationReportHtml(result, { rastroLogo: a.rastroLogo, toolVersion: manifest.tool.version, localTime: "2026-11-16 10:00:00 (UTC+01:00)", source: "Carpeta de ejemplo (datos ficticios)" }));
console.log("Ejemplos generados en docs/ejemplos/");
