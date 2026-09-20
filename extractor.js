(() => {
  // Se ejecuta en el mundo aislado de la extensión, tras cargar src/page/normalize.js.
  const N = globalThis.RastroNormalize;
  const LIMIT_TEXT = 20000;
  const LIMIT_LINKS = 150;
  const LIMIT_DOM_IMAGES = 200;
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const truncate = (value, max = LIMIT_TEXT) => clean(value).slice(0, max);
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || "";
  const text = (selector, root = document) => clean(root.querySelector(selector)?.textContent);
  const meta = (name) => attr(`meta[property="${name}"],meta[name="${name}"]`, "content");
  const absolute = (url) => {
    if (!url || typeof url !== "string") return "";
    try { return new URL(url.trim(), location.href).href; } catch { return ""; }
  };
  const isHttp = (url) => /^https?:\/\//i.test(url);
  const unique = (items, key = (x) => x) => {
    const seen = new Set();
    return items.filter((item) => { const value = key(item); if (!value || seen.has(value)) return false; seen.add(value); return true; });
  };
  const safeJson = (value) => { try { return JSON.parse(value); } catch { return null; } };

  document.querySelectorAll("[data-rastro-capture-target]").forEach((el) => el.removeAttribute("data-rastro-capture-target"));

  const host = location.hostname.toLowerCase();
  const platform = /(^|\.)instagram\.com$/.test(host) ? "Instagram" : /(^|\.)tiktok\.com$/.test(host) ? "TikTok" : "Web";
  const pathParts = location.pathname.split("/").filter(Boolean);

  // ------------------------------------------------------------ Tipo de contenido
  let pageKind = "page";
  let contentType = "página";
  let contentId = "";
  let username = "";

  if (platform === "Instagram") {
    const first = pathParts[0];
    if (["p", "reel", "tv"].includes(first) && pathParts[1]) {
      pageKind = first === "p" ? "post" : "reel"; contentType = first === "p" ? "publicación" : "reel"; contentId = pathParts[1];
    } else if (first === "stories" && pathParts[1]) {
      pageKind = "story"; contentType = "historia"; username = pathParts[1]; contentId = pathParts[2] || "";
    } else if (first && !["explore", "accounts", "direct", "reels", "about", "legal"].includes(first)) {
      pageKind = "profile"; contentType = "perfil"; username = first;
    } else if (first === "reels") { pageKind = "reel"; contentType = "reel"; }
  } else if (platform === "TikTok") {
    const match = location.pathname.match(/^\/@([^/]+)\/(video|photo)\/(\d+)/);
    if (match) { pageKind = "video"; contentType = match[2] === "photo" ? "fotos" : "vídeo"; username = match[1]; contentId = match[3]; }
    else if (pathParts[0]?.startsWith("@")) { pageKind = "profile"; contentType = "perfil"; username = pathParts[0].slice(1); }
  }

  // ------------------------------------------------------------ Elemento objetivo
  function findTikTokTarget() {
    if (pageKind === "profile") {
      const seed = document.querySelector('[data-e2e="user-title"], [data-e2e="user-subtitle"], h1');
      if (seed) {
        let node = seed, bestNode = seed;
        while (node && node !== document.body) {
          const rect = node.getBoundingClientRect();
          if (rect.width >= 300 && rect.height >= 120 && rect.height <= Math.max(innerHeight * 1.4, 1000)) bestNode = node;
          node = node.parentElement;
        }
        return bestNode;
      }
    }
    const seed = document.querySelector('[data-e2e="browse-video-desc"], [data-e2e="video-desc"], video');
    if (!seed) return document.querySelector("main") || document.body;
    let node = seed, bestNode = seed;
    while (node && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (node.querySelector?.("video") && rect.width >= 320 && rect.height >= 300 && rect.height <= Math.max(innerHeight * 2.5, 1800)) bestNode = node;
      node = node.parentElement;
    }
    return bestNode;
  }

  function selectTarget() {
    if (platform === "Instagram") {
      if (pageKind === "profile") return document.querySelector("main header") || document.querySelector("main section") || document.querySelector("main");
      const scored = [...document.querySelectorAll("article")].map((node) => {
        const rect = node.getBoundingClientRect();
        return { node, score: (node.querySelector("video") ? 1e7 : 0) + (node.querySelector("time") ? 1e6 : 0) + Math.max(0, rect.width * rect.height) };
      }).sort((a, b) => b.score - a.score);
      return scored[0]?.node || document.querySelector("main") || document.body;
    }
    if (platform === "TikTok") return findTikTokTarget();
    return document.querySelector("main, article, [role='main']") || document.body;
  }

  const target = selectTarget();
  if (target) target.setAttribute("data-rastro-capture-target", "true");
  const scope = target || document;
  const wide = platform === "Web" ? document : (document.querySelector("main") || document);

  // ------------------------------------------------------------ Datos visibles
  let displayName = "";
  let description = "";
  let publishedAt = "";
  const metrics = {};
  const domAccount = {};

  if (platform === "Instagram") {
    const headerLink = target?.querySelector('header a[href^="/"]') || target?.querySelector('a[href^="/"]');
    const hrefUser = headerLink?.getAttribute("href")?.split("/").filter(Boolean)?.[0];
    if (!username && hrefUser && !["p", "reel", "explore"].includes(hrefUser)) username = hrefUser;
    displayName = meta("og:title").replace(/\s*\(@[^)]+\).*$/, "");
    publishedAt = scope.querySelector?.("time")?.getAttribute("datetime") || "";
    description = meta("og:description") || scope.innerText || "";
    if (pageKind === "profile") {
      const headerText = clean(target?.innerText || "");
      const grab = (re) => headerText.match(re)?.[1]?.trim() || "";
      domAccount.postsText = grab(/([\d.,\s]+[KMkm]?)\s*(?:publicaciones|posts)/i);
      domAccount.followersText = grab(/([\d.,\s]+[KMkm]?)\s*(?:seguidores|followers)/i);
      domAccount.followingText = grab(/([\d.,\s]+[KMkm]?)\s*(?:seguidos|siguiendo|following)/i);
      domAccount.headerText = truncate(headerText, 3000);
      const avatar = target?.querySelector("img");
      domAccount.avatarUrl = absolute(avatar?.currentSrc || avatar?.src || "");
    }
  }

  if (platform === "TikTok") {
    username = username || text('[data-e2e="browse-username"], [data-e2e="user-title"]');
    displayName = text('[data-e2e="browser-nickname"], [data-e2e="user-subtitle"]') || meta("og:title");
    description = text('[data-e2e="browse-video-desc"], [data-e2e="video-desc"]') || meta("og:description") || scope.innerText || "";
    metrics.likes = text('[data-e2e="like-count"], [data-e2e="browse-like-count"]');
    metrics.comments = text('[data-e2e="comment-count"], [data-e2e="browse-comment-count"]');
    metrics.shares = text('[data-e2e="share-count"], [data-e2e="browse-share-count"]');
    publishedAt = scope.querySelector?.("time")?.getAttribute("datetime") || "";
    if (pageKind === "profile") {
      domAccount.followersText = text('[data-e2e="followers-count"]');
      domAccount.followingText = text('[data-e2e="following-count"]');
      domAccount.likesText = text('[data-e2e="likes-count"]');
      domAccount.bio = text('[data-e2e="user-bio"]');
      domAccount.avatarUrl = absolute(document.querySelector('[data-e2e="user-avatar"] img, [data-e2e="user-page"] img')?.src || "");
    }
  }

  if (platform === "Web") {
    description = meta("og:description") || meta("description") || "";
    publishedAt = meta("article:published_time") || document.querySelector("time[datetime]")?.getAttribute("datetime") || "";
    displayName = meta("og:site_name") || "";
  }

  // ------------------------------------------------------------ JSON embebido (SSR)
  const ssrPosts = [];
  const ssrAccounts = [];
  const ssrRaw = [];
  let ssrRawBytes = 0;
  const HINT = /image_versions2|video_versions|display_url|shortcode|"code"|playAddr|itemStruct|itemList|userInfo|carousel_media|edge_owner_to_timeline_media/;
  if (platform !== "Web" && N) {
    const scripts = [...document.querySelectorAll('script[type="application/json"], script#SIGI_STATE, script#__UNIVERSAL_DATA_FOR_REHYDRATION__')];
    scripts.slice(0, 80).forEach((script, i) => {
      const raw = script.textContent || "";
      if (raw.length < 40 || raw.length > 8_000_000 || !HINT.test(raw)) return;
      const json = safeJson(raw);
      if (!json) return;
      const found = N.extract(json, "ssr");
      if (!found.posts.length && !found.accounts.length) return;
      ssrPosts.push(...found.posts);
      ssrAccounts.push(...found.accounts);
      if (ssrRawBytes + raw.length <= 6_000_000) { ssrRaw.push({ id: script.id || `script-${i}`, size: raw.length, posts: found.posts.length, text: raw }); ssrRawBytes += raw.length; }
    });
  }

  // ------------------------------------------------------------ Publicaciones visibles en el DOM (perfil / rejilla)
  const domPosts = [];
  if (platform !== "Web") {
    const re = platform === "Instagram" ? /^\/(?:[^/]+\/)?(p|reel|tv)\/([^/?#]+)/ : /^\/@([^/]+)\/(video|photo)\/(\d+)/;
    const seen = new Set();
    wide.querySelectorAll("a[href]").forEach((a) => {
      let path = "";
      try { path = new URL(a.href, location.href).pathname; } catch { return; }
      const m = path.match(re);
      if (!m) return;
      const code = platform === "Instagram" ? m[2] : m[3];
      if (!code || seen.has(code)) return;
      seen.add(code);
      const img = a.querySelector("img");
      domPosts.push({ code, url: absolute(a.href), thumb: absolute(img?.currentSrc || img?.src || ""), alt: truncate(img?.alt || a.getAttribute("aria-label") || "", 400), order: domPosts.length });
    });
  }

  // ------------------------------------------------------------ Multimedia del DOM
  function srcsetBest(srcset) {
    return (srcset || "").split(",").map((entry) => {
      const [url, descriptor] = entry.trim().split(/\s+/);
      const value = descriptor ? Number.parseFloat(descriptor) : 0;
      return { url, weight: descriptor?.endsWith("x") ? value * 1000 : value };
    }).filter((c) => c.url).sort((a, b) => b.weight - a.weight)[0]?.url || "";
  }

  const imgRoot = platform === "Web" ? document : scope;
  const domImages = [];
  imgRoot.querySelectorAll("img").forEach((img) => {
    const urls = unique([srcsetBest(img.srcset), img.currentSrc, img.src, img.dataset?.src, img.dataset?.original, img.dataset?.lazySrc, srcsetBest(img.dataset?.srcset)].map(absolute).filter(isHttp));
    if (!urls.length) return;
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    const alt = truncate(img.alt || "", 300);
    const avatar = /perfil|profile|avatar/i.test(alt);
    if (Math.max(w, h) < 100 && !avatar && img.complete) return;
    domImages.push({ url: urls[0], width: w, height: h, alt, role: avatar ? "avatar" : "dom" });
  });
  imgRoot.querySelectorAll("picture source[srcset]").forEach((s) => {
    const u = absolute(srcsetBest(s.getAttribute("srcset")));
    if (isHttp(u)) domImages.push({ url: u, width: 0, height: 0, alt: "", role: "dom" });
  });
  const extraImages = [meta("og:image"), meta("og:image:url"), meta("og:image:secure_url"), meta("twitter:image"), meta("twitter:image:src"), attr('link[rel="image_src"]', "href")];

  const videoNodes = [...imgRoot.querySelectorAll("video")];
  const domVideos = [];
  let blobVideos = 0;
  for (const video of videoNodes) {
    const poster = absolute(video.poster);
    if (isHttp(poster)) domImages.push({ url: poster, width: 0, height: 0, alt: "póster de vídeo", role: "poster" });
    const sources = [video.currentSrc, video.src, ...[...video.querySelectorAll("source")].map((s) => s.src)].filter(Boolean);
    for (const s of sources) {
      if (s.startsWith("blob:")) { blobVideos++; continue; }
      const url = absolute(s);
      if (isHttp(url)) domVideos.push(url);
    }
  }
  const monitored = safeJson(document.documentElement.dataset.rastroMediaUrls || "[]") || [];
  const RELEVANT = /(?:\.mp4(?:\?|$)|\.webm(?:\?|$)|\.m3u8(?:\?|$)|\.mpd(?:\?|$)|\/video\/tos\/|mime_type=video)/i;
  const networkVideos = [...performance.getEntriesByType("resource").map((e) => e.name), ...monitored].filter((u) => RELEVANT.test(u));
  const metaVideos = [meta("og:video"), meta("og:video:url"), meta("og:video:secure_url")];
  const videos = unique([...metaVideos, ...domVideos, ...networkVideos].map(absolute).filter(isHttp)).slice(0, 80).map((url) => {
    const streaming = /\.m3u8(?:\?|$)|\.mpd(?:\?|$)/i.test(url);
    return { url: N ? N.fullVideoUrl(url) : url, rawUrl: url, kind: streaming ? (/\.m3u8/i.test(url) ? "HLS" : "DASH") : "vídeo directo", downloadable: !streaming, source: networkVideos.includes(url) ? "red" : "dom" };
  });

  const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')].map((n) => safeJson(n.textContent)).filter(Boolean);
  const ldMedia = [];
  const walkLd = (node, depth = 0) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) { node.forEach((n) => walkLd(n, depth + 1)); return; }
    if (typeof node !== "object") return;
    if (typeof node.contentUrl === "string") ldMedia.push({ url: absolute(node.contentUrl), kind: /video/i.test(String(node["@type"])) ? "video" : "image" });
    if (typeof node.image === "string") ldMedia.push({ url: absolute(node.image), kind: "image" });
    if (node.image?.url) ldMedia.push({ url: absolute(node.image.url), kind: "image" });
    Object.values(node).forEach((v) => walkLd(v, depth + 1));
  };
  walkLd(jsonLd);

  if (platform === "Web") {
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = absolute(a.href);
      if (/\.(jpe?g|png|gif|webp|avif)(?:\?|#|$)/i.test(href)) domImages.push({ url: href, width: 0, height: 0, alt: truncate(a.textContent, 120), role: "enlace" });
      else if (/\.(mp4|webm)(?:\?|#|$)/i.test(href)) videos.push({ url: href, rawUrl: href, kind: "vídeo directo", downloadable: true, source: "enlace" });
    });
  }
  ldMedia.filter((m) => isHttp(m.url)).forEach((m) => {
    if (m.kind === "video") videos.push({ url: m.url, rawUrl: m.url, kind: "vídeo directo", downloadable: !/\.m3u8|\.mpd/i.test(m.url), source: "json-ld" });
    else domImages.push({ url: m.url, width: 0, height: 0, alt: "", role: "json-ld" });
  });
  extraImages.map(absolute).filter(isHttp).forEach((url) => domImages.push({ url, width: 0, height: 0, alt: "", role: "meta" }));

  const images = unique(domImages, (i) => i.url).slice(0, LIMIT_DOM_IMAGES);
  const finalVideos = unique(videos, (v) => v.url).slice(0, 80);

  const links = unique([...(scope.querySelectorAll ? scope.querySelectorAll("a[href]") : [])].map((a) => absolute(a.href)).filter(isHttp)).slice(0, LIMIT_LINKS);
  const canonicalUrl = absolute(attr('link[rel="canonical"]', "href")) || location.href;
  const rect = target?.getBoundingClientRect();

  const warnings = [];
  if (finalVideos.some((v) => !v.downloadable)) warnings.push("Se han detectado emisiones segmentadas HLS/DASH; se recomienda grabar la pestaña.");
  if (blobVideos && !finalVideos.some((v) => v.downloadable)) warnings.push("El reproductor usa una fuente interna (blob:). Si no aparece el vídeo original en Multimedia, recarga la página (F5) con RASTRO instalado o usa la grabación de pestaña.");
  if (platform === "Web") warnings.push("Extractor web genérico: no se reconoce Instagram ni TikTok.");

  return {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    platform, pageKind, contentType, contentId,
    username: truncate(username, 200), displayName: truncate(displayName, 300),
    description: truncate(description), publishedAt, metrics, domAccount,
    title: truncate(document.title, 1000), url: location.href, canonicalUrl,
    language: document.documentElement.lang || "",
    visibleText: truncate(scope.innerText || document.body?.innerText || ""),
    ssr: { posts: ssrPosts, accounts: ssrAccounts, raw: ssrRaw },
    domPosts: domPosts.slice(0, 1000),
    domMedia: { images, videos: finalVideos, blobVideos },
    links,
    target: rect ? { width: Math.round(rect.width), height: Math.round(rect.height) } : null,
    environment: {
      userAgent: navigator.userAgent, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utcOffsetMinutes: -new Date().getTimezoneOffset(), screen: `${screen.width}x${screen.height}`, viewport: `${innerWidth}x${innerHeight}`,
      devicePixelRatio: window.devicePixelRatio || 1, referrer: document.referrer || "", readyState: document.readyState
    },
    warnings
  };
})();
