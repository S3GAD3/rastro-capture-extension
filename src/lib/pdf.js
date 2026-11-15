// src/lib/pdf.js · generador PDF propio, mínimo y sin dependencias (PDF 1.4, A4)
// Representa el mismo modelo de bloques que el informe HTML (ver report.js) con las 14 fuentes estándar
// (Helvetica, Helvetica-Bold, Courier; codificación WinAnsi), imágenes JPEG incrustadas (DCTDecode),
// encabezado y pie en cada página, paginación «Página n de N» y tablas que repiten su cabecera y no parten filas.
// Limitación: las fuentes estándar no contienen emojis ni alfabetos no latinos; esos caracteres se sustituyen
// por «?» y se advierte al final del documento. El texto íntegro figura en el informe HTML y en manifest.json.
// Funciones puras: se prueban en Node.
import { ORIGIN, TOOL } from "./report.js";

// Anchuras (milésimas de em) de los caracteres 32..255 en WinAnsi, según las métricas AFM de Adobe.
const W_REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];

const PAGE_W = 595.28, PAGE_H = 841.89;
const MARGIN = { l: 40, r: 40, t: 80, b: 54 };
const CONTENT_W = PAGE_W - MARGIN.l - MARGIN.r;
const COLOR = { text: [0.07, 0.14, 0.23], navy: [0.043, 0.122, 0.247], blue: [0.114, 0.31, 0.569], muted: [0.35, 0.43, 0.52], ok: [0.09, 0.39, 0.23], bad: [0.63, 0.11, 0.07], warn: [0.54, 0.35, 0], line: [0.79, 0.84, 0.89], soft: [0.93, 0.95, 0.97], head: [0.875, 0.91, 0.95], note: [1, 0.972, 0.882], white: [1, 1, 1] };

// ------------------------------------------------------------------- Texto (WinAnsi)
const CP1252_EXTRA = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
const ASCII_FALLBACK = { 0x2192: "->", 0x2190: "<-", 0x2248: "~", 0x2260: "!=", 0x2264: "<=", 0x2265: ">=", 0x2714: "[si]", 0x2713: "[si]", 0x2718: "[no]", 0x2717: "[no]", 0x00a0: " ", 0x2009: " ", 0x202f: " ", 0x2212: "-", 0x2010: "-", 0x2011: "-" };

/** Convierte texto a una cadena cuyos caracteres son bytes WinAnsi (0..255). Devuelve también cuántos se sustituyeron. */
export function toWinAnsi(input) {
  let out = "";
  let replaced = 0;
  for (const ch of String(input ?? "").normalize("NFC")) {
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 9) { out += cp === 10 ? "\n" : " "; continue; }
    if (cp < 32 || cp === 127 || cp === 0xad || (cp >= 0x200b && cp <= 0x200f) || cp === 0xfeff || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) { out += ch; continue; }
    if (CP1252_EXTRA[cp]) { out += String.fromCharCode(CP1252_EXTRA[cp]); continue; }
    if (ASCII_FALLBACK[cp]) { out += ASCII_FALLBACK[cp]; continue; }
    out += "?"; replaced++;
  }
  return { text: out, replaced };
}

const widthOf = (text, font, size) => {
  if (font === "M") return text.length * 0.6 * size;
  const table = font === "B" ? W_BOLD : W_REGULAR;
  let w = 0;
  for (let i = 0; i < text.length; i++) w += table[text.charCodeAt(i) - 32] || 0;
  return (w / 1000) * size;
};

/** Ajuste de línea: por palabras y, si una palabra no cabe (URL, hash), por caracteres. */
export function wrapText(text, font, size, maxWidth) {
  const lines = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/ +/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate, font, size) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      let rest = word;
      while (widthOf(rest, font, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        // búsqueda del mayor prefijo que cabe
        let lo = 1, hi = rest.length - 1;
        while (lo <= hi) { const mid = (lo + hi) >> 1; if (widthOf(rest.slice(0, mid), font, size) <= maxWidth) { cut = mid; lo = mid + 1; } else hi = mid - 1; }
        if (widthOf(rest.slice(0, cut), font, size) > maxWidth) cut = 1;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

const hex = (text) => { let h = ""; for (let i = 0; i < text.length; i++) h += (text.charCodeAt(i) & 0xff).toString(16).padStart(2, "0"); return `<${h}>`; };
const utf16Hex = (text) => { let h = "feff"; for (const unit of Array.from({ length: text.length }, (_, i) => text.charCodeAt(i))) h += unit.toString(16).padStart(4, "0"); return `<${h}>`; };
const n2 = (v) => (Math.round(v * 100) / 100).toString();
const latin1 = (text) => { const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff; return out; };

// ------------------------------------------------------------------- Imágenes JPEG
export function dataUrlBytes(dataUrl) {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!m) return null;
  const bin = atob(m[1]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/** Lee dimensiones y nº de componentes de un JPEG (marcadores SOF). Devuelve null si no es un JPEG utilizable. */
export function jpegInfo(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let o = 2;
  while (o + 9 < bytes.length) {
    if (bytes[o] !== 0xff) { o++; continue; }
    const marker = bytes[o + 1];
    if (marker === 0xff) { o++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue; }
    const len = (bytes[o + 2] << 8) | bytes[o + 3];
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[o + 5] << 8) | bytes[o + 6], width = (bytes[o + 7] << 8) | bytes[o + 8], components = bytes[o + 9];
      if (!width || !height || ![1, 3].includes(components)) return null;
      return { width, height, components };
    }
    o += 2 + len;
  }
  return null;
}

// ------------------------------------------------------------------- Documento
class PdfFile {
  constructor() { this.objects = []; }
  reserve() { this.objects.push(null); return this.objects.length; }
  add(body) { this.objects.push(body); return this.objects.length; }
  set(n, body) { this.objects[n - 1] = body; }
  build(rootRef, infoRef) {
    const chunks = [latin1("%PDF-1.4\n%âãÏÓ\n")];
    let size = chunks[0].length;
    const offsets = [];
    const push = (bytes) => { chunks.push(bytes); size += bytes.length; };
    this.objects.forEach((body, i) => {
      offsets.push(size);
      push(latin1(`${i + 1} 0 obj\n`));
      if (body && body.stream) { push(latin1(`${body.dict.replace(/>>\s*$/, "")} /Length ${body.stream.length} >>\nstream\n`)); push(body.stream); push(latin1("\nendstream\nendobj\n")); }
      else push(latin1(`${body}\nendobj\n`));
    });
    const xref = size;
    let table = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) table += `${String(off).padStart(10, "0")} 00000 n \n`;
    push(latin1(`${table}trailer\n<< /Size ${this.objects.length + 1} /Root ${rootRef} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    const out = new Uint8Array(size);
    let cursor = 0;
    for (const c of chunks) { out.set(c, cursor); cursor += c.length; }
    return out;
  }
}

const FONT_NAME = { R: "F1", B: "F2", M: "F3" };

class Layout {
  constructor(head, assets) {
    this.head = head; this.pages = []; this.images = new Map(); this.imageList = []; this.replaced = 0;
    this.crest = this.image("crest", assets.institutionLogoJpeg);
    this.rastro = this.image("rastro", assets.rastroLogo);
    this.previews = assets.previews || {};
    this.newPage();
  }
  image(key, dataUrl) {
    if (this.images.has(key)) return this.images.get(key);
    const bytes = dataUrlBytes(dataUrl);
    const info = jpegInfo(bytes);
    const img = info ? { name: `Im${this.imageList.length + 1}`, bytes, ...info } : null;
    if (img) this.imageList.push(img);
    this.images.set(key, img);
    return img;
  }
  clean(text) { const r = toWinAnsi(text); this.replaced += r.replaced; return r.text; }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = PAGE_H - MARGIN.t; }
  get room() { return this.y - MARGIN.b; }
  ensure(h) { if (this.room < h && this.y < PAGE_H - MARGIN.t - 1) { this.newPage(); return true; } return false; }
  fill(c) { this.ops.push(`${c.map(n2).join(" ")} rg`); }
  stroke(c) { this.ops.push(`${c.map(n2).join(" ")} RG`); }
  rect(x, yTop, w, h, { fill, stroke } = {}) {
    if (fill) this.fill(fill);
    if (stroke) { this.stroke(stroke); this.ops.push("0.5 w"); }
    this.ops.push(`${n2(x)} ${n2(yTop - h)} ${n2(w)} ${n2(h)} re ${fill && stroke ? "B" : fill ? "f" : "S"}`);
  }
  hline(x1, x2, y, color = COLOR.line, width = 0.5) { this.stroke(color); this.ops.push(`${n2(width)} w ${n2(x1)} ${n2(y)} m ${n2(x2)} ${n2(y)} l S`); }
  text(str, x, baseline, font = "R", size = 8.5, color = COLOR.text, ops = this.ops) {
    if (!str) return;
    ops.push(`${color.map(n2).join(" ")} rg BT /${FONT_NAME[font]} ${n2(size)} Tf ${n2(x)} ${n2(baseline)} Td ${hex(str)} Tj ET`);
  }
  drawImage(img, x, yTop, w, h, ops = this.ops) { ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(yTop - h)} cm /${img.name} Do Q`); }

  /** Normaliza un valor del modelo a líneas con estilo: [{text, font, color}] ya ajustadas a `width`. */
  cellLines(value, width, size, baseFont = "R") {
    const colorOf = (cls) => (cls && COLOR[cls.split(" ")[0]]) || COLOR.text;
    const fontOf = (c) => (c.mono ? "M" : /\b(ok|bad)\b/.test(c.cls || "") ? "B" : baseFont);
    const one = (v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) return { text: this.clean(v.text), font: fontOf(v), color: colorOf(v.cls) };
      return { text: this.clean(v), font: baseFont, color: COLOR.text };
    };
    let parts;
    if (Array.isArray(value)) {
      if (value.every((x) => typeof x === "string")) parts = value.map(one);
      else { const frags = value.map(one); parts = [{ text: frags.map((f) => f.text).join(""), font: baseFont, color: frags.find((f) => f.color !== COLOR.text)?.color || COLOR.text }]; }
    } else parts = [one(value)];
    const out = [];
    for (const part of parts) {
      const s = part.font === "M" ? size * 0.84 : size;
      for (const line of wrapText(part.text, part.font, s, width)) out.push({ text: line, font: part.font, size: s, color: part.color });
    }
    return out;
  }

  paragraph(text, { size = 8.5, font = "R", color = COLOR.text, indent = 0, box = null, gap = 4, prefix = "" } = {}) {
    const leading = size * 1.36;
    const width = CONTENT_W - indent - (box ? 12 : 0);
    const lines = wrapText(this.clean(prefix + text), font, size, width);
    if (box) {
      const h = lines.length * leading + 8;
      this.ensure(Math.min(h, PAGE_H - MARGIN.t - MARGIN.b));
      this.rect(MARGIN.l + indent, this.y, CONTENT_W - indent, Math.min(h, this.room), { fill: box.fill, stroke: box.stroke });
      this.y -= 4;
    }
    for (const line of lines) {
      if (this.room < leading) this.newPage();
      this.text(line, MARGIN.l + indent + (box ? 6 : 0), this.y - size, font, size, color);
      this.y -= leading;
    }
    this.y -= gap + (box ? 4 : 0);
  }

  heading(level, text) {
    if (level === 2) {
      this.ensure(60); this.y -= 6;
      const lines = wrapText(this.clean(text), "B", 10.5, CONTENT_W - 12);
      const h = lines.length * 13 + 5;
      this.rect(MARGIN.l, this.y, CONTENT_W, h, { fill: COLOR.navy });
      lines.forEach((line, i) => this.text(line, MARGIN.l + 6, this.y - 12 - i * 13, "B", 10.5, COLOR.white));
      this.y -= h + 7;
    } else if (level === 3) {
      this.ensure(44); this.y -= 4;
      this.text(this.clean(text), MARGIN.l, this.y - 9.5, "B", 9.5, COLOR.navy);
      this.y -= 13; this.hline(MARGIN.l, PAGE_W - MARGIN.r, this.y, COLOR.blue, 0.6); this.y -= 6;
    } else {
      this.ensure(34); this.y -= 2;
      this.text(this.clean(text), MARGIN.l, this.y - 8.5, "B", 8.5, COLOR.blue);
      this.y -= 14;
    }
  }

  /** Dibuja una fila de celdas con bordes; `cells`: [{lines, x, w, fill}] */
  row(cells, { leading = 9.6, padY = 3.2, maxLines = 60 } = {}) {
    for (const c of cells) if (c.lines.length > maxLines) { c.lines = c.lines.slice(0, maxLines); c.lines.push({ text: "[...] texto abreviado; íntegro en el informe HTML", font: "R", size: 6.5, color: COLOR.muted }); }
    const h = Math.max(...cells.map((c) => c.lines.length), 1) * leading + padY * 2;
    const moved = this.ensure(h);
    for (const c of cells) {
      this.rect(c.x, this.y, c.w, h, { fill: c.fill || COLOR.white, stroke: COLOR.line });
      c.lines.forEach((line, i) => this.text(line.text, c.x + 4, this.y - padY - leading * i - line.size, line.font, line.size, line.color));
    }
    this.y -= h;
    return moved;
  }

  kv(rows) {
    const wLabel = 150, wTag = 26, wValue = CONTENT_W - wLabel - wTag;
    for (const r of rows) {
      const value = this.cellLines(r.value, wValue - 8, 8);
      if (r.basis) for (const line of wrapText(this.clean(`Fundamento: ${r.basis}`), "R", 7, wValue - 8)) value.push({ text: line, font: "R", size: 7, color: COLOR.warn });
      const tagColor = r.origin === "A" ? COLOR.blue : r.origin === "M" ? [0.42, 0.3, 0.6] : COLOR.warn;
      this.row([
        { x: MARGIN.l, w: wLabel, fill: COLOR.soft, lines: this.cellLines(r.label, wLabel - 8, 8, "B") },
        { x: MARGIN.l + wLabel, w: wValue, lines: value },
        { x: MARGIN.l + wLabel + wValue, w: wTag, lines: r.origin ? [{ text: `[${r.origin}]`, font: "B", size: 8, color: tagColor }] : [] }
      ]);
    }
    this.y -= 6;
  }

  table(b) {
    if (!b.rows.length) { this.paragraph(b.empty || "Sin datos.", { color: COLOR.muted }); return; }
    if (b.origin) this.text(`[${b.origin}]`, MARGIN.l, this.y - 7.5, "B", 7.5, [0.42, 0.3, 0.6]), this.y -= 11;
    const total = b.columns.reduce((n, c) => n + c.w, 0);
    let x = MARGIN.l;
    const cols = b.columns.map((c) => { const w = (c.w / total) * CONTENT_W; const col = { x, w, label: c.label }; x += w; return col; });
    const header = () => this.row(cols.map((c) => ({ x: c.x, w: c.w, fill: COLOR.head, lines: this.cellLines(c.label, c.w - 8, 7.5, "B").map((l) => ({ ...l, color: COLOR.navy })) })), { leading: 9 });
    this.ensure(46);
    header();
    for (const r of b.rows) {
      const cells = cols.map((c, i) => ({ x: c.x, w: c.w, lines: this.cellLines(r[i] ?? "", c.w - 8, 7.5) }));
      const h = Math.max(...cells.map((c) => Math.min(c.lines.length, 61)), 1) * 9.2 + 6.4;
      if (this.room < h && this.y < PAGE_H - MARGIN.t - 1) { this.newPage(); header(); }
      this.row(cells, { leading: 9.2 });
    }
    this.y -= 7;
  }

  figure(b) {
    const img = b.preview ? this.image(`pv-${b.code}`, this.previews[b.code]) : null;
    const caption = b.lines.flatMap((l) => this.cellLines(l, CONTENT_W - 12, 7.5));
    let iw = 0, ih = 0;
    if (img) { const scale = Math.min((CONTENT_W - 12) / img.width, 290 / img.height, 1.4); iw = img.width * scale; ih = img.height * scale; }
    const captionH = caption.length * 9.4;
    const need = 16 + (img ? ih + 6 : 12) + Math.min(captionH, 120);
    this.ensure(need);
    this.hline(MARGIN.l, PAGE_W - MARGIN.r, this.y, COLOR.line, 0.6); this.y -= 4;
    this.text(this.clean(b.title), MARGIN.l, this.y - 9, "B", 9, COLOR.navy); this.y -= 14;
    if (img) { this.rect(MARGIN.l - 0.5, this.y + 0.5, iw + 1, ih + 1, { stroke: COLOR.line }); this.drawImage(img, MARGIN.l, this.y, iw, ih); this.y -= ih + 6; }
    else { this.text("Sin vista previa incrustada. Consulte el archivo de evidencia.", MARGIN.l, this.y - 7.5, "R", 7.5, COLOR.muted); this.y -= 12; }
    for (const line of caption) {
      if (this.room < 9.4) this.newPage();
      this.text(line.text, MARGIN.l, this.y - line.size, line.font, line.size, line.color); this.y -= 9.4;
    }
    this.y -= 8;
  }

  titleBlock() {
    const h = this.head;
    for (const line of wrapText(this.clean(h.title), "B", 13.5, CONTENT_W)) { this.text(line, MARGIN.l, this.y - 13.5, "B", 13.5, COLOR.navy); this.y -= 17; }
    this.text(this.clean(`${h.subtitle} · generado con ${h.toolLine} · ${h.generated}`), MARGIN.l, this.y - 8, "R", 8, COLOR.muted);
    this.y -= 16;
  }

  block(b) {
    switch (b.t) {
      case "h2": this.heading(2, b.text); break;
      case "h3": this.heading(3, b.text); break;
      case "h4": this.heading(4, b.text); break;
      case "p": this.paragraph(b.text, { color: b.cls === "muted" ? COLOR.muted : COLOR.text, size: b.cls === "muted" ? 7.8 : 8.5, box: b.cls === "note" ? { fill: COLOR.note, stroke: [0.88, 0.76, 0.42] } : null, prefix: b.origin ? `[${b.origin}] ` : "" }); break;
      case "list": for (const item of b.items) this.paragraph(item, { size: 8.2, indent: 10, gap: 2, prefix: "• " }); this.y -= 4; break;
      case "legend":
        this.ensure(70);
        this.paragraph("Procedencia de los datos", { font: "B", size: 8, gap: 1 });
        for (const [k, o] of Object.entries(ORIGIN)) this.paragraph(`${o.label}: ${o.text}`, { size: 7.6, gap: 1, prefix: `[${k}] `, color: COLOR.muted });
        this.y -= 5; break;
      case "kv": this.kv(b.rows); break;
      case "table": this.table(b); break;
      case "figure": this.figure(b); break;
      default: break;
    }
  }

  chrome(ops, pageNumber, pageCount) {
    const h = this.head;
    const top = PAGE_H - 26;
    let x = MARGIN.l;
    if (this.crest) { const s = Math.min(40 / this.crest.height, 90 / this.crest.width); const w = this.crest.width * s, hh = this.crest.height * s; this.drawImage(this.crest, x, top + 2 - (40 - hh) / 2, w, hh, ops); x += w + 9; }
    const refs = [h.proceedings ? `Diligencias: ${h.proceedings}` : "", h.reference ? `Expediente: ${h.reference}` : "", h.sessionId ? `Sesión: ${h.sessionId}` : ""].filter(Boolean).map((t) => toWinAnsi(t).text.slice(0, 70));
    const rightW = Math.max(0, ...refs.map((t) => widthOf(t, "R", 7.5)));
    const unitW = PAGE_W - MARGIN.r - x - rightW - 12;
    const unit = wrapText(toWinAnsi((h.unit || "Unidad investigadora no consignada").toUpperCase()).text, "B", 10, unitW).slice(0, 2);
    unit.forEach((line, i) => this.text(line, x, top - 9 - i * 12, "B", 10, COLOR.navy, ops));
    if (h.department) this.text(wrapText(toWinAnsi(h.department).text, "R", 8, unitW)[0], x, top - 9 - unit.length * 12, "R", 8, COLOR.muted, ops);
    refs.forEach((t, i) => this.text(t, PAGE_W - MARGIN.r - widthOf(t, "R", 7.5), top - 7 - i * 10, "R", 7.5, COLOR.text, ops));
    ops.push(`${COLOR.navy.map(n2).join(" ")} RG 1.4 w ${n2(MARGIN.l)} ${n2(PAGE_H - 70)} m ${n2(PAGE_W - MARGIN.r)} ${n2(PAGE_H - 70)} l S`);
    // pie
    ops.push(`${COLOR.line.map(n2).join(" ")} RG 0.5 w ${n2(MARGIN.l)} 44 m ${n2(PAGE_W - MARGIN.r)} 44 l S`);
    let fx = MARGIN.l;
    if (this.rastro) { const hh = 20, w = (this.rastro.width / this.rastro.height) * hh; this.drawImage(this.rastro, fx, 40, w, hh, ops); fx += w + 6; }
    this.text(toWinAnsi(`${h.toolLine} — Kit RASTRO · Creado por ${TOOL.author}`).text, fx, 32, "R", 7, COLOR.muted, ops);
    this.text(toWinAnsi(h.subtitle).text, fx, 23, "R", 7, COLOR.muted, ops);
    const pg = toWinAnsi(`Página ${pageNumber} de ${pageCount}`).text;
    this.text(pg, PAGE_W - MARGIN.r - widthOf(pg, "R", 8), 30, "R", 8, COLOR.text, ops);
  }
}

/**
 * Representa un modelo de informe (buildReportModel) como PDF. Devuelve los bytes del documento.
 * `assets`: { institutionLogoJpeg, rastroLogo, previews:{[code]:dataUrl JPEG} }
 */
export function renderReportPdf(model, assets = {}, { createdAt = new Date() } = {}) {
  const layout = new Layout(model.head, assets);
  layout.titleBlock();
  for (const b of model.blocks) layout.block(b);
  if (layout.replaced) layout.paragraph(`Nota: ${layout.replaced} carácter(es) no representables con las fuentes estándar de este PDF (emojis o alfabetos no latinos) se han sustituido por «?». El texto íntegro figura en el informe HTML y en metadatos/manifest.json.`, { size: 7.6, color: COLOR.warn });
  const pageCount = layout.pages.length;
  layout.pages.forEach((ops, i) => layout.chrome(ops, i + 1, pageCount));

  const pdf = new PdfFile();
  const catalog = pdf.reserve();
  const pagesRef = pdf.reserve();
  const fonts = ["Helvetica", "Helvetica-Bold", "Courier"].map((name) => pdf.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`));
  const xobjects = layout.imageList.map((img) => [img.name, pdf.add({ dict: `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode >>`, stream: img.bytes })]);
  const resources = pdf.add(`<< /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> /XObject << ${xobjects.map(([n, r]) => `/${n} ${r} 0 R`).join(" ")} >> /ProcSet [/PDF /Text /ImageB /ImageC] >>`);
  const kids = layout.pages.map((ops) => {
    const content = pdf.add({ dict: "<< >>", stream: latin1(ops.join("\n")) });
    return pdf.add(`<< /Type /Page /Parent ${pagesRef} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources ${resources} 0 R /Contents ${content} 0 R >>`);
  });
  pdf.set(pagesRef, `<< /Type /Pages /Count ${kids.length} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`);
  pdf.set(catalog, `<< /Type /Catalog /Pages ${pagesRef} 0 R /Lang (es-ES) >>`);
  const stamp = createdAt.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const h = model.head;
  const info = pdf.add(`<< /Title ${utf16Hex(`${h.subtitle} · ${h.proceedings || h.reference || h.sessionId || ""}`)} /Author ${utf16Hex(h.unit || "")} /Subject ${utf16Hex(h.title)} /Creator ${utf16Hex(h.toolLine)} /Producer ${utf16Hex(`${h.toolLine} (generador PDF propio)`)} /CreationDate (D:${stamp}Z) >>`);
  return { bytes: pdf.build(catalog, info), pages: pageCount, replaced: layout.replaced };
}
