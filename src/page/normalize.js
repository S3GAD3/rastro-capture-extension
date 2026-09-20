// src/page/normalize.js
// Script clásico (no módulo): se carga en el mundo MAIN de la página (recolector), en el mundo aislado
// de la extensión (extractor) y en el panel. Convierte JSON de Instagram y TikTok en publicaciones y
// cuentas normalizadas. Detecta por la FORMA de los objetos, no por rutas fijas, para tolerar cambios
// de estructura. No realiza ninguna petición de red.
(function (root) {
  "use strict";
  if (root.RastroNormalize) return;

  const MAX_NODES = 400000;
  const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  const str = (v) => (v === undefined || v === null ? "" : String(v));
  const num = (v) => { if (v === undefined || v === null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const has = (o, ...keys) => keys.some((k) => o[k] !== undefined && o[k] !== null);
  const httpUrl = (v) => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : "");

  function iso(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return "";
    try { return new Date(n > 1e12 ? n : n * 1000).toISOString(); } catch { return ""; }
  }

  /** Caducidad declarada en la propia URL firmada (Instagram: oe=hex; TikTok: x-expires / expire). */
  function urlExpiry(url) {
    try {
      const u = new URL(url);
      const oe = u.searchParams.get("oe");
      if (oe && /^[0-9a-f]{6,8}$/i.test(oe)) return iso(parseInt(oe, 16));
      const e = u.searchParams.get("x-expires") || u.searchParams.get("expire");
      if (e && /^\d{9,11}$/.test(e)) return iso(e);
    } catch { /* URL no válida */ }
    return "";
  }

  /** Instagram sirve algunos vídeos por tramos (bytestart/byteend); sin esos parámetros se obtiene el fichero entero. */
  function fullVideoUrl(url) {
    try {
      const u = new URL(url);
      if (u.searchParams.has("bytestart") || u.searchParams.has("byteend")) {
        u.searchParams.delete("bytestart");
        u.searchParams.delete("byteend");
        return u.href;
      }
    } catch { /* URL no válida */ }
    return url;
  }

  function hashtagsOf(text) { return [...new Set([...str(text).matchAll(/#([\p{L}\p{N}_]{1,100})/gu)].map((m) => m[1]))]; }
  function mentionsOf(text) { return [...new Set([...str(text).matchAll(/@([A-Za-z0-9._]{1,30})/g)].map((m) => m[1].replace(/\.+$/, "")))].filter(Boolean); }

  const area = (c) => (num(c.width) || 0) * (num(c.height) || 0);
  function best(list) { return list.length ? list.slice().sort((a, b) => area(b) - area(a))[0] : null; }

  // ---------------------------------------------------------------- Instagram
  function igImageCandidates(node) {
    const out = [];
    for (const c of node.image_versions2?.candidates || []) if (httpUrl(c?.url)) out.push({ url: c.url, width: num(c.width), height: num(c.height) });
    for (const c of node.display_resources || []) if (httpUrl(c?.src)) out.push({ url: c.src, width: num(c.config_width), height: num(c.config_height) });
    if (httpUrl(node.display_url)) out.push({ url: node.display_url, width: num(node.dimensions?.width), height: num(node.dimensions?.height) });
    return out;
  }

  function igVideoCandidates(node) {
    const out = [];
    for (const v of node.video_versions || []) if (httpUrl(v?.url)) out.push({ url: v.url, width: num(v.width), height: num(v.height) });
    if (httpUrl(node.video_url)) out.push({ url: node.video_url, width: num(node.dimensions?.width), height: num(node.dimensions?.height) });
    return out;
  }

  function igItemMedia(node, index) {
    const media = [];
    const videos = igVideoCandidates(node);
    const images = igImageCandidates(node);
    const isVideo = videos.length > 0 || node.media_type === 2 || node.is_video === true;
    if (isVideo && videos.length) {
      const v = best(videos);
      media.push({ kind: "video", role: "full", index, url: fullVideoUrl(v.url), width: v.width, height: v.height, expiresAt: urlExpiry(v.url), altCount: videos.length - 1 });
    } else if (isVideo && (node.video_dash_manifest || node.has_audio !== undefined)) {
      media.push({ kind: "video", role: "full", index, url: "", downloadable: false, note: "Vídeo servido solo por DASH/MSE; usar grabación de pestaña." });
    }
    if (images.length) {
      const i = best(images);
      media.push({ kind: "image", role: isVideo ? "cover" : "full", index, url: i.url, width: i.width, height: i.height, expiresAt: urlExpiry(i.url), alt: str(node.accessibility_caption) });
    }
    return media;
  }

  function isIgPostLike(node) {
    return (has(node, "code") || has(node, "shortcode")) &&
      has(node, "image_versions2", "video_versions", "carousel_media", "display_url", "video_url", "display_resources", "edge_sidecar_to_children");
  }
  function isIgStoryLike(node) {
    return !has(node, "code", "shortcode") && has(node, "pk", "id") && has(node, "taken_at") && has(node, "image_versions2", "video_versions") && isObj(node.user || node.owner);
  }

  function igCaption(node) {
    if (isObj(node.caption)) return str(node.caption.text);
    if (typeof node.caption === "string") return node.caption;
    const edge = node.edge_media_to_caption?.edges?.[0]?.node?.text;
    return str(edge);
  }

  function igPost(node, via) {
    const story = !has(node, "code", "shortcode");
    const code = str(node.code || node.shortcode);
    const owner = node.user || node.owner || {};
    const username = str(owner.username);
    const children = node.carousel_media || node.edge_sidecar_to_children?.edges?.map((e) => e?.node).filter(Boolean) || [];
    const typeName = str(node.__typename);
    const mediaType = num(node.media_type);
    let type = "image";
    if (children.length || mediaType === 8 || typeName === "GraphSidecar") type = "carousel";
    else if (mediaType === 2 || node.is_video === true || typeName === "GraphVideo" || igVideoCandidates(node).length) type = node.product_type === "clips" || node.product_type === "igtv" ? "reel" : "video";
    if (story) type = "story";
    const media = children.length ? children.flatMap((child, i) => igItemMedia(child, i + 1)) : igItemMedia(node, 1);
    const caption = igCaption(node);
    const takenAt = iso(node.taken_at || node.taken_at_timestamp || node.device_timestamp);
    const urlKind = type === "reel" ? "reel" : "p";
    const id = str(node.pk || node.id || code).split("_")[0];
    const music = node.clips_metadata?.music_info?.music_asset_info || node.clips_metadata?.original_sound_info;
    const tagged = (node.usertags?.in || []).map((t) => str(t?.user?.username)).filter(Boolean);
    const post = {
      platform: "Instagram", id: story ? id : code, code: code || id, numericId: id, type,
      url: story ? (username ? `https://www.instagram.com/stories/${username}/${id}/` : "") : `https://www.instagram.com/${urlKind}/${code}/`,
      takenAt, caption, hashtags: hashtagsOf(caption), mentions: mentionsOf(caption),
      author: { username, id: str(owner.pk || owner.id), name: str(owner.full_name), verified: owner.is_verified === true },
      metrics: {
        likes: num(node.like_count ?? node.edge_media_preview_like?.count ?? node.edge_liked_by?.count),
        comments: num(node.comment_count ?? node.edge_media_to_comment?.count ?? node.edge_media_preview_comment?.count ?? node.edge_media_to_parent_comment?.count),
        views: num(node.play_count ?? node.view_count ?? node.video_view_count ?? node.video_play_count)
      },
      location: str(node.location?.name), locationId: str(node.location?.pk || node.location?.id),
      music: music ? [str(music.title || music.song_name), str(music.display_artist || music.artist_name)].filter(Boolean).join(" — ") : "",
      taggedUsers: tagged, media, via: str(via)
    };
    return post;
  }

  function igAccount(node) {
    if (!isObj(node) || typeof node.username !== "string" || !node.username) return null;
    if (!has(node, "biography", "follower_count", "edge_followed_by", "profile_pic_url", "profile_pic_url_hd", "full_name", "is_private", "is_verified")) return null;
    return {
      platform: "Instagram", username: node.username, id: str(node.pk || node.id), name: str(node.full_name), bio: str(node.biography),
      verified: node.is_verified === true, isPrivate: node.is_private === true,
      followers: num(node.follower_count ?? node.edge_followed_by?.count), following: num(node.following_count ?? node.edge_follow?.count),
      postsCount: num(node.media_count ?? node.edge_owner_to_timeline_media?.count),
      avatarUrl: str(node.hd_profile_pic_url_info?.url || node.profile_pic_url_hd || node.profile_pic_url),
      externalUrl: str(node.external_url), category: str(node.category_name || node.category)
    };
  }

  // ------------------------------------------------------------------- TikTok
  function ttUrlList(addr) {
    if (!addr) return [];
    if (typeof addr === "string") return httpUrl(addr) ? [addr] : [];
    const list = addr.UrlList || addr.url_list || addr.urlList || [];
    return list.filter(httpUrl);
  }

  function ttVideoCandidates(video) {
    const out = [];
    for (const b of video.bitrateInfo || video.bit_rate || []) {
      const urls = ttUrlList(b.PlayAddr || b.play_addr);
      if (urls.length) out.push({ url: urls[0], score: num(b.PlayAddr?.DataSize ?? b.play_addr?.data_size) || num(b.Bitrate ?? b.bit_rate) || 0, bitrate: num(b.Bitrate ?? b.bit_rate), codec: str(b.CodecType || b.codec_type) });
    }
    for (const [key, bonus] of [["downloadAddr", 2], ["download_addr", 2], ["playAddr", 1], ["play_addr", 1]]) {
      const urls = ttUrlList(video[key]);
      if (urls.length) out.push({ url: urls[0], score: bonus, bitrate: null, codec: "", key });
    }
    return out;
  }

  function isTtItemLike(node) {
    const video = node.video;
    const hasVideo = isObj(video) && has(video, "playAddr", "downloadAddr", "bitrateInfo", "play_addr", "download_addr", "cover", "originCover");
    return (has(node, "id") || has(node, "aweme_id")) && (hasVideo || isObj(node.imagePost) || isObj(node.image_post_info)) && has(node, "desc", "author", "createTime", "create_time");
  }

  function ttPost(node, via) {
    const id = str(node.id || node.aweme_id);
    const author = node.author || {};
    const authorName = str(author.uniqueId || author.unique_id || (typeof author === "string" ? author : ""));
    const video = isObj(node.video) ? node.video : {};
    const media = [];
    const photos = node.imagePost?.images || node.image_post_info?.images || [];
    if (photos.length) {
      photos.forEach((p, i) => {
        const urls = ttUrlList(p.imageURL || p.display_image);
        if (urls.length) media.push({ kind: "image", role: "full", index: i + 1, url: urls[0], width: num(p.imageWidth), height: num(p.imageHeight), expiresAt: urlExpiry(urls[0]) });
      });
    } else {
      const cands = ttVideoCandidates(video).sort((a, b) => b.score - a.score);
      if (cands.length) {
        const c = cands[0];
        media.push({ kind: "video", role: "full", index: 1, url: c.url, width: num(video.width), height: num(video.height), bitrate: c.bitrate, codec: c.codec, expiresAt: urlExpiry(c.url), altCount: cands.length - 1, durationSeconds: num(video.duration) });
      }
      const cover = ttUrlList(video.originCover)[0] || ttUrlList(video.cover)[0] || ttUrlList(video.dynamicCover)[0];
      if (cover) media.push({ kind: "image", role: "cover", index: 1, url: cover, expiresAt: urlExpiry(cover) });
    }
    const desc = str(node.desc);
    const tags = (node.textExtra || []).map((t) => str(t?.hashtagName)).filter(Boolean);
    const stats = node.stats || node.statistics || {};
    const isPhoto = photos.length > 0;
    return {
      platform: "TikTok", id, code: id, numericId: id, type: isPhoto ? "photo" : "video",
      url: authorName ? `https://www.tiktok.com/@${authorName}/${isPhoto ? "photo" : "video"}/${id}` : "",
      takenAt: iso(node.createTime || node.create_time), caption: desc,
      hashtags: [...new Set([...tags, ...hashtagsOf(desc)])],
      mentions: [...new Set([...(node.textExtra || []).map((t) => str(t?.userUniqueId)).filter(Boolean), ...mentionsOf(desc)])],
      author: { username: authorName, id: str(author.id || author.uid), name: str(author.nickname), verified: author.verified === true },
      metrics: { likes: num(stats.diggCount ?? stats.digg_count), comments: num(stats.commentCount ?? stats.comment_count), views: num(stats.playCount ?? stats.play_count), shares: num(stats.shareCount ?? stats.share_count), saves: num(stats.collectCount ?? stats.collect_count) },
      location: str(node.locationCreated || node.location_created), locationId: "",
      music: node.music ? [str(node.music.title), str(node.music.authorName || node.music.author)].filter(Boolean).join(" — ") : "",
      taggedUsers: [], media, via: str(via)
    };
  }

  function ttAccount(user, stats) {
    if (!isObj(user) || typeof user.uniqueId !== "string" || !user.uniqueId) return null;
    if (!has(user, "nickname", "secUid", "signature", "avatarLarger")) return null;
    return {
      platform: "TikTok", username: user.uniqueId, id: str(user.id), name: str(user.nickname), bio: str(user.signature),
      verified: user.verified === true, isPrivate: user.privateAccount === true,
      followers: num(stats?.followerCount), following: num(stats?.followingCount), postsCount: num(stats?.videoCount),
      likesTotal: num(stats?.heartCount ?? stats?.heart), avatarUrl: str(user.avatarLarger || user.avatarMedium),
      externalUrl: str(user.bioLink?.link), category: "", createdAt: iso(user.createTime)
    };
  }

  // -------------------------------------------------------------------- Fusión
  const richer = (a, b) => (b === null || b === undefined || b === "" || (Array.isArray(b) && !b.length) ? a : a === null || a === undefined || a === "" || (Array.isArray(a) && !a.length) ? b : a);

  function mergeAccount(a, b) {
    if (!a) return b;
    const out = { ...a };
    for (const key of Object.keys(b)) {
      if (key === "verified" || key === "isPrivate") out[key] = a[key] || b[key];
      else out[key] = richer(a[key], b[key]);
    }
    return out;
  }

  function mergePost(a, b) {
    if (!a) return b;
    const out = { ...a };
    for (const key of ["url", "takenAt", "caption", "location", "locationId", "music", "type"]) out[key] = richer(a[key], b[key]);
    out.metrics = { ...b.metrics, ...Object.fromEntries(Object.entries(a.metrics || {}).filter(([, v]) => v !== null && v !== undefined)) };
    out.author = mergeAccount(a.author, b.author);
    out.hashtags = [...new Set([...(a.hashtags || []), ...(b.hashtags || [])])];
    out.mentions = [...new Set([...(a.mentions || []), ...(b.mentions || [])])];
    out.taggedUsers = [...new Set([...(a.taggedUsers || []), ...(b.taggedUsers || [])])];
    const count = (m) => (m || []).filter((x) => x.url).length;
    out.media = count(b.media) > count(a.media) ? b.media : a.media;
    out.via = a.via || b.via;
    return out;
  }

  /**
   * Extrae publicaciones y cuentas de cualquier JSON de Instagram/TikTok.
   * @returns {{posts:Array, accounts:Array}}
   */
  function extract(json, via = "") {
    const posts = new Map();
    const accounts = new Map();
    const addPost = (p) => { const key = `${p.platform}:${p.id}`; posts.set(key, mergePost(posts.get(key), p)); };
    const addAccount = (a) => { if (!a || accounts.size >= 400) return; const key = `${a.platform}:${a.username.toLowerCase()}`; accounts.set(key, mergeAccount(accounts.get(key), a)); };
    const stack = [json];
    let visited = 0;
    while (stack.length && visited < MAX_NODES) {
      const node = stack.pop();
      visited++;
      if (Array.isArray(node)) { for (let i = node.length - 1; i >= 0; i--) if (node[i] && typeof node[i] === "object") stack.push(node[i]); continue; }
      if (!isObj(node)) continue;
      if (isIgPostLike(node) || isIgStoryLike(node)) {
        const p = igPost(node, via);
        addPost(p);
        addAccount(igAccount(node.user || node.owner));
        continue;
      }
      if (isTtItemLike(node)) {
        const p = ttPost(node, via);
        addPost(p);
        addAccount(ttAccount(node.author, node.authorStats));
        continue;
      }
      if (isObj(node.user) && (isObj(node.stats) || isObj(node.statsV2))) addAccount(ttAccount(node.user, node.stats));
      else addAccount(igAccount(node));
      for (const key of Object.keys(node)) { const v = node[key]; if (v && typeof v === "object") stack.push(v); }
    }
    return { posts: [...posts.values()], accounts: [...accounts.values()] };
  }

  function mergeInto(map, items, keyFn, mergeFn) {
    for (const item of items) { const key = keyFn(item); map.set(key, mergeFn(map.get(key), item)); }
    return map;
  }

  root.RastroNormalize = {
    extract, mergeAccount, mergePost, mergeInto, urlExpiry, fullVideoUrl, hashtagsOf, mentionsOf, iso,
    postKey: (p) => `${p.platform}:${p.id}`, accountKey: (a) => `${a.platform}:${a.username.toLowerCase()}`
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
