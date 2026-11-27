// TikTok の動画の説明文・サムネイル・投稿日を取る（build.js と update_media_thumbnails.js で共用）。
//
// 2026-11 ごろから TikTok の oEmbed が title / thumbnail_url を返さなくなった（html だけ）。
// そのため oEmbed で取れなければ、動画ページに埋め込まれている JSON（desc / cover / createTime）から取る。
// 投稿日は動画IDの上位32ビット（UNIX秒）からも分かるので、通信しなくても求められる。
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const videoId = url => (String(url || "").match(/\/video\/(\d+)/) || [])[1] || "";

// 動画IDから投稿日（JST の YYYY-MM-DD）。IDが無ければ ""
function dateFromId(url) {
  const id = videoId(url);
  if (!id) return "";
  try {
    const sec = Number(BigInt(id) >> 32n);
    if (sec < 1.4e9 || sec > 4e9) return "";
    return new Date(sec * 1000 + 9 * 3600e3).toISOString().slice(0, 10);
  } catch { return ""; }
}

const unesc = s => { try { return JSON.parse(`"${s}"`); } catch { return s; } };

async function fetchTikTokMeta(url) {
  const out = { title: "", thumbnail: "", date: dateFromId(url) };
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) { const d = await res.json(); out.title = d.title || ""; out.thumbnail = d.thumbnail_url || ""; }
  } catch {}
  if (out.title && out.thumbnail) return out;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja" }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const html = await res.text();
      const desc = html.match(/"desc":"((?:[^"\\]|\\.)*)"/);
      const cover = html.match(/"cover":"((?:[^"\\]|\\.)*)"/);
      if (!out.title && desc) out.title = unesc(desc[1]);
      if (!out.thumbnail && cover) out.thumbnail = unesc(cover[1]);
    }
  } catch {}
  return out;
}

// ── サムネイルの控え（state/tiktok-thumbs.json） ──
// 動画ページを一度に100件以上取りに行くと TikTok に弾かれる回があり、その回のビルドでは
// サムネイルがほぼ全滅していた（2026-11-27：107件中2件）。サムネイルの URL は署名付きで
// 約2日有効なので、取れた URL を控えておき、期限が近いものだけを少しずつ取り直す。
// 取り直しに失敗しても、期限内なら控えを使う。state/ は deploy.yml が VPS と行き来させる。
// （画像そのものは保存しない。TikTok の URL を参照するだけ）
const fs = require("fs");
const path = require("path");
const THUMB_FILE = path.join(__dirname, "state", "tiktok-thumbs.json");
const REFRESH_BEFORE = 18 * 3600;   // 期限まで18時間を切ったら取り直す
const MAX_FETCH = 4;                // 同時に取りに行く数

let thumbs = null, dirty = false;
function loadThumbs() {
  if (thumbs) return thumbs;
  try { thumbs = JSON.parse(fs.readFileSync(THUMB_FILE, "utf8")); } catch { thumbs = {}; }
  process.on("exit", () => {
    if (!dirty) return;
    try { fs.mkdirSync(path.dirname(THUMB_FILE), { recursive: true }); fs.writeFileSync(THUMB_FILE, JSON.stringify(thumbs)); } catch {}
  });
  return thumbs;
}

const expiresOf = u => Number((String(u).match(/[?&]x-expires=(\d+)/) || [])[1]) || 0;

let running = 0;
const waiting = [];
async function limited(fn) {
  if (running >= MAX_FETCH) await new Promise(r => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; const next = waiting.shift(); if (next) next(); }
}

const inflight = new Map();   // 同じ動画を1回のビルドで何度も取りに行かない（トップ・Yu News・TikTok で重なる）
function fetchTikTokThumb(url) {
  const id = videoId(url);
  if (!id) return Promise.resolve("");
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const cache = loadThumbs();
    const now = Date.now() / 1000;
    const hit = cache[id];
    if (hit && hit.exp - now > REFRESH_BEFORE) return hit.u;
    let fresh = "";
    for (let i = 0; i < 2 && !fresh; i++) {
      fresh = await limited(async () => (await fetchTikTokMeta(url)).thumbnail);
    }
    if (fresh) {
      cache[id] = { u: fresh, exp: expiresOf(fresh) || now + 24 * 3600 };
      dirty = true;
      return fresh;
    }
    return hit && hit.exp > now ? hit.u : "";
  })();
  inflight.set(id, p);
  return p;
}

module.exports = { fetchTikTokMeta, fetchTikTokThumb, dateFromId, videoId };
