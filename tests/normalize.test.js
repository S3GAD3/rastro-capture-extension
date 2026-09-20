import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// normalize.js es un script clásico: se evalúa en un contexto aislado, igual que en el navegador.
const context = { globalThis: null, URL, Date, Math, Number, String, Array, Object, Set, Map, JSON };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(readFileSync(new URL("../src/page/normalize.js", import.meta.url), "utf8"), context);
const N = context.RastroNormalize;
const clone = (x) => JSON.parse(JSON.stringify(x));

test("Instagram API moderna: carrusel con imagen y vídeo, orden y calidad máxima", () => {
  const json = { data: { xdt_api__v1__media__shortcode__web_info: { items: [{
    code: "ABC123", pk: "9001", id: "9001_123", taken_at: 1785578400, media_type: 8,
    caption: { text: "Hola #osint #Rastro con @otro.usuario." }, like_count: 12, comment_count: 3,
    user: { username: "usuario", pk: "123", full_name: "Usuario Prueba", is_verified: true },
    location: { name: "Madrid", pk: "77" }, usertags: { in: [{ user: { username: "etiquetado" } }] },
    carousel_media: [
      { pk: "1", media_type: 1, image_versions2: { candidates: [{ url: "https://cdn/a_small.jpg?oe=7fffffff", width: 320, height: 320 }, { url: "https://cdn/a_big.jpg?oe=7fffffff", width: 1080, height: 1080 }] } },
      { pk: "2", media_type: 2, image_versions2: { candidates: [{ url: "https://cdn/poster.jpg", width: 540, height: 960 }] },
        video_versions: [{ url: "https://cdn/v_low.mp4?bytestart=0&byteend=999", width: 270, height: 480 }, { url: "https://cdn/v_high.mp4?efg=1&bytestart=0&byteend=5000", width: 720, height: 1280 }] }
    ]
  }] } } };
  const { posts, accounts } = N.extract(json, "test");
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.equal(p.type, "carousel");
  assert.equal(p.url, "https://www.instagram.com/p/ABC123/");
  assert.equal(p.takenAt, "2026-08-01T10:00:00.000Z");
  assert.deepEqual([...p.hashtags], ["osint", "Rastro"]);
  assert.deepEqual([...p.mentions], ["otro.usuario"]);
  assert.deepEqual([...p.taggedUsers], ["etiquetado"]);
  assert.equal(p.metrics.likes, 12);
  const full = p.media.filter((m) => m.role === "full");
  assert.equal(full.length, 2);
  assert.equal(full[0].url, "https://cdn/a_big.jpg?oe=7fffffff");
  assert.equal(full[0].index, 1);
  assert.equal(full[1].kind, "video");
  assert.equal(full[1].url, "https://cdn/v_high.mp4?efg=1", "debe elegir la mayor resolución y quitar bytestart/byteend");
  assert.equal(full[1].index, 2);
  assert.ok(full[0].expiresAt.startsWith("2038-"), "lee la caducidad oe=");
  assert.equal(accounts[0].username, "usuario");
  assert.equal(accounts[0].verified, true);
});

test("Instagram GraphQL clásica (shortcode_media) y perfil web_profile_info", () => {
  const json = { graphql: { user: {
    username: "cuenta", id: "55", full_name: "Cuenta", biography: "Bio con enlace", is_private: false, is_verified: false,
    edge_followed_by: { count: 1500 }, edge_follow: { count: 12 }, edge_owner_to_timeline_media: { count: 40, edges: [
      { node: { __typename: "GraphVideo", shortcode: "VID1", id: "1", display_url: "https://cdn/v1_poster.jpg", is_video: true, video_url: "https://cdn/v1.mp4",
        taken_at_timestamp: 1785578400, edge_media_to_caption: { edges: [{ node: { text: "Vídeo #uno" } }] }, edge_liked_by: { count: 9 }, edge_media_to_comment: { count: 2 }, video_view_count: 100, owner: { username: "cuenta", id: "55" } } },
      { node: { __typename: "GraphSidecar", shortcode: "SID1", id: "2", display_url: "https://cdn/s0.jpg", taken_at_timestamp: 1785578500, owner: { username: "cuenta", id: "55" },
        edge_sidecar_to_children: { edges: [{ node: { __typename: "GraphImage", display_url: "https://cdn/s1.jpg", display_resources: [{ src: "https://cdn/s1_320.jpg", config_width: 320, config_height: 320 }, { src: "https://cdn/s1_1080.jpg", config_width: 1080, config_height: 1080 }] } }, { node: { __typename: "GraphImage", display_url: "https://cdn/s2.jpg" } }] } } }
    ] } } } };
  const { posts, accounts } = N.extract(json);
  assert.equal(posts.length, 2);
  const video = posts.find((p) => p.code === "VID1");
  assert.equal(video.type, "video");
  assert.equal(video.caption, "Vídeo #uno");
  assert.equal(video.metrics.views, 100);
  assert.equal(video.media.find((m) => m.kind === "video").url, "https://cdn/v1.mp4");
  const side = posts.find((p) => p.code === "SID1");
  assert.equal(side.type, "carousel");
  assert.equal(side.media.filter((m) => m.role === "full").length, 2);
  assert.equal(side.media[0].url, "https://cdn/s1_1080.jpg");
  const acc = accounts.find((a) => a.username === "cuenta");
  assert.equal(acc.followers, 1500);
  assert.equal(acc.postsCount, 40);
  assert.equal(acc.bio, "Bio con enlace");
});

test("Instagram historia (sin shortcode)", () => {
  const { posts } = N.extract({ reels_media: [{ items: [{ pk: "777", taken_at: 1785578400, media_type: 2, user: { username: "quien", pk: "9" },
    image_versions2: { candidates: [{ url: "https://cdn/st.jpg", width: 1080, height: 1920 }] }, video_versions: [{ url: "https://cdn/st.mp4", width: 720, height: 1280 }] }] }] });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].type, "story");
  assert.equal(posts[0].url, "https://www.instagram.com/stories/quien/777/");
});

test("TikTok web: vídeo con bitrateInfo, mejor calidad y datos del autor", () => {
  const item = { id: "700", desc: "Baile #fyp #osint @colega", createTime: "1785578400",
    author: { id: "5", uniqueId: "cuenta_tt", nickname: "Cuenta TT", verified: true, secUid: "S", signature: "bio", avatarLarger: "https://cdn/av.jpg" },
    authorStats: { followerCount: 10, followingCount: 2, videoCount: 3, heartCount: 99 },
    stats: { diggCount: 5, commentCount: 1, shareCount: 2, playCount: 50, collectCount: 4 },
    video: { width: 576, height: 1024, duration: 12, cover: "https://cdn/c.jpg", originCover: "https://cdn/oc.jpg?x-expires=2000000000",
      playAddr: "https://cdn/play.mp4", downloadAddr: "https://cdn/dl.mp4",
      bitrateInfo: [{ Bitrate: 500000, CodecType: "h264", PlayAddr: { UrlList: ["https://cdn/lo.mp4"], DataSize: 1000 } }, { Bitrate: 2000000, CodecType: "h265", PlayAddr: { UrlList: ["https://cdn/hi.mp4"], DataSize: 9000 } }] },
    music: { title: "Sonido original", authorName: "cuenta_tt" }, textExtra: [{ hashtagName: "fyp" }, { userUniqueId: "colega" }] };
  const { posts, accounts } = N.extract({ __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: item } } } });
  assert.equal(posts.length, 1);
  const p = posts[0];
  assert.equal(p.url, "https://www.tiktok.com/@cuenta_tt/video/700");
  assert.equal(p.media.find((m) => m.kind === "video").url, "https://cdn/hi.mp4");
  assert.equal(p.media.find((m) => m.role === "cover").url, "https://cdn/oc.jpg?x-expires=2000000000");
  assert.deepEqual([...p.hashtags].sort(), ["fyp", "osint"]);
  assert.deepEqual([...p.mentions], ["colega"]);
  assert.equal(p.metrics.views, 50);
  assert.equal(p.music, "Sonido original — cuenta_tt");
  assert.equal(accounts[0].followers, 10);
});

test("TikTok perfil (userInfo) y publicación de fotos", () => {
  const user = { user: { id: "5", uniqueId: "cuenta_tt", nickname: "Cuenta TT", signature: "Bio", verified: false, secUid: "S", avatarLarger: "https://cdn/av.jpg", createTime: 1600000000, bioLink: { link: "https://ejemplo.org" } }, stats: { followerCount: 1200, followingCount: 10, heartCount: 5000, videoCount: 12 } };
  const photo = { id: "701", desc: "Fotos", createTime: 1785578400, author: { uniqueId: "cuenta_tt" }, imagePost: { images: [{ imageURL: { urlList: ["https://cdn/p1.jpg"] } }, { imageURL: { urlList: ["https://cdn/p2.jpg"] } }] }, video: {}, stats: {} };
  const { posts, accounts } = N.extract({ a: { userInfo: user }, itemList: [photo] });
  assert.equal(accounts.find((a) => a.username === "cuenta_tt").followers, 1200);
  assert.equal(accounts[0].externalUrl, "https://ejemplo.org");
  assert.equal(posts[0].type, "photo");
  assert.equal(posts[0].url, "https://www.tiktok.com/@cuenta_tt/photo/701");
  assert.equal(posts[0].media.length, 2);
});

test("TikTok API móvil (aweme_detail)", () => {
  const { posts } = N.extract({ aweme_detail: { aweme_id: "800", desc: "x", create_time: 1785578400, author: { unique_id: "movil", nickname: "M" },
    video: { play_addr: { url_list: ["https://cdn/m.mp4"] }, cover: { url_list: ["https://cdn/mc.jpg"] }, height: 1280, width: 720 }, statistics: { digg_count: 3, play_count: 8 } } });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "800");
  assert.equal(posts[0].media.find((m) => m.kind === "video").url, "https://cdn/m.mp4");
  assert.equal(posts[0].metrics.likes, 3);
});

test("no inventa publicaciones a partir de JSON ajeno y no falla con estructuras profundas", () => {
  assert.equal(N.extract({ a: 1, b: [{ c: "x" }], code: "solo-codigo" }).posts.length, 0);
  let deep = {}; let cur = deep; for (let i = 0; i < 20000; i++) { cur.n = {}; cur = cur.n; }
  assert.doesNotThrow(() => N.extract(deep));
});

test("fusión: conserva las métricas conocidas y el conjunto de medios más completo", () => {
  const a = { platform: "Instagram", id: "X", url: "", takenAt: "", caption: "", location: "", locationId: "", music: "", type: "image", metrics: { likes: 5, comments: null }, author: { platform: "Instagram", username: "u" }, hashtags: ["a"], mentions: [], taggedUsers: [], media: [{ kind: "image", url: "https://c/1.jpg" }], via: "ssr" };
  const b = { ...clone(a), caption: "texto", metrics: { likes: null, comments: 4 }, hashtags: ["b"], media: [{ kind: "image", url: "https://c/1.jpg" }, { kind: "image", url: "https://c/2.jpg" }], via: "api" };
  const m = N.mergePost(a, b);
  assert.equal(m.metrics.likes, 5);
  assert.equal(m.metrics.comments, 4);
  assert.equal(m.caption, "texto");
  assert.deepEqual([...m.hashtags].sort(), ["a", "b"]);
  assert.equal(m.media.length, 2);
});

test("caducidad de URL firmada", () => {
  assert.equal(N.urlExpiry("https://x/y.jpg?oe=00000000"), "");
  assert.match(N.urlExpiry("https://x/y.mp4?x-expires=2000000000"), /^2033-/);
});
