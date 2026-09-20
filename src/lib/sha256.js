// src/lib/sha256.js
// SHA-256 mediante Web Crypto (crypto.subtle) para datos en memoria y una implementación
// incremental propia para ficheros grandes (evita cargar en memoria vídeos de cientos de MB).
// Ambas rutas producen exactamente el mismo resultado (verificado en tests contra node:crypto).

function getSubtle() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto API (crypto.subtle) no está disponible en este entorno.");
  return subtle;
}

export function bufferToHex(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/** Calcula el SHA-256 (hex minúsculo) de una cadena UTF-8, Uint8Array o ArrayBuffer. */
export async function sha256Hex(data) {
  const subtle = getSubtle();
  let bytes;
  if (typeof data === "string") bytes = new TextEncoder().encode(data);
  else if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else throw new TypeError("sha256Hex admite string, Uint8Array o ArrayBuffer.");
  return bufferToHex(await subtle.digest("SHA-256", bytes));
}

export function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

// ---- Implementación incremental ----
const PRIMES = (() => {
  const list = [];
  for (let n = 2; list.length < 64; n++) if (list.every((p) => n % p)) list.push(n);
  return list;
})();
const frac32 = (x) => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(PRIMES.map((p) => frac32(Math.cbrt(p))));
const H0 = Uint32Array.from(PRIMES.slice(0, 8).map((p) => frac32(Math.sqrt(p))));
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export class Sha256 {
  constructor() {
    this.h = Uint32Array.from(H0);
    this.block = new Uint8Array(64);
    this.blockLength = 0;
    this.length = 0;
    this.w = new Uint32Array(64);
    this.finished = false;
  }

  #compress(chunk, offset) {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((chunk[j] << 24) | (chunk[j + 1] << 16) | (chunk[j + 2] << 8) | chunk[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    this.h[0] += a; this.h[1] += b; this.h[2] += c; this.h[3] += d;
    this.h[4] += e; this.h[5] += f; this.h[6] += g; this.h[7] += h;
  }

  update(bytes) {
    if (this.finished) throw new Error("El hash ya fue finalizado.");
    let offset = 0;
    this.length += bytes.length;
    if (this.blockLength) {
      const take = Math.min(64 - this.blockLength, bytes.length);
      this.block.set(bytes.subarray(0, take), this.blockLength);
      this.blockLength += take;
      offset = take;
      if (this.blockLength === 64) { this.#compress(this.block, 0); this.blockLength = 0; }
    }
    while (offset + 64 <= bytes.length) { this.#compress(bytes, offset); offset += 64; }
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLength = bytes.length - offset;
    }
    return this;
  }

  digestHex() {
    if (!this.finished) {
      const bitLength = this.length * 8;
      const pad = new Uint8Array(((this.blockLength < 56 ? 56 : 120) - this.blockLength) + 8);
      pad[0] = 0x80;
      const view = new DataView(pad.buffer);
      view.setUint32(pad.length - 8, Math.floor(bitLength / 2 ** 32));
      view.setUint32(pad.length - 4, bitLength >>> 0);
      const keep = this.length;
      this.update(pad);
      this.length = keep;
      this.finished = true;
    }
    const out = new Uint8Array(32);
    const view = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) view.setUint32(i * 4, this.h[i]);
    return bufferToHex(out);
  }
}

const SLICE = 4 * 1024 * 1024;
const SUBTLE_LIMIT = 48 * 1024 * 1024;

/** SHA-256 de un Blob. Hasta 48 MB usa Web Crypto; por encima procesa por tramos de 4 MB. */
export async function sha256Blob(blob, onProgress) {
  if (blob.size <= SUBTLE_LIMIT) return sha256Hex(new Uint8Array(await blob.arrayBuffer()));
  const hasher = new Sha256();
  for (let offset = 0; offset < blob.size; offset += SLICE) {
    hasher.update(new Uint8Array(await blob.slice(offset, offset + SLICE).arrayBuffer()));
    onProgress?.(Math.min(1, (offset + SLICE) / blob.size));
  }
  return hasher.digestHex();
}
