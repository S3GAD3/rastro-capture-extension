// src/page/hook.js
// Recolector pasivo. Se ejecuta en el mundo MAIN de la pestaña (document_start en Instagram/TikTok, o
// bajo demanda en otros sitios). Observa las respuestas JSON que la propia página ya recibe por fetch/XHR
// y extrae de ellas publicaciones y cuentas. No realiza peticiones propias, no lee cookies ni cabeceras
// de autenticación y no modifica el contenido de las respuestas.
(function () {
  "use strict";
  const N = globalThis.RastroNormalize;
  if (!N || globalThis.__RASTRO_HARVEST) return;

  const MAX_BODY = 12 * 1024 * 1024;
  const MAX_RAW_TOTAL = 24 * 1024 * 1024;
  const MAX_RAW_ITEMS = 40;
  const RELEVANT = /graphql|\/api\/|\/ajax\/|item_list|itemlist|aweme|feed|clips|reels|web_profile_info|user\/detail|\/post\/|explore|search|story|stories|highlight|comment|\/v1\//i;

  const posts = new Map();
  const accounts = new Map();
  const raw = [];
  let rawBytes = 0;
  const counters = { responses: 0, parsed: 0, withData: 0, errors: 0 };

  function keep(url, text, postCount, accountCount) {
    if (raw.length >= MAX_RAW_ITEMS || rawBytes + text.length > MAX_RAW_TOTAL) return -1;
    raw.push({ url, at: new Date().toISOString(), size: text.length, posts: postCount, accounts: accountCount, text });
    rawBytes += text.length;
    return raw.length - 1;
  }

  function handle(url, text) {
    counters.responses++;
    if (!text || text.length > MAX_BODY) return;
    try {
      const body = text.replace(/^for\s*\(;;\);\s*/, "").trim();
      if (body[0] !== "{" && body[0] !== "[") return;
      const json = JSON.parse(body);
      counters.parsed++;
      const found = N.extract(json, url.replace(/\?.*$/, "").slice(-120));
      if (!found.posts.length && !found.accounts.length) return;
      counters.withData++;
      const before = posts.size;
      N.mergeInto(posts, found.posts, N.postKey, N.mergePost);
      N.mergeInto(accounts, found.accounts, N.accountKey, N.mergeAccount);
      if (found.posts.length || posts.size !== before) {
        const index = keep(url, body, found.posts.length, found.accounts.length);
        if (index >= 0) for (const p of found.posts) { const stored = posts.get(N.postKey(p)); if (stored) (stored.rawIndexes ||= []).push(index); }
      }
    } catch { counters.errors++; }
  }

  const originalFetch = globalThis.fetch;
  if (typeof originalFetch === "function") {
    globalThis.fetch = function (...args) {
      const promise = originalFetch.apply(this, args);
      promise.then((response) => {
        try {
          if (!response || !RELEVANT.test(response.url || "")) return;
          const type = response.headers.get("content-type") || "";
          if (!/json|javascript|text\/plain/i.test(type)) return;
          response.clone().text().then((text) => handle(response.url, text)).catch(() => {});
        } catch { /* nunca interferir con la página */ }
      }).catch(() => {});
      return promise;
    };
  }

  const XHR = globalThis.XMLHttpRequest;
  if (XHR?.prototype) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (method, url, ...rest) {
      try { this.__rastroUrl = String(url); } catch { /* ignorar */ }
      return open.call(this, method, url, ...rest);
    };
    const send = XHR.prototype.send;
    XHR.prototype.send = function (...args) {
      try {
        this.addEventListener("loadend", () => {
          try {
            const url = this.responseURL || this.__rastroUrl || "";
            if (!RELEVANT.test(url)) return;
            if (this.responseType === "" || this.responseType === "text") handle(url, this.responseText);
            else if (this.responseType === "json" && this.response) handle(url, JSON.stringify(this.response));
          } catch { /* ignorar */ }
        });
      } catch { /* ignorar */ }
      return send.apply(this, args);
    };
  }

  Object.defineProperty(globalThis, "__RASTRO_HARVEST", {
    value: {
      version: 1,
      startedAt: new Date().toISOString(),
      lateInjection: document.readyState !== "loading" && performance.now() > 1500,
      snapshot() {
        return {
          startedAt: this.startedAt, lateInjection: this.lateInjection, counters: { ...counters },
          posts: [...posts.values()], accounts: [...accounts.values()],
          rawIndex: raw.map((r, index) => ({ index, url: r.url, at: r.at, size: r.size, posts: r.posts, accounts: r.accounts }))
        };
      },
      raw(index) { return raw[index] ? { url: raw[index].url, at: raw[index].at, text: raw[index].text } : null; }
    },
    enumerable: false, configurable: false, writable: false
  });
})();
