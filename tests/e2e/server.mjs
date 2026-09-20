// Servidor de simulación para pruebas E2E de RASTRO CAPTURE.
// Sirve: www.instagram.com, scontent.cdninstagram.com, www.tiktok.com, v16.tiktokcdn.com y news.example-web.test
import https from "node:https";
import { readFileSync, statSync, createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => path.join(here, "fixtures", name);
export const requestLog = [];

const IG_CDN = "https://scontent-mad1-1.cdninstagram.com";
const TT_CDN = "https://v16-webapp-prime.tiktokcdn.com";
const OE = "7fffffff"; // caducidad lejana (hex)

// ---------- Datos simulados con la forma de las respuestas reales ----------
const img = (n) => `${IG_CDN}/v/t51/img${n}.jpg?stp=dst-jpg_e35&oe=${OE}&oh=abc`;
const thumb = (n) => `${IG_CDN}/v/t51/thumb${n}.jpg?stp=dst-jpg_s320x320&oe=${OE}`;
const vid = (n) => `${IG_CDN}/o1/v/t16/f2/m86/video${n}.mp4?efg=xyz&oe=${OE}&bytestart=0&byteend=9999`;

function igMedia(n, type) {
  const base = {
    image_versions2: { candidates: [
      { url: img(n), width: 1080, height: 1080 },
      { url: thumb(n), width: 320, height: 320 }
    ] },
    media_type: type
  };
  if (type === 2) base.video_versions = [{ url: vid(1), width: 540, height: 960, type: 101 }];
  return base;
}

export function igPost(code, n, kind = "carousel") {
  const post = {
    code, pk: String(9000 + n), id: `${9000 + n}_123`, taken_at: 1785578400 + n * 3600,
    caption: { text: `Publicación ${code} de prueba #osint #rastro @otro_usuario` },
    like_count: 120 + n, comment_count: 7 + n, user: { username: "usuario_prueba", pk: "123", full_name: "Usuario Prueba", is_verified: false },
    location: { name: "Madrid, España" }
  };
  if (kind === "carousel") {
    post.media_type = 8;
    post.carousel_media = [igMedia(1, 1), igMedia(2, 1), igMedia(3, 2)];
    post.image_versions2 = post.carousel_media[0].image_versions2;
  } else if (kind === "reel") {
    Object.assign(post, igMedia(n % 3 + 1, 2), { play_count: 5000 + n });
  } else {
    Object.assign(post, igMedia(n % 3 + 1, 1));
  }
  return post;
}

const PROFILE_POSTS = Array.from({ length: 12 }, (_, i) => igPost(`P${String(i + 1).padStart(3, "0")}`, i + 1, i % 4 === 0 ? "carousel" : i % 4 === 1 ? "reel" : "image"));

function ttItem(id, n) {
  return {
    id, desc: `Vídeo ${n} de prueba #osint #tiktok @colega`, createTime: String(1785578400 + n * 600),
    author: { id: "555", uniqueId: "tiktok_user", nickname: "Usuario TikTok", verified: true, signature: "Bio de prueba", secUid: "SEC", avatarLarger: `${TT_CDN}/avatar.jpg` },
    authorStats: { followerCount: 1200, followingCount: 10, heartCount: 5000, videoCount: 12 },
    stats: { diggCount: 300 + n, shareCount: 10 + n, commentCount: 20 + n, playCount: 9000 + n, collectCount: 4 },
    video: {
      id, height: 960, width: 540, duration: 2,
      cover: `${TT_CDN}/obj/cover${n}.jpg?x-expires=2000000000&x-signature=abc`,
      originCover: `${TT_CDN}/obj/origin${n}.jpg?x-expires=2000000000`,
      playAddr: `${TT_CDN}/video/tos/useast2a/tos-useast2a-ve-0068/${id}/?mime_type=video_mp4&br=1000&expire=2000000000`,
      downloadAddr: `${TT_CDN}/video/tos/useast2a/tos-useast2a-ve-0068/${id}/?mime_type=video_mp4&br=1200&expire=2000000000&dl=1`,
      bitrateInfo: [{ Bitrate: 1000000, CodecType: "h264", PlayAddr: { UrlList: [`${TT_CDN}/video/tos/useast2a/tos-useast2a-ve-0068/${id}/?mime_type=video_mp4&br=1000&expire=2000000000`], DataSize: 36774 } }]
    },
    music: { id: "m1", title: "Sonido original", authorName: "tiktok_user" },
    textExtra: [{ hashtagName: "osint" }, { hashtagName: "tiktok" }, { userUniqueId: "colega" }],
    locationCreated: "ES"
  };
}
const TT_ITEMS = Array.from({ length: 8 }, (_, i) => ttItem(String(7000000000000000001n + BigInt(i)), i + 1));

// ---------- Páginas ----------
const filler = (n, prefix) => Array.from({ length: n }, (_, i) => `<p class="c">${prefix} comentario ${i + 1}: texto de relleno para provocar scroll interno.</p>`).join("\n");

function pageIgPost() {
  const post = igPost("ABC123", 1, "carousel");
  const sjs = { require: [["RelayPrefetchedStreamCache", "next", [], ["adp_PolarisPostRootQuery", { __bbox: { result: { data: { xdt_api__v1__media__shortcode__web_info: { items: [post] } } } } }]]] };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Usuario Prueba en Instagram: "Publicación ABC123"</title>
<link rel="canonical" href="https://www.instagram.com/p/ABC123/">
<meta property="og:title" content="Usuario Prueba (@usuario_prueba) • Instagram">
<meta property="og:description" content="121 likes, 8 comments - usuario_prueba: Publicación ABC123 de prueba #osint">
<meta property="og:image" content="${thumb(1)}">
<style>html,body{margin:0;height:100%;overflow:hidden;font-family:sans-serif}#scroller{height:100vh;overflow-y:auto}
header.top{position:fixed;top:0;left:0;right:0;height:50px;background:#fff;border-bottom:1px solid #ccc;z-index:10;display:flex;align-items:center;padding:0 12px}
article{margin:60px auto 20px;max-width:470px;border:1px solid #ddd}article img{width:100%;display:block}.c{margin:8px 12px}
#login{position:fixed;bottom:0;left:0;right:0;height:60px;background:#0095f6;color:#fff;z-index:20;padding:20px}</style></head>
<body><header class="top"><b>Instagram</b></header>
<div id="scroller"><article>
 <header><a href="/usuario_prueba/">usuario_prueba</a> · <time datetime="2026-08-01T10:00:00.000Z">1 ago</time></header>
 <img alt="foto" src="${thumb(1)}" srcset="${thumb(1)} 320w, ${img(1)} 1080w">
 <video id="v" muted playsinline width="270" height="480" poster="${thumb(3)}"></video>
 <div class="c"><b>usuario_prueba</b> Publicación ABC123 de prueba #osint</div>
 ${filler(20, "Usuario")}<div id="mid" style="height:60px;background:#00ff00"></div>${filler(20, "Usuario")}<div id="endbar" style="height:60px;background:#ff0000"></div>
</article></div><div id="login">Inicia sesión para continuar</div>
<script type="application/json" data-sjs>${JSON.stringify(sjs)}</script>
<script>fetch(${JSON.stringify(vid(1).replace(/&bytestart=0&byteend=9999/, ""))}).then(r=>r.blob()).then(b=>{document.getElementById('v').src=URL.createObjectURL(b)});</script>
</body></html>`;
}

function pageIgProfile() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Usuario Prueba (@usuario_prueba) • Fotos y vídeos de Instagram</title>
<link rel="canonical" href="https://www.instagram.com/usuario_prueba/">
<meta property="og:title" content="Usuario Prueba (@usuario_prueba) • Instagram photos and videos">
<meta property="og:description" content="1.2K Followers, 10 Following, 12 Posts - See Instagram photos and videos from Usuario Prueba (@usuario_prueba)">
<style>body{margin:0;font-family:sans-serif}main{max-width:935px;margin:0 auto}header{display:flex;gap:24px;padding:30px}header img{width:150px;height:150px;border-radius:50%}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}.grid a{display:block;height:300px;overflow:hidden}.grid img{width:100%;height:100%;object-fit:cover}</style></head>
<body><main><header><img alt="avatar" src="${IG_CDN}/v/t51/avatar.jpg?oe=${OE}"><section><h2>usuario_prueba</h2><div><b>12</b> publicaciones · <b>1.2K</b> seguidores · <b>10</b> seguidos</div><div>Usuario Prueba<br>Bio de prueba. Contacto: test@example.org</div></section></header>
<div class="grid" id="grid"></div><div id="end" style="height:40px"></div></main>
<script>
const seen=new Set();let cursor="",done=false,busy=false;
function add(items){for(const it of items){if(seen.has(it.code))continue;seen.add(it.code);const a=document.createElement('a');a.href='/p/'+it.code+'/';const i=document.createElement('img');i.loading='lazy';i.src=it.image_versions2.candidates[1].url;i.alt='Foto de '+it.code;a.appendChild(i);document.getElementById('grid').appendChild(a);}}
async function more(){if(busy||done)return;busy=true;const r=await fetch('/graphql/query?cursor='+cursor,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'doc_id=1'});const j=await r.json();const c=j.data.xdt_api__v1__feed__user_timeline_graphql_connection;add(c.edges.map(e=>e.node));cursor=c.page_info.end_cursor;done=!c.page_info.has_next_page;busy=false;}
more();addEventListener('scroll',()=>{if(innerHeight+scrollY>document.body.scrollHeight-400)more()});
</script></body></html>`;
}

function pageTtVideo() {
  const item = TT_ITEMS[0];
  const data = { __DEFAULT_SCOPE__: { "webapp.video-detail": { statusCode: 0, itemInfo: { itemStruct: item } } } };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Usuario TikTok on TikTok</title>
<link rel="canonical" href="https://www.tiktok.com/@tiktok_user/video/${item.id}">
<meta property="og:title" content="Usuario TikTok on TikTok"><meta property="og:description" content="${item.desc}"><meta property="og:image" content="${item.video.cover}">
<style>html,body{margin:0;height:100%;overflow:hidden;font-family:sans-serif}#app{display:flex;height:100vh}nav{position:fixed;left:0;top:0;bottom:0;width:70px;background:#111;color:#fff;z-index:9}
#player{margin-left:70px;width:400px;background:#000}#side{flex:1;overflow-y:auto;padding:12px}.c{margin:8px 0}</style></head>
<body><div id="app"><nav>TikTok</nav>
<div id="player"><video id="v" muted playsinline width="360" height="640" poster="${item.video.cover}"></video></div>
<div id="side"><a data-e2e="browse-username" href="/@tiktok_user">tiktok_user</a> <span data-e2e="browser-nickname">Usuario TikTok</span>
<div data-e2e="browse-video-desc">${item.desc}</div>
<div><span data-e2e="like-count">${item.stats.diggCount}</span> <span data-e2e="comment-count">${item.stats.commentCount}</span> <span data-e2e="share-count">${item.stats.shareCount}</span></div>
${filler(45, "TT")}</div></div>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>
<script>fetch(${JSON.stringify(item.video.playAddr)},{credentials:'include'}).then(r=>r.blob()).then(b=>{document.getElementById('v').src=URL.createObjectURL(b)});</script>
</body></html>`;
}

function pageTtProfile() {
  const user = { user: { id: "555", uniqueId: "tiktok_user", nickname: "Usuario TikTok", signature: "Bio de prueba", verified: true, secUid: "SEC", avatarLarger: `${TT_CDN}/avatar.jpg`, createTime: 1600000000 }, stats: { followerCount: 1200, followingCount: 10, heartCount: 5000, videoCount: 12 } };
  const data = { __DEFAULT_SCOPE__: { "webapp.user-detail": { statusCode: 0, userInfo: user } } };
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Usuario TikTok (@tiktok_user) | TikTok</title>
<link rel="canonical" href="https://www.tiktok.com/@tiktok_user">
<style>body{margin:0;font-family:sans-serif}#main{max-width:900px;margin:0 auto;padding:20px}.g{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}.g a{display:block;height:260px;background:#222}.g img{width:100%;height:100%;object-fit:cover}</style></head>
<body><div id="main"><h1 data-e2e="user-title">tiktok_user</h1><h2 data-e2e="user-subtitle">Usuario TikTok</h2>
<div><b data-e2e="followers-count">1200</b> seguidores</div><div data-e2e="user-bio">Bio de prueba</div><div class="g" id="g"></div></div>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>
<script>(async()=>{const r=await fetch('/api/post/item_list/?secUid=SEC&count=30');const j=await r.json();for(const it of j.itemList){const a=document.createElement('a');a.setAttribute('data-e2e','user-post-item');a.href='/@tiktok_user/video/'+it.id;const i=document.createElement('img');i.src=it.video.cover;a.appendChild(i);document.getElementById('g').appendChild(a)}})();</script>
</body></html>`;
}

function pageLong() {
  const blocks = Array.from({ length: 200 }, (_, i) => `<div style="height:120px;background:rgb(${(i * 37) % 256},${(i * 91) % 256},${(i * 53) % 256})"></div>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Página muy larga</title><style>body{margin:0;background:#fff}.bar{position:sticky;top:0;height:40px;background:#222;color:#fff}</style></head><body><div class="bar">cabecera fija</div>${blocks}</body></html>`;
}

function pageWeb() {
  const paras = Array.from({ length: 30 }, (_, i) => `<p>Párrafo ${i + 1}. Texto de la noticia de prueba para verificar la captura de página completa con desplazamiento vertical.</p>`).join("\n");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Noticia de prueba — Web genérica</title>
<link rel="canonical" href="https://news.example-web.test/article"><meta property="og:image" content="${IG_CDN}/v/t51/img2.jpg">
<style>body{margin:0;font-family:Georgia,serif}article{max-width:760px;margin:0 auto;padding:20px}img{max-width:100%}.bar{position:sticky;top:0;background:#222;color:#fff;padding:12px;z-index:5}</style></head>
<body><div class="bar">Diario de prueba</div><article><h1>Noticia de prueba</h1>
<img src="${IG_CDN}/v/t51/img1.jpg" width="700" height="400" alt="Foto 1">${paras}
<img data-src="${IG_CDN}/v/t51/img3.jpg" src="${IG_CDN}/v/t51/thumb3.jpg" width="700" height="400" alt="Foto perezosa">
<video controls width="480" height="270" poster="${IG_CDN}/v/t51/thumb2.jpg"><source src="${IG_CDN}/generic/clip.mp4" type="video/mp4"></video>
${paras}</article></body></html>`;
}

// ---------- Enrutado ----------
function sendFile(res, file, type, req) {
  const size = statSync(file).size;
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "accept-ranges": "bytes" });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "last-modified": "Wed, 01 Jul 2026 10:00:00 GMT", etag: '"fixture"' });
  createReadStream(file).pipe(res);
}

function handler(req, res) {
  const host = (req.headers.host || "").split(":")[0];
  const url = new URL(req.url, `https://${host}`);
  requestLog.push({ host, path: url.pathname + url.search, referer: req.headers.referer || "", origin: req.headers.origin || "", method: req.method });
  const html = (body) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(body); };
  const json = (obj) => { res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };

  if (host.endsWith("instagram.com") && !host.includes("cdn") && !host.startsWith("scontent")) {
    if (url.pathname === "/p/ABC123/") return html(pageIgPost());
    if (url.pathname === "/usuario_prueba/") return html(pageIgProfile());
    if (url.pathname === "/graphql/query") {
      const page = url.searchParams.get("cursor") ? 1 : 0;
      const slice = PROFILE_POSTS.slice(page * 6, page * 6 + 6);
      return json({ data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: slice.map((node) => ({ node })), page_info: { has_next_page: page === 0, end_cursor: page === 0 ? "CUR1" : null } } }, status: "ok" });
    }
    const m = url.pathname.match(/^\/p\/(P\d+)\/$/);
    if (m) { const p = PROFILE_POSTS.find((x) => x.code === m[1]); return html(pageIgPost().replace(/ABC123/g, m[1]).replace(/"items":\[[\s\S]*?\]}}}}/, `"items":[${JSON.stringify(p)}]}}}}`)); }
    res.writeHead(404); return res.end("no");
  }
  if (host.includes("cdninstagram.com")) {
    let m;
    if ((m = url.pathname.match(/\/(img|thumb)(\d)\.jpg$/))) return sendFile(res, fx(`${m[1]}${m[2]}.jpg`), "image/jpeg", req);
    if (url.pathname.endsWith("/avatar.jpg")) return sendFile(res, fx("avatar.jpg"), "image/jpeg", req);
    if ((m = url.pathname.match(/video(\d)\.mp4$/))) {
      // Con bytestart/byteend el servidor real devuelve solo un tramo
      if (url.searchParams.has("byteend")) {
        const size = statSync(fx(`video${m[1]}.mp4`)).size;
        const end = Math.min(Number(url.searchParams.get("byteend")), size - 1);
        const start = Number(url.searchParams.get("bytestart") || 0);
        const buf = readFileSync(fx(`video${m[1]}.mp4`)).subarray(start, Math.min(end, 4095) + 1);
        res.writeHead(200, { "content-type": "video/mp4", "content-length": buf.length }); return res.end(buf);
      }
      return sendFile(res, fx(`video${m[1]}.mp4`), "video/mp4", req);
    }
    if (url.pathname === "/generic/clip.mp4") return sendFile(res, fx("video2.mp4"), "video/mp4", req);
    res.writeHead(404); return res.end("no");
  }
  if (host.endsWith("tiktok.com")) {
    if (url.pathname === `/@tiktok_user/video/${TT_ITEMS[0].id}`) return html(pageTtVideo());
    if (url.pathname === "/@tiktok_user") return html(pageTtProfile());
    if (url.pathname === "/api/post/item_list/") return json({ statusCode: 0, hasMore: false, cursor: "0", itemList: TT_ITEMS });
    res.writeHead(404); return res.end("no");
  }
  if (host.includes("tiktokcdn.com")) {
    // El CDN real de TikTok rechaza peticiones sin Referer de tiktok.com
    if (url.pathname.startsWith("/video/tos/")) {
      if (!/^https:\/\/www\.tiktok\.com\//.test(req.headers.referer || "")) { res.writeHead(403, { "content-type": "text/plain" }); return res.end("forbidden"); }
      return sendFile(res, fx("video1.mp4"), "video/mp4", req);
    }
    if (url.pathname.startsWith("/obj/")) return sendFile(res, fx("thumb2.jpg"), "image/jpeg", req);
    if (url.pathname === "/avatar.jpg") return sendFile(res, fx("avatar.jpg"), "image/jpeg", req);
    res.writeHead(404); return res.end("no");
  }
  if (host.endsWith("example-web.test")) {
    if (url.pathname === "/article") return html(pageWeb());
    if (url.pathname === "/long") return html(pageLong());
    res.writeHead(404); return res.end("no");
  }
  res.writeHead(404); res.end("no");
}

export function startServer(port = 8443) {
  const server = https.createServer({ key: readFileSync(path.join(here, "certs/key.pem")), cert: readFileSync(path.join(here, "certs/cert.pem")) }, handler);
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

export const HOST_RULES = [
  "www.instagram.com", "scontent-mad1-1.cdninstagram.com", "www.tiktok.com", "v16-webapp-prime.tiktokcdn.com", "news.example-web.test"
].map((h) => `MAP ${h} 127.0.0.1:8443`).join(",");
