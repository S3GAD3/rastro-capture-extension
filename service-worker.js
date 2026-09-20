// RASTRO CAPTURE · service worker (MV3)
// Operaciones sobre la pestaña objetivo: análisis, geometría de captura, desplazamiento, navegación.
// El panel lateral orquesta; este worker solo ejecuta operaciones atómicas y comprobadas.

const STYLE_ID = "rastro-capture-preparation";
const COLLECTOR_FILES = ["src/page/normalize.js", "src/page/hook.js"];

// ---------------------------------------------------------------- Inicio
async function configurePanel() {
  try { await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }); } catch { /* navegador sin sidePanel */ }
}
chrome.runtime.onInstalled.addListener(configurePanel);
chrome.runtime.onStartup.addListener(configurePanel);
configurePanel();

// Los CDN de vídeo comprueban el origen de la petición. Cuando el propio navegador reproduce el vídeo envía
// Referer de la plataforma; la descarga desde la extensión debe presentar el mismo Referer que la página.
// Solo afecta a peticiones iniciadas por esta extensión y a dominios de Instagram/TikTok.
async function installNetworkRules() {
  const initiatorDomains = [chrome.runtime.id];
  const resourceTypes = ["xmlhttprequest", "media", "image", "other"];
  const referer = (value) => [{ header: "Referer", operation: "set", value }];
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1, 2],
      addRules: [
        { id: 1, priority: 1, action: { type: "modifyHeaders", requestHeaders: referer("https://www.tiktok.com/") },
          condition: { initiatorDomains, resourceTypes, requestDomains: ["tiktokcdn.com", "tiktokcdn-us.com", "tiktokv.com", "tiktokv.us", "byteoversea.com", "ibytedtos.com", "muscdn.com"] } },
        { id: 2, priority: 1, action: { type: "modifyHeaders", requestHeaders: referer("https://www.instagram.com/") },
          condition: { initiatorDomains, resourceTypes, requestDomains: ["cdninstagram.com", "fbcdn.net"] } }
      ]
    });
  } catch (error) { console.warn("RASTRO: no se pudieron instalar las reglas de red", error); }
}
installNetworkRules();
chrome.runtime.onStartup.addListener(installNetworkRules);
chrome.runtime.onInstalled.addListener(installNetworkRules);

// ---------------------------------------------------------------- Utilidades de pestaña
const isWeb = (url) => /^https?:\/\//i.test(url || "");

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("No se ha encontrado una pestaña activa.");
  if (!isWeb(tab.url)) throw new Error("Esta página interna del navegador no se puede analizar. Abre una web HTTP/HTTPS.");
  return tab;
}

async function messageTab(message) {
  if (Number.isInteger(message?.tabId)) {
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab?.id || !isWeb(tab.url)) throw new Error("La pestaña objetivo ya no está disponible.");
    return tab;
  }
  return activeTab();
}

async function runFile(tabId, files, world) {
  const target = { tabId };
  const result = await chrome.scripting.executeScript({ target, files: Array.isArray(files) ? files : [files], ...(world ? { world } : {}) });
  return result?.[0]?.result;
}

async function runFunction(tabId, func, args = [], world) {
  const result = await chrome.scripting.executeScript({ target: { tabId }, func, args, ...(world ? { world } : {}) });
  return result?.[0]?.result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- Funciones que se ejecutan EN la página
// Cada una debe ser autónoma (se serializa): no puede usar variables externas.

function pageMarkScroller() {
  // Localiza el contenedor que realmente desplaza el contenido: la ventana o un elemento con overflow propio.
  document.querySelectorAll("[data-rastro-scroller]").forEach((el) => el.removeAttribute("data-rastro-scroller"));
  const doc = document.scrollingElement || document.documentElement;
  const vw = innerWidth, vh = innerHeight;
  const before = window.scrollY;
  let windowRange = doc.scrollHeight - vh;
  if (windowRange > 8) {
    window.scrollTo(0, before + 1);
    const moved = window.scrollY !== before;
    window.scrollTo(0, before);
    if (!moved) windowRange = 0;
  } else windowRange = 0;

  let best = null;
  const all = document.querySelectorAll("body *");
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.scrollHeight <= el.clientHeight + 40 || el.clientHeight < 150 || el.clientWidth < 200) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
    const r = el.getBoundingClientRect();
    const visW = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const visH = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
    const share = (visW * visH) / (vw * vh);
    if (share < 0.2) continue;
    const score = (el.scrollHeight - el.clientHeight) * share;
    if (!best || score > best.score) best = { el, score, share };
  }
  const useElement = best && (windowRange === 0 || best.score > windowRange * 0.8);
  if (useElement) {
    best.el.setAttribute("data-rastro-scroller", "1");
    const r = best.el.getBoundingClientRect();
    return { mode: "element", scrollHeight: best.el.scrollHeight, clientHeight: best.el.clientHeight, scrollTop: best.el.scrollTop, region: { left: Math.max(0, r.left), top: Math.max(0, r.top), width: Math.min(r.width, vw), height: Math.min(r.height, vh) }, viewportWidth: vw, viewportHeight: vh, devicePixelRatio: window.devicePixelRatio || 1 };
  }
  return { mode: "window", scrollHeight: Math.max(doc.scrollHeight, document.body?.scrollHeight || 0), clientHeight: vh, scrollTop: window.scrollY, region: { left: 0, top: 0, width: vw, height: vh }, viewportWidth: vw, viewportHeight: vh, devicePixelRatio: window.devicePixelRatio || 1 };
}

function pageTargetGeometry() {
  const target = document.querySelector("[data-rastro-capture-target]");
  if (!target) return null;
  const scroller = document.querySelector("[data-rastro-scroller]");
  const r = target.getBoundingClientRect();
  if (scroller) {
    const s = scroller.getBoundingClientRect();
    return { contentTop: r.top - s.top + scroller.scrollTop, left: r.left, width: r.width, height: r.height };
  }
  return { contentTop: r.top + window.scrollY, left: r.left + window.scrollX, width: r.width, height: r.height };
}

function pageScrollTo(y) {
  const scroller = document.querySelector("[data-rastro-scroller]");
  return new Promise((resolve) => {
    if (scroller) scroller.scrollTo({ top: y, behavior: "instant" });
    else window.scrollTo({ left: 0, top: y, behavior: "instant" });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (scroller) resolve({ top: scroller.scrollTop, scrollHeight: scroller.scrollHeight, url: location.href });
      else resolve({ top: window.scrollY, scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), url: location.href });
    }));
  });
}

function pagePrepare(styleId, hideFixed) {
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = 'html{scroll-behavior:auto!important}[data-rastro-capture-hide="true"]{visibility:hidden!important}';
    document.documentElement.appendChild(style);
  }
  const scroller = document.querySelector("[data-rastro-scroller]");
  const target = document.querySelector("[data-rastro-capture-target]");
  const state = { x: window.scrollX, y: window.scrollY, elementTop: scroller ? scroller.scrollTop : null, hidden: 0 };
  document.documentElement.dataset.rastroOldBehavior = document.documentElement.style.scrollBehavior || "";
  document.documentElement.style.scrollBehavior = "auto";
  if (hideFixed) {
    const all = document.querySelectorAll("body *");
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const position = getComputedStyle(el).position;
      if (position !== "fixed" && position !== "sticky") continue;
      if (el.contains(target) || el.contains(scroller) || el === scroller) continue;
      if (el.closest('[data-rastro-capture-hide="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      el.setAttribute("data-rastro-capture-hide", "true");
      state.hidden++;
    }
  }
  return state;
}

function pageRestore(styleId, state) {
  document.querySelectorAll('[data-rastro-capture-hide="true"]').forEach((el) => el.removeAttribute("data-rastro-capture-hide"));
  document.getElementById(styleId)?.remove();
  document.documentElement.style.scrollBehavior = document.documentElement.dataset.rastroOldBehavior || "";
  delete document.documentElement.dataset.rastroOldBehavior;
  const scroller = document.querySelector("[data-rastro-scroller]");
  if (scroller && state?.elementTop !== null && state?.elementTop !== undefined) scroller.scrollTo({ top: state.elementTop, behavior: "instant" });
  window.scrollTo({ left: state?.x || 0, top: state?.y || 0, behavior: "instant" });
  return true;
}

async function pageAutoScrollStep(waitMs) {
  const scroller = document.querySelector("[data-rastro-scroller]");
  const read = () => scroller
    ? { top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight }
    : { top: window.scrollY, height: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0), client: innerHeight };
  const items = () => document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/video/"], a[href*="/photo/"]').length;
  const before = read();
  const itemsBefore = items();
  const next = Math.max(0, Math.min(before.top + before.client * 0.9, before.height - before.client));
  if (scroller) scroller.scrollTo({ top: next, behavior: "instant" }); else window.scrollTo({ top: next, behavior: "instant" });
  const started = performance.now();
  let grew = false;
  while (performance.now() - started < waitMs) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (read().height > before.height || items() > itemsBefore) { grew = true; await new Promise((resolve) => setTimeout(resolve, 250)); break; }
  }
  const after = read();
  return { top: after.top, height: after.height, client: after.client, atBottom: after.top + after.client >= after.height - 4, grew, items: items() };
}

function pageStartMonitor() {
  if (globalThis.__rastroCaptureObserver) return { active: true, reused: true };
  performance.setResourceTimingBufferSize?.(3000);
  const urls = new Set();
  const relevant = (url) => /(?:\.mp4(?:\?|$)|\.webm(?:\?|$)|\.m3u8(?:\?|$)|\.mpd(?:\?|$)|\/video\/tos\/|mime_type=video)/i.test(url);
  const publish = () => { document.documentElement.dataset.rastroMediaUrls = JSON.stringify([...urls].slice(-200)); };
  performance.getEntriesByType("resource").forEach((entry) => { if (relevant(entry.name)) urls.add(entry.name); });
  globalThis.__rastroCaptureObserver = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => { if (relevant(entry.name)) urls.add(entry.name); });
    publish();
  });
  globalThis.__rastroCaptureObserver.observe({ type: "resource", buffered: true });
  publish();
  return { active: true, found: urls.size };
}

function pageReadHarvest() {
  const h = globalThis.__RASTRO_HARVEST;
  return h ? h.snapshot() : null;
}

function pageReadRaw(index) {
  return globalThis.__RASTRO_HARVEST?.raw(index) || null;
}

// ---------------------------------------------------------------- Operaciones
async function captureFrame(tab, attempts = 4) {
  const fresh = await chrome.tabs.get(tab.id);
  if (!fresh.active) throw new Error("La pestaña objetivo dejó de estar activa durante la captura. Mantén visible la pestaña hasta que termine y repite la operación.");
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(fresh.windowId, { format: "png" });
      return { dataUrl, url: fresh.url };
    } catch (error) {
      lastError = error;
      if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|quota|rate/i.test(error?.message || "")) break;
      await sleep(700);
    }
  }
  throw lastError;
}

async function navigate(tabId, url, timeoutMs = 35000) {
  if (!isWeb(url)) throw new Error("Dirección no válida para navegar.");
  await new Promise((resolve, reject) => {
    let seenLoading = false;
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error("La página tardó demasiado en cargar.")); }, timeoutMs);
    function listener(id, info) {
      if (id !== tabId) return;
      if (info.status === "loading") seenLoading = true;
      if (info.status === "complete" && seenLoading) { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); }
    }
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((error) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); reject(error); });
  });
  const tab = await chrome.tabs.get(tabId);
  return { url: tab.url, title: tab.title };
}

async function openRecorder(tab) {
  const url = new URL(chrome.runtime.getURL("recorder.html"));
  url.searchParams.set("tabId", String(tab.id));
  const popup = await chrome.windows.create({ url: url.href, type: "popup", width: 620, height: 780, focused: true });
  return { windowId: popup.id, host: new URL(tab.url).hostname };
}

async function analyze(tab) {
  // 1) Recolector en el mundo de la página (idempotente). Si ya existe desde document_start, no se toca.
  try { await runFile(tab.id, COLLECTOR_FILES, "MAIN"); } catch { /* páginas que impiden la inyección */ }
  const harvest = await runFunction(tab.id, pageReadHarvest, [], "MAIN").catch(() => null);
  // 2) Monitor de recursos de vídeo + extractor en el mundo aislado.
  await runFunction(tab.id, pageStartMonitor).catch(() => {});
  const dom = await runFile(tab.id, ["src/page/normalize.js", "extractor.js"]);
  if (!dom) throw new Error("La página no devolvió resultados. Espera a que termine de cargar y vuelve a pulsar Analizar página actual.");
  return { dom, harvest };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    const tab = await messageTab(message);
    switch (message?.type) {
      case "TAB_INFO": return { id: tab.id, windowId: tab.windowId, url: tab.url, title: tab.title, active: tab.active };
      case "ANALYZE": return analyze(tab);
      case "HARVEST": return runFunction(tab.id, pageReadHarvest, [], "MAIN");
      case "HARVEST_RAW": return runFunction(tab.id, pageReadRaw, [message.index], "MAIN");
      case "START_MONITOR": return runFunction(tab.id, pageStartMonitor);
      case "SCROLLER": return runFunction(tab.id, pageMarkScroller);
      case "TARGET_GEOMETRY": return runFunction(tab.id, pageTargetGeometry);
      case "PREPARE_CAPTURE": return runFunction(tab.id, pagePrepare, [STYLE_ID, message.hideFixed !== false]);
      case "RESTORE_CAPTURE": return runFunction(tab.id, pageRestore, [STYLE_ID, message.state || null]);
      case "SCROLL_TO": return runFunction(tab.id, pageScrollTo, [Math.max(0, Number(message.y) || 0)]);
      case "AUTOSCROLL_STEP": return runFunction(tab.id, pageAutoScrollStep, [Number(message.waitMs) || 1500]);
      case "CAPTURE_FRAME": return captureFrame(tab);
      case "NAVIGATE": return navigate(tab.id, message.url);
      case "OPEN_RECORDER": return openRecorder(tab);
      default: throw new Error("Operación no reconocida.");
    }
  })().then((result) => sendResponse({ ok: true, result })).catch((error) => {
    sendResponse({ ok: false, error: error?.message || String(error) });
  });
  return true;
});
