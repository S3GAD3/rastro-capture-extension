// src/panel/stitch.js · captura por tramos (publicación / página completa) con soporte de scroll interno.
// No guarda nada: devuelve las partes PNG y los metadatos técnicos. El llamador las registra como evidencia.

const MIN_FRAME_INTERVAL_MS = 620; // captureVisibleTab admite ~2 llamadas por segundo
const SETTLE_MS = 450;
const MAX_FRAMES = 220;
const MAX_CONTENT_CSS_PX = 150000;
const MAX_PART_PIXELS = 48_000_000;
const MAX_PART_HEIGHT_PX = 12000;
const MAX_WIDTH_PX = 12000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] || "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const canvasBlob = (canvas) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo crear la imagen PNG."))), "image/png"));

/**
 * @param {object} deps  { send(type, extra), isCancelled(), onProgress(text) }
 * @param {object} opts  { mode: "target"|"page", hideFixed, lazyLoad }
 */
export async function stitchCapture(deps, { mode, hideFixed = true, lazyLoad = true }) {
  const { send, isCancelled, onProgress } = deps;

  await send("SCROLLER");
  let startInfo = await send("SCROLLER");
  const startTab = await send("TAB_INFO");
  const startUrl = startTab.url;

  // 1) Cargar contenido perezoso recorriendo el contenedor una vez (solo página completa)
  if (mode === "page" && lazyLoad) {
    let idle = 0;
    for (let step = 0; step < 60 && idle < 2; step++) {
      if (isCancelled()) throw new Error("Operación cancelada.");
      onProgress(`Cargando contenido de la página (${step + 1})…`);
      const r = await send("AUTOSCROLL_STEP", { waitMs: 900 });
      idle = r.atBottom && !r.grew ? idle + 1 : 0;
    }
    await send("SCROLL_TO", { y: 0 });
    await sleep(400);
    startInfo = await send("SCROLLER");
  }

  const info = startInfo;
  const region = info.region;
  let targetGeo = null;
  if (mode === "target") {
    targetGeo = await send("TARGET_GEOMETRY");
    if (!targetGeo || targetGeo.width < 2 || targetGeo.height < 2) throw new Error("No se ha encontrado el elemento a capturar. Pulsa Analizar página actual y reintenta.");
  }

  const contentTop = mode === "target" ? Math.max(0, targetGeo.contentTop) : 0;
  let contentEnd = mode === "target" ? targetGeo.contentTop + targetGeo.height : info.scrollHeight;
  if (contentEnd - contentTop > MAX_CONTENT_CSS_PX) throw new Error("El contenido es demasiado largo para una sola captura. Usa capturas parciales o carga menos publicaciones.");

  const srcLeft = mode === "target" ? Math.max(region.left, targetGeo.left) : region.left;
  const srcRight = mode === "target" ? Math.min(region.left + region.width, targetGeo.left + targetGeo.width) : region.left + region.width;
  const srcWidth = srcRight - srcLeft;
  if (srcWidth < 2) throw new Error("El elemento objetivo queda fuera del área visible. Desplázate hasta verlo y reintenta.");

  const prepared = await send("PREPARE_CAPTURE", { hideFixed });
  const parts = new Map();
  let frames = 0;
  let lastCaptureAt = 0;
  let outScale = 1;
  let partRows = 0;
  let endUrl = startUrl;

  try {
    let cursor = contentTop;
    while (cursor < contentEnd - 0.5) {
      if (isCancelled()) throw new Error("Operación cancelada.");
      if (frames >= MAX_FRAMES) throw new Error("La captura alcanzó el límite de tramos antes de finalizar. Divide el contenido en varias capturas.");
      const maxTop = Math.max(0, info.scrollHeight - info.clientHeight);
      const desired = Math.min(cursor, maxTop);
      const position = await send("SCROLL_TO", { y: desired });
      const wait = Math.max(SETTLE_MS, MIN_FRAME_INTERVAL_MS - (Date.now() - lastCaptureAt));
      await sleep(wait);
      const frame = await send("CAPTURE_FRAME");
      lastCaptureAt = Date.now();
      endUrl = frame.url;
      if (frame.url !== startUrl) throw new Error("La dirección de la pestaña cambió durante la captura. Repite la operación sin navegar.");
      const bitmap = await createImageBitmap(dataUrlToBlob(frame.dataUrl));
      const ratioX = bitmap.width / info.viewportWidth;
      const ratioY = bitmap.height / info.viewportHeight;

      if (frames === 0) {
        const maxScale = Math.min(ratioX, MAX_WIDTH_PX / srcWidth);
        outScale = Math.max(0.1, maxScale);
        const partHeightPx = Math.max(1000, Math.min(MAX_PART_HEIGHT_PX, Math.floor(MAX_PART_PIXELS / Math.max(1, srcWidth * outScale))));
        partRows = Math.max(200, Math.floor(partHeightPx / outScale));
      }

      const frameTop = position.top;
      const frameEnd = frameTop + info.clientHeight;
      const from = Math.max(cursor, frameTop);
      const rowsEnd = Math.min(frameEnd, contentEnd);
      if (rowsEnd <= from) { bitmap.close?.(); throw new Error("La página no avanzó al desplazarla; no se puede completar la captura."); }

      let row = from;
      while (row < rowsEnd - 0.01) {
        const partIndex = Math.floor((row - contentTop) / partRows);
        const partStart = contentTop + partIndex * partRows;
        const sliceEnd = Math.min(rowsEnd, partStart + partRows);
        let part = parts.get(partIndex);
        if (!part) {
          const heightRows = Math.min(partRows, Math.max(1, contentEnd - partStart));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(srcWidth * outScale));
          canvas.height = Math.max(1, Math.round(heightRows * outScale));
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) throw new Error("El navegador no pudo crear el lienzo de captura (memoria insuficiente).");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          part = { canvas, ctx, usedRows: 0, start: partStart };
          parts.set(partIndex, part);
        }
        const sx = srcLeft * ratioX;
        const sy = (region.top + (row - frameTop)) * ratioY;
        const sw = srcWidth * ratioX;
        const sh = (sliceEnd - row) * ratioY;
        const dy = Math.round((row - partStart) * outScale);
        const dh = Math.max(1, Math.round((sliceEnd - row) * outScale));
        if (dy + dh > part.canvas.height) { // el contenido creció durante la captura: ampliar el lienzo de esta parte
          const bigger = document.createElement("canvas");
          bigger.width = part.canvas.width; bigger.height = dy + dh;
          const bctx = bigger.getContext("2d", { alpha: false });
          bctx.fillStyle = "#fff"; bctx.fillRect(0, 0, bigger.width, bigger.height);
          bctx.drawImage(part.canvas, 0, 0);
          part.canvas = bigger; part.ctx = bctx;
        }
        part.ctx.drawImage(bitmap, sx, sy, sw, sh, 0, dy, part.canvas.width, dh);
        part.usedRows = Math.max(part.usedRows, sliceEnd - partStart);
        row = sliceEnd;
      }
      bitmap.close?.();
      frames++;
      cursor = rowsEnd;
      if (mode === "page" && position.scrollHeight > contentEnd) contentEnd = Math.min(position.scrollHeight, contentTop + MAX_CONTENT_CSS_PX);
      onProgress(`Capturando ${mode === "target" ? "elemento" : "página"}: tramo ${frames} (${Math.min(100, Math.round(((cursor - contentTop) / Math.max(1, contentEnd - contentTop)) * 100))} %)…`);
    }
  } finally {
    await send("RESTORE_CAPTURE", { state: prepared }).catch(() => {});
  }

  const ordered = [...parts.entries()].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [, part] of ordered) {
    let canvas = part.canvas;
    const usedPx = Math.max(1, Math.round(part.usedRows * outScale));
    if (usedPx < canvas.height) {
      const trimmed = document.createElement("canvas");
      trimmed.width = canvas.width; trimmed.height = usedPx;
      trimmed.getContext("2d", { alpha: false }).drawImage(canvas, 0, 0);
      canvas = trimmed;
    }
    const blob = await canvasBlob(canvas);
    if (!blob.size) throw new Error("La captura generada está vacía.");
    out.push({ blob, pixelWidth: canvas.width, pixelHeight: canvas.height });
  }
  if (!out.length) throw new Error("No se generó ninguna imagen.");
  return {
    parts: out,
    meta: {
      frames, fixedHidden: prepared?.hidden ?? 0, scrollMode: info.mode, startUrl, endUrl,
      region: mode === "target" ? `elemento ${Math.round(srcWidth)}×${Math.round(contentEnd - contentTop)} px CSS` : `${info.mode === "element" ? "contenedor interno" : "página"} ${Math.round(srcWidth)}×${Math.round(contentEnd - contentTop)} px CSS`,
      viewport: `${info.viewportWidth}x${info.viewportHeight}`, devicePixelRatio: info.devicePixelRatio, outputScale: Number(outScale.toFixed(3))
    }
  };
}
