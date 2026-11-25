// 他メンバーのブログへの佐藤優羽さんの登場を、Bluesky の blogphotobot から検出して DB_MEMBER_BLOG に登録する。
//
// blogphotobot は日向坂46公式ブログの写真を投稿するボットで、投稿にはメンバー名のハッシュタグと、
// 画像ごとの説明（alt）に「写っている人」がカンマ区切りで入っている。認証不要の公開APIで読める。
//
// 集合写真の扱い：佐藤優羽さんが写っている画像のうち「最も少人数の写真」の人数で判定する。
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
const { sendDiscord, fetchImage, THREADS } = require("./discord");

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
  for (let page = 0; page < 30; page++) {
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
    b.images.push(...imgs.map(i => ({ alt: i.alt || "", url: i.fullsize || i.thumb })));
    if (r.createdAt < b.createdAt) b.createdAt = r.createdAt;
    blogs.set(id, b);
  }
  return [...blogs.values()];
}

function classify(b) {
  if (b.author === TARGET) return { verdict: "self" };
  const hits = b.alts.filter(altHasTarget);
  if (!b.tags.has(TARGET) && !hits.length) return { verdict: "none" };
  if (!hits.length) return { verdict: "review", min: null };    // タグはあるが写真の説明で特定できない
  const min = Math.min(...hits.map(altCount));
  if (min <= AUTO_MAX)   return { verdict: "auto", min };
  if (min <= REVIEW_MAX) return { verdict: "review", min };
  return { verdict: "group", min };
}

// ── Discord「他メンバーブログ」スレッドへの通知 ──
// 送った記事IDは state/member-blog-notified.json に残す（deploy.yml が VPS と行き来させる）
const NOTIFIED_FILE = "state/member-blog-notified.json";
const blogUrl = id => `https://www.hinatazaka46.com/s/official/diary/detail/${id}?ima=0000&cd=member`;

const NOTE = {
  auto:   "",
  review: "⚠️ 大人数の写真のため、集合写真の可能性あり（サイトには下書きで登録。Notion で確認してください）",
  group:  "⚠️ 集合写真の可能性あり（大人数のため、サイトには登録していません）",
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
  const note = NOTE[c.min == null ? "tag" : c.verdict];
  const lines = [
    "📔 **他メンバーのブログに登場**",
    `メンバー：${b.author}`,
    `タイトル：「${b.title}」`,
    `日付：${jstDate(b.createdAt)}`,
    `URL：<${blogUrl(b.id)}>`,
    `写真：${hits.length ? `佐藤優羽さんが写っている写真 ${files.length}枚（いちばん少ない写真で${c.min}人）` : `${files.length}枚`}`,
  ];
  if (note) lines.push(note);
  await sendDiscord(lines.join("\n"), files, THREADS.memberBlog);
}

function loadNotified() {
  try { return new Set(JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf8")).ids); } catch { return null; }
}
function saveNotified(set) {
  fs.mkdirSync("state", { recursive: true });
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify({ ids: [...set].slice(-500) }));
}

async function existingIds() {
  const ids = new Set();
  let cursor;
  do {
    // Published を問わず全件。下書きや非公開を二重登録しないため
    const r = await notion.databases.query({ database_id: DB_ID, start_cursor: cursor, page_size: 100 });
    for (const p of r.results) { const id = detailId(p.properties.URL && p.properties.URL.url); if (id) ids.add(id); }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return ids;
}

async function main() {
  // NOTIFY_ONLY=1：Notion には登録せず、Discord への通知だけ行う（過去分をまとめて送るとき。BSKY_SINCE と併用）
  const notifyOnly = process.env.NOTIFY_ONLY === "1";
  if (!notifyOnly && (!process.env.NOTION_TOKEN || !DB_ID)) { console.log("NOTION_TOKEN / DB_MEMBER_BLOG 未設定 → スキップ"); return; }
  const since = process.env.BSKY_SINCE
    ? new Date(process.env.BSKY_SINCE + "T00:00:00+09:00").toISOString()
    : new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString();
  const posts = await fetchFeed(since);
  const blogs = groupByBlog(posts);
  const have  = notifyOnly ? new Set() : await existingIds();
  // 通知の記録が無い初回は、今見えているものを通知済みにするだけ（一斉に送らない）。NOTIFY_ONLY のときは送る
  let notified = loadNotified();
  const firstRun = !notified && !notifyOnly;
  if (!notified) notified = new Set();
  const webhook = !!process.env.DISCORD_WEBHOOK_URL;
  console.log(`Bluesky ${posts.length}投稿 → ブログ${blogs.length}件（${since.slice(0, 10)}以降）/ 登録済み ${have.size}件 / 通知済み ${notified.size}件${DRY_RUN ? " [DRY_RUN]" : ""}${notifyOnly ? " [通知のみ]" : ""}`);

  for (const b of blogs.sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const c = classify(b);
    if (c.verdict === "none" || c.verdict === "self") continue;
    const label = `${jstDate(b.createdAt)} ${b.author}「${b.title}」（最少${c.min == null ? "?" : c.min}人）`;

    // Discord（集合写真も「可能性あり」を添えて送る）
    if ((notifyOnly || !notified.has(b.id)) && !DRY_RUN) {   // 通知のみ（過去分の一括送信）は記録に関係なく送る
      if (webhook && !firstRun) {
        try { await notifyMemberBlog(b, c); console.log(`  📨 Discord に送信: ${label}`); await new Promise(r => setTimeout(r, 1500)); }
        catch (e) { console.error(`  ❌ Discord: ${e.message}`); }
      }
      if (webhook || firstRun) notified.add(b.id);
    }
    if (notifyOnly) continue;

    if (c.verdict === "group") { console.log(`  ⏭ 集合写真のため除外: ${label}`); continue; }
    if (have.has(b.id))        { console.log(`  ・登録済み: ${label}`); continue; }
    const publish = c.verdict === "auto";
    console.log(`  ${publish ? "✅ 公開で登録" : "📝 下書きで登録（要確認）"}: ${label}`);
    if (DRY_RUN) continue;
    await notion.pages.create({
      parent: { database_id: DB_ID },
      properties: {
        Name:      { title: [{ text: { content: b.title.slice(0, 200) } }] },
        URL:       { url: blogUrl(b.id) },
        Date:      { date: { start: jstDate(b.createdAt) } },
        Published: { checkbox: publish },
      },
    });
    have.add(b.id);
  }
  if (!DRY_RUN) saveNotified(notified);
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
