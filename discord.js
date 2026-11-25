// Discord の Webhook に投稿する（GitHub Actions のスクリプトから使う）。
// DISCORD_WEBHOOK_URL が無ければ何もしない（false を返す）。
// Webhook の URL は鍵と同じなので、ログやエラー文に出さないこと。
//
// files: [{ name, data(Buffer), type }]。1通に付けられるのは10枚までなので、超えた分は続けて送る。
// URL のプレビュー（埋め込み）は下書きが読みにくくなるので抑止する（flags: 4 = SUPPRESS_EMBEDS）。

const MAX_FILES = 10;

// 送り先のスレッド（Webhook のチャンネル内のスレッド ID。秘密情報ではない）
const THREADS = {
  blog:        "1575148375781671033",   // ブログ告知用：告知の下書き
  blogPhoto:   "1575148945338933260",   // ブログ写真：記事の写真
  memberBlog:  "1575148803697147946",   // 他メンバーブログ
  flower:      "1575149200398753872",   // 祝花：minsaka の告知下書き
  birthday:    "1575149339293261926",   // 他メンバーお誕生日
};

async function post(url, payload, files, thread) {
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify(payload));
  files.forEach((f, i) => fd.append(`files[${i}]`, new Blob([f.data], { type: f.type || "application/octet-stream" }), f.name));
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url + "?wait=true" + (thread ? "&thread_id=" + thread : ""), { method: "POST", body: fd });
    if (res.ok) return;
    if (res.status === 429) {                       // レート制限：指示された秒数だけ待って再送
      const j = await res.json().catch(() => ({}));
      await new Promise(r => setTimeout(r, Math.ceil((j.retry_after || 2) * 1000)));
      continue;
    }
    throw new Error(`Discord への送信に失敗（HTTP ${res.status}）`);
  }
  throw new Error("Discord への送信に失敗（レート制限が続いた）");
}

async function sendDiscord(content, files = [], thread = null) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  const base = { flags: 4, allowed_mentions: { parse: [] } };
  await post(url, { ...base, content: content.slice(0, 2000) }, files.slice(0, MAX_FILES), thread);
  for (let i = MAX_FILES; i < files.length; i += MAX_FILES) {
    await post(url, base, files.slice(i, i + MAX_FILES), thread);
  }
  return true;
}

// 画像を取ってきて添付用の形にする。Discord の Webhook は1ファイル10MBまで（無ブーストのサーバー）
async function fetchImage(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 9.5 * 1024 * 1024) return null;
    return { name: url.split("/").pop().split("?")[0], data, type: res.headers.get("content-type") || "image/jpeg" };
  } catch { return null; }
}

// ── Discord へ告知の下書き＋写真を送る（DISCORD_WEBHOOK_URL が無ければ何もしない） ──
// 写真は委員会内での確認用。記事本文（c-blog-article__text 以降）の diary 画像だけを拾う
async function fetchArticleImages(url) {
  try {
    const html = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const body = html.slice(Math.max(0, html.indexOf("c-blog-article__text")));
    const re = /https:\/\/cdn\.hinatazaka46\.com\/files\/14\/diary\/[^"'\s)]+?\.(?:jpe?g|png|webp|gif)/gi;
    return [...new Set(body.match(re) || [])];
  } catch { return []; }
}

// 告知の下書きを「ブログ告知用」スレッドへ。文面は管理ページの「ブログ告知の下書き」と同じ（X に投稿している実際の書式）
async function sendBlogDraft(article, prefix = "") {
  const draft = [
    "＼✨#satoyublog 更新│ ˙ᵕ˙ )꜆✨／", "",
    "#佐藤優羽 OFFICIAL BLOG", `「${article.title}」`, "",
    article.url, "⟡.· ┈┈┈┈┈┈┈┈┈⟡.·", "",
    "（コメント）", "",
    "#日向坂46",
  ].join("\n");
  await sendDiscord(`${prefix}📝 **ブログ更新：告知の下書き**${article.date ? `（${article.date}）` : ""}\n${codeBlock(draft)}`, [], THREADS.blog);
}

// 記事の写真を「ブログ写真」スレッドへ（タイトルと URL を添える）
async function sendBlogPhotos(article, prefix = "") {
  const urls = await fetchArticleImages(article.url);
  const files = (await Promise.all(urls.map(fetchImage))).filter(Boolean);
  if (!files.length) return 0;
  await sendDiscord(`${prefix}📷 **「${article.title}」の写真**（${article.date ? article.date + "・" : ""}${files.length}枚）\n<${article.url}>`, files, THREADS.blogPhoto);
  return files.length;
}

async function notifyBlog(article, { prefix = "", skipOldCheck = false } = {}) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  // 取りこぼしを後から拾ったときに古い記事を一斉に送らないよう、3日以内の記事だけ
  if (!skipOldCheck && article.date && Date.parse(article.date) < Date.now() - 3 * 86400e3) return;
  await sendBlogDraft(article, prefix);
  await sendBlogPhotos(article, prefix);
}

// 下書き部分をコードブロックで囲む（見出しと投稿文の境目が分かるように）
function codeBlock(text) {
  return "```\n" + String(text).replace(/```/g, "ˋˋˋ") + "\n```";
}

module.exports = { sendDiscord, fetchImage, notifyBlog, sendBlogDraft, sendBlogPhotos, codeBlock, THREADS };

