// 他メンバーのブログへの佐藤優羽さんの登場を、Bluesky の blogphotobot から検出して DB_MEMBER_BLOG に登録する。
//
// blogphotobot は日向坂46公式ブログの写真を投稿するボットで、投稿にはメンバー名のハッシュタグと、
// 画像ごとの説明（alt）に「写っている人」がカンマ区切りで入っている。認証不要の公開APIで読める。
//
// 集合写真の扱い：佐藤優羽さんが写っている画像のうち「最も少人数の写真」の人数で判定する（詳細は classify()）。
//   ポスター等の公式ビジュアル（20人以上・卒業メンバー入り）→ 登録しない／五期生が集まった写真 → 公開
//   AUTO_MAX 人以下      → 公開で登録（2ショット・少人数）
//   REVIEW_MAX 人以下    → 非公開（下書き）で登録。Notion で確認して Published を入れる
//   それより多い          → 集合写真として登録しない
// 本人のブログは DB_BLOG 側の担当なので除外する。
//
// Name / Date は Bluesky から入れ、Member（執筆メンバー）は空のまま登録する。
// 直後に走る update_member_blog_meta.js が公式ページから Member を補完し、既存の選択肢に表記を寄せる。
//
// 通常は直近 WINDOW_DAYS 日分だけを見る。範囲を限るのは、誤検出を Notion から削除したときに
// 次の実行で同じものが登録し直されないようにするため。過去分は BSKY_SINCE=YYYY-MM-DD で一度だけ流す。
//
// 環境変数：NOTION_TOKEN / DB_MEMBER_BLOG（必須）、BSKY_SINCE（任意）、DRY_RUN=1（書き込まない）
const fs = require("fs");
const { Client } = require("@notionhq/client");
const { sendDiscord, fetchImage, THREADS, ARCHIVE, loadIds, saveIds } = require("./discord");

const ACTOR       = "blogphotobot.bsky.social";
const TARGET      = "佐藤優羽";
const AUTO_MAX    = 4;
const REVIEW_MAX  = 8;
const WINDOW_DAYS = 3;
const DRY_RUN     = process.env.DRY_RUN === "1";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID  = process.env.DB_MEMBER_BLOG;

const detailId = s => { const m = String(s || "").match(/diary\/detail\/(\d+)/); return m ? m[1] : null; };
const jstDate  = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

// alt は長いと末尾が切れる（「…, 佐藤優」）ので、名前の前方一致で判定する
const altHasTarget = alt => String(alt || "").split(/[,、]/).some(n => n.trim().startsWith("佐藤優"));
const altCount     = alt => String(alt || "").split(/[,、]/).map(s => s.trim()).filter(Boolean).length;

async function fetchFeed(since) {
  const posts = [];
  let cursor;
  for (let page = 0; page < (+process.env.BSKY_MAX_PAGES || 30); page++) {   // 過去分を遡るときは BSKY_MAX_PAGES で増やす
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${ACTOR}&limit=100` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Bluesky API ${res.status}`);
    const j = await res.json();
    for (const f of j.feed || []) {
      if (f.reason) continue;                                   // リポストは除く
      posts.push(f.post);
    }
    const last = j.feed && j.feed[j.feed.length - 1];
    if (!j.cursor || !last || last.post.record.createdAt < since) break;
    cursor = j.cursor;
  }
  return posts.filter(p => p.record.createdAt >= since);
}

// 1/2・2/2 に分かれた投稿をブログ記事ごとにまとめる
function groupByBlog(posts) {
  const blogs = new Map();
  for (const p of posts) {
    const r = p.record;
    const links = (r.facets || []).flatMap(f => f.features).map(x => x.uri).filter(Boolean);
    const id = detailId(links.find(detailId) || r.text);
    if (!id) continue;
    const tags = (r.facets || []).flatMap(f => f.features).map(x => x.tag).filter(Boolean);
    const author = (r.text.match(/^#(\S+)/) || [])[1] || tags[0] || "";
    const title  = (r.text.match(/『([\s\S]*?)』/) || [])[1] || "";
    const imgs   = (p.embed && (p.embed.images || (p.embed.media && p.embed.media.images))) || [];
    const b = blogs.get(id) || { id, author, title, createdAt: r.createdAt, tags: new Set(), alts: [], images: [] };
    tags.forEach(t => b.tags.add(t));
    b.alts.push(...imgs.map(i => i.alt || ""));
    // 「『タイトル』 2/3」の番号。フィードは新しい順なので、あとで番号順に並べ直す（公式ブログの写真の順と一致する）
    const part = +((r.text.match(/』\s*(\d+)\/\d+/) || [])[1] || 1);
    b.images.push(...imgs.map((i, k) => ({ alt: i.alt || "", url: i.fullsize || i.thumb, thumb: i.thumb || i.fullsize, part, k })));
    if (r.createdAt < b.createdAt) b.createdAt = r.createdAt;
    blogs.set(id, b);
  }
  for (const b of blogs.values()) b.images.sort((x, y) => x.part - y.part || x.k - y.k);
  return [...blogs.values()];
}

// 公式ブログ本文の写真 URL（掲載順）。Bluesky の n 枚目＝公式ブログの n 枚目（2026-11-26 に縦横比で全数一致を確認）
async function officialImages(id) {
  try {
    const html = await (await fetch(blogUrl(id), { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const body = html.slice(Math.max(0, html.indexOf("c-blog-article__text")));
    return [...body.matchAll(/<img[^>]+src="(https:\/\/cdn\.hinatazaka46\.com\/files\/14\/diary\/[^"]+)"/g)].map(m => m[1]);
  } catch { return []; }
}

// 写真の判定に使う現役メンバー（members.js ＋ 佐藤優羽さん）と五期生
const { MEMBERS } = require("./members");
const CURRENT = [...MEMBERS.map(m => m.name), TARGET];
const GEN5    = [...MEMBERS.filter(m => m.gen === 5).map(m => m.name), TARGET];
const POSTER_MIN = 20;   // これ以上が写っている写真は全員集合のポスター・ビジュアルとみなす
// alt の末尾は切れることがある（「…, 佐藤優」）ので、名前は前方一致で照合する
const people    = alt => String(alt || "").split(/[,、]/).map(s => s.trim()).filter(Boolean);
const matchName = (n, list) => list.some(x => x.startsWith(n) || n.startsWith(x));

// 公式ビジュアル（ポスター・キービジュアル等）らしい写真：全員集合、または卒業メンバーが写っている
// （執筆者本人は卒業後でも除く）
function isVisual(alt, author) {
  const ps = people(alt);
  return ps.length >= POSTER_MIN || ps.some(n => n !== author && !matchName(n, CURRENT));
}
// 五期生が集まった写真：執筆者以外が全員五期生で、5人以上
function isGen5Group(alt, author) {
  const ps = people(alt).filter(n => n !== author);
  return ps.length >= 5 && ps.every(n => matchName(n, GEN5));
}

// 判定（2026-11-25 改定）
//   公式ビジュアルにしか写っていない → visual（登録しない。Discord には注記つきで送る）
//     ・写真の説明から：20人以上・卒業メンバー入り
//     ・Claude の画像判定（judgeBlog）で official とされた写真（グッズ・メニュー・ポスター等）
//   五期生が集まった写真に写っている → auto（人数に関係なく公開）
//   それ以外は、写っている写真のうち最も少人数の写真で AUTO_MAX / REVIEW_MAX により判定
//   Claude が「普段の写真」と言い切れなかった（unsure だけ）ときは、公開せず下書きにする
function classify(b) {
  if (b.author === TARGET) return { verdict: "self" };
  const hits = b.images.filter(i => altHasTarget(i.alt));
  if (!b.tags.has(TARGET) && !hits.length) return { verdict: "none" };
  if (!hits.length) return { verdict: "review", min: null };    // タグはあるが写真の説明で特定できない
  const real = hits.filter(i => !isVisual(i.alt, b.author) && !(i.judge && i.judge.kind === "official"));
  if (!real.length) return { verdict: "visual", min: Math.min(...hits.map(i => altCount(i.alt))) };
  const min = Math.min(...real.map(i => altCount(i.alt)));
  const unsure = real.every(i => i.judge && i.judge.kind === "unsure");
  let c;
  if (real.some(i => isGen5Group(i.alt, b.author))) c = { verdict: "auto", min, gen5: true };
  else if (min <= AUTO_MAX)   c = { verdict: "auto", min };
  else if (min <= REVIEW_MAX) c = { verdict: "review", min };
  else c = { verdict: "group", min };
  if (unsure && c.verdict === "auto") c = { ...c, verdict: "review", unsure: true };
  return c;
}

// Claude に写真を見てもらい、各画像に judge = { kind, reason } を付ける（APIキーが無ければ何もしない）。
// 説明文から公式ビジュアルと分かっている写真は送らない（費用を抑えるため）
const { judgePhotos } = require("./photo_judge");
async function judgeBlog(b) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  const targets = b.images.filter(i => altHasTarget(i.alt) && !isVisual(i.alt, b.author) && !i.judge);
  if (!targets.length) return;
  const files = await Promise.all(targets.map(i => fetchImage(i.url)));
  const ok = targets.filter((_, k) => files[k]);
  try {
    const r = await judgePhotos(files.filter(Boolean));
    if (r) ok.forEach((img, k) => { img.judge = r[k]; });
  } catch (e) { console.error(`  ⚠ 画像判定に失敗（説明文だけで判定します）: ${e.message}`); }
}

// ── Discord「他メンバーブログ」スレッドへの通知 ──
// 送った記事IDは state/member-blog-notified.json に残す（deploy.yml が VPS と行き来させる）
const NOTIFIED_FILE = "state/member-blog-notified.json";
const blogUrl = id => `https://www.hinatazaka46.com/s/official/diary/detail/${id}?ima=0000&cd=member`;

const NOTE = {
  auto:   "",
  review: "⚠️ 大人数の写真のため、集合写真の可能性あり（サイトには下書きで登録。Notion で確認してください）",
  group:  "⚠️ 集合写真の可能性あり（大人数のため、サイトには登録していません）",
  visual: "⚠️ ポスター・グッズ・メニューなど公式の画像に写っているだけの可能性が高いため、サイトには登録していません",
  unsure: "🤖 普段の写真かどうか判定しきれなかったため、サイトには下書きで登録しました（Notion で確認してください）",
  gen5:   "🪽 五期生が集まった写真のため、サイトに公開で登録しました",
  tag:    "⚠️ 写真の説明から佐藤優羽さんを特定できませんでした（ハッシュタグのみ）。写真はすべて添付しています",
};

// 執筆メンバー名は公式ブログの <title>（「片山 紗希公式ブログ | …」）から取る。
// Bluesky のハッシュタグは「ポカ」のような愛称のことがあるため。取れなければハッシュタグを使う
async function authorName(b) {
  try {
    const html = await (await fetch(blogUrl(b.id), { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    const m = html.match(/<title[^>]*>\s*([^|<\n]{1,20}?)\s*(?:公式ブログ|のブログ)/);
    if (m) return m[1].replace(/\s+/g, "");
  } catch {}
  return b.author;
}

async function notifyMemberBlog(b, c) {
  b.author = await authorName(b);
  const hits = b.images.filter(i => altHasTarget(i.alt));
  const imgs = hits.length ? hits : b.images;                    // 特定できないときは全部
  const files = (await Promise.all(imgs.map(i => fetchImage(i.url)))).filter(Boolean)
    .map((f, n) => ({ ...f, name: `${b.id}_${n + 1}.jpg` }));
  const note = NOTE[c.min == null ? "tag" : c.unsure ? "unsure" : c.gen5 ? "gen5" : c.verdict];
  const lines = [
    "📔 **他メンバーのブログに登場**",
    `メンバー：${b.author}`,
    `タイトル：「${b.title}」`,
    `日付：${jstDate(b.createdAt)}`,
    `URL：<${blogUrl(b.id)}>`,
    `写真：${hits.length ? `佐藤優羽さんが写っている写真 ${files.length}枚（いちばん少ない写真で${c.min}人）` : `${files.length}枚`}`,
  ];
  if (note) lines.push(note);
  const judged = hits.filter(i => i.judge);
  if (judged.length) {
    const label = { candid: "普段の写真", official: "公式の画像", unsure: "判定できず" };
    lines.push("🤖 画像判定：" + judged.map((i, n) => `${n + 1}枚目＝${label[i.judge.kind]}（${i.judge.reason}）`).join("／"));
  }
  await sendDiscord(lines.join("\n").slice(0, 1990), files, THREADS.memberBlog);
}

// ── 画像まとめ（別チャンネルのスレッド）へ：佐藤優羽さんが写っている写真だけ ──
// 公式の画像（ポスター・グッズ等）は除く。写真は公式ブログの同じ位置のもの（元の画質）を使い、
// 枚数が合わないときだけ Bluesky のものを使う。送った記事IDは state/archive-member.json
const ARCHIVE_FILE = "state/archive-member.json";
async function archiveMemberBlog(b, prefix = "") {
  const picks = b.images.filter(i => altHasTarget(i.alt) && !isVisual(i.alt, b.author) && !(i.judge && i.judge.kind === "official"));
  if (!picks.length) return 0;
  const off = await officialImages(b.id);
  const same = off.length === b.images.length;
  const files = (await Promise.all(picks.map(i => fetchImage(same ? off[b.images.indexOf(i)] : i.url)))).filter(Boolean)
    .map((f, n) => ({ ...f, name: `${b.id}_${n + 1}.${(f.name.match(/\.(jpe?g|png|webp|gif)$/i) || [, "jpg"])[1]}` }));
  if (!files.length) return 0;
  const author = await authorName(b);
  await sendDiscord(`${prefix}📔 ${jstDate(b.createdAt).replace(/-/g, ".")} ${author}「${b.title}」\n<${blogUrl(b.id)}>`, files, ARCHIVE.member, ARCHIVE.hook);
  return files.length;
}

function loadNotified() {
  try { return new Set(JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8")).ids); } catch { return null; }
}
function saveNotified(set) {
  fs.mkdirSync("state", { recursive: true });
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify({ ids: [...set].slice(-500) }));
}

// サイトのカードに出す画像：佐藤優羽さんが写っている写真のうち、公式の画像でないもの。
// Claude が「普段の写真」と判定したものを優先し、その中で写っている人数が少ないものを選ぶ
function pickPhoto(b) {
  const c = b.images.filter(i => altHasTarget(i.alt) && !isVisual(i.alt, b.author) && !(i.judge && i.judge.kind === "official"));
  c.sort((x, y) => ((x.judge && x.judge.kind === "candid") ? 0 : 1) - ((y.judge && y.judge.kind === "candid") ? 0 : 1)
    || altCount(x.alt) - altCount(y.alt));
  return c[0] || null;
}
// カード画像の URL：選んだ写真と同じ位置の、公式ブログの写真 URL を使う（画像は公式サイトから表示する）。
// 枚数が合わないとき（記事の編集など）は取り違えを避けて null（→ update_blog_thumbnails.js が記事の1枚目を入れる）
async function photoUrl(b) {
  const p = pickPhoto(b);
  if (!p) return null;
  const off = await officialImages(b.id);
  return off.length === b.images.length ? off[b.images.indexOf(p)] : null;
}
const mediaProp = url => ({ Media: { files: [{ name: "satoyu", type: "external", external: { url } }] } });

// 登録済みの記事：記事ID → { pageId, media }（Published を問わず全件。下書きや非公開を二重登録しないため）
async function existingIds() {
  const ids = new Map();
  let cursor;
  do {
    // Published を問わず全件。下書きや非公開を二重登録しないため
    const r = await notion.databases.query({ database_id: DB_ID, start_cursor: cursor, page_size: 100 });
    for (const p of r.results) {
      const id = detailId(p.properties.URL && p.properties.URL.url);
      const f = (p.properties.Media && p.properties.Media.files || [])[0];
      if (id) ids.set(id, { pageId: p.id, media: f ? (f.external && f.external.url) || (f.file && f.file.url) : null });
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return ids;
}

async function main() {
  // NOTIFY_ONLY=1：Notion には登録せず、Discord への通知だけ行う（過去分をまとめて送るとき。BSKY_SINCE と併用）
  const notifyOnly = process.env.NOTIFY_ONLY === "1" || process.env.ARCHIVE_ONLY === "1";
  if (!notifyOnly && (!process.env.NOTION_TOKEN || !DB_ID)) { console.log("NOTION_TOKEN / DB_MEMBER_BLOG 未設定 → スキップ"); return; }
  const since = process.env.BSKY_SINCE
    ? new Date(process.env.BSKY_SINCE + "T00:00:00+09:00").toISOString()
    : new Date(Date.now() - (process.env.ARCHIVE_TEST === "1" ? 30 : WINDOW_DAYS) * 86400e3).toISOString();
  const posts = await fetchFeed(since);
  const blogs = groupByBlog(posts);
  const have  = notifyOnly ? new Map() : await existingIds();
  // SET_MEDIA=1：登録済みの記事のカード画像を、佐藤優羽さんが写っている写真に差し替えるだけ（過去分用。BSKY_SINCE と併用）
  if (process.env.SET_MEDIA === "1") {
    let n = 0;
    for (const b of blogs) {
      const h = have.get(b.id), url = h && await photoUrl(b);
      // 公式の URL が取れないとき、今 Bluesky の画像なら空にする（次の update_blog_thumbnails.js が記事の1枚目を入れる）
      if (!url && h && /cdn\.bsky\.app/.test(h.media || "")) {
        console.log(`  ↩ ${jstDate(b.createdAt)} ${b.author}「${b.title}」（公式の写真と対応が取れないため記事の1枚目に戻す）`);
        if (!DRY_RUN) await notion.pages.update({ page_id: h.pageId, properties: { Media: { files: [] } } });
        continue;
      }
      if (!url || h.media === url) continue;
      console.log(`  🖼 ${jstDate(b.createdAt)} ${b.author}「${b.title}」`);
      if (!DRY_RUN) await notion.pages.update({ page_id: h.pageId, properties: mediaProp(url) });
      n++;
    }
    console.log(`カード画像を差し替え：${n}件`);
    return;
  }
  // ARCHIVE_ONLY=1：画像まとめへ過去分を送るだけ（BSKY_SINCE と併用）。ARCHIVE_TEST=1 は最新の1件だけ・記録しない
  if (process.env.ARCHIVE_ONLY === "1") {
    if (!process.env[ARCHIVE.hook]) throw new Error("DISCORD_WEBHOOK_URL_2 が未設定です");
    const test = process.env.ARCHIVE_TEST === "1";
    const done = loadIds(ARCHIVE_FILE);
    let list = blogs.filter(b => !["none", "self"].includes(classify(b).verdict)).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
    if (test) list = list.reverse();
    console.log(`Bluesky ${posts.length}投稿 → 佐藤優羽さんが登場するブログ ${list.length}件（${since.slice(0, 10)}以降）/ 送信済み ${done.size}件`);
    let sent = 0;
    for (const b of list) {
      if (!test && done.has(b.id)) continue;
      await judgeBlog(b);
      const label = `${jstDate(b.createdAt)} ${b.author}「${b.title}」`;
      if (DRY_RUN) { console.log(`  ${label}`); continue; }
      const k = await archiveMemberBlog(b, test ? "🔧 テスト送信です\n" : "");
      console.log(`  ${k ? "✅ 写真" + k + "枚" : "・写真なし（公式の画像のみ）"}: ${label}`);
      if (!test) { done.add(b.id); saveIds(ARCHIVE_FILE, done); }
      if (k) { sent++; await new Promise(r => setTimeout(r, 1500)); }
      if (test && sent) break;
    }
    console.log(`画像まとめへ送信：${sent}件`);
    return;
  }
  // 通知の記録が無い初回は、今見えているものを通知済みにするだけ（一斉に送らない）。NOTIFY_ONLY のときは送る
  let notified = loadNotified();
  const firstRun = !notified && !notifyOnly;
  if (!notified) notified = new Set();
  const webhook = !!process.env.DISCORD_WEBHOOK_URL;
  console.log(`Bluesky ${posts.length}投稿 → ブログ${blogs.length}件（${since.slice(0, 10)}以降）/ 登録済み ${have.size}件 / 通知済み ${notified.size}件${DRY_RUN ? " [DRY_RUN]" : ""}${notifyOnly ? " [通知のみ]" : ""}`);

  for (const b of blogs.sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const c0 = classify(b);
    if (c0.verdict === "none" || c0.verdict === "self") continue;
    // 通知か登録をするものだけ Claude に画像を見てもらう（済んだものに費用をかけない）
    const pending = notifyOnly || !notified.has(b.id) || (!have.has(b.id) && !["group", "visual"].includes(c0.verdict));
    if (pending && !firstRun) await judgeBlog(b);
    const c = classify(b);
    const label = `${jstDate(b.createdAt)} ${b.author}「${b.title}」（最少${c.min == null ? "?" : c.min}人）`;
    if (DRY_RUN) {
      console.log(`  [${c.verdict}${c.gen5 ? "・五期生" : ""}${c.unsure ? "・判定できず" : ""}] ${label}`);
      b.images.filter(i => i.judge).forEach(i => console.log(`      ${i.judge.kind}: ${i.judge.reason}`));
    }

    // Discord（集合写真も「可能性あり」を添えて送る）
    if ((notifyOnly || !notified.has(b.id)) && !DRY_RUN) {   // 通知のみ（過去分の一括送信）は記録に関係なく送る
      if (webhook && !firstRun) {
        try { await notifyMemberBlog(b, c); console.log(`  📨 Discord に送信: ${label}`); await new Promise(r => setTimeout(r, 1500)); }
        catch (e) { console.error(`  ❌ Discord: ${e.message}`); }
      }
      if (webhook || firstRun) notified.add(b.id);
    }
    if (notifyOnly) continue;

    if (c.verdict === "group")  { console.log(`  ⏭ 集合写真のため除外: ${label}`); continue; }
    if (c.verdict === "visual") { console.log(`  ⏭ 公式ビジュアルのため除外: ${label}`); continue; }
    if (have.has(b.id))        { console.log(`  ・登録済み: ${label}`); continue; }
    const publish = c.verdict === "auto";
    console.log(`  ${publish ? "✅ 公開で登録" : "📝 下書きで登録（要確認）"}: ${label}`);
    if (DRY_RUN) continue;
    const photo = await photoUrl(b);
    await notion.pages.create({
      parent: { database_id: DB_ID },
      properties: {
        Name:      { title: [{ text: { content: b.title.slice(0, 200) } }] },
        URL:       { url: blogUrl(b.id) },
        Date:      { date: { start: jstDate(b.createdAt) } },
        Published: { checkbox: publish },
        ...(photo ? mediaProp(photo) : {}),   // カード画像は佐藤優羽さんが写っている写真（公式ブログの URL。無ければ後で記事の1枚目が入る）
      },
    });
    have.set(b.id, {});
  }
  if (!DRY_RUN) saveNotified(notified);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
