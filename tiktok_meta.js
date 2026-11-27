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

module.exports = { fetchTikTokMeta, dateFromId, videoId };
