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
const { Client } = require("@notionhq/client");

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
    const imgs   = ((p.embed && (p.embed.images || (p.embed.media && p.embed.media.images))) || []).map(i => i.alt || "");
    const b = blogs.get(id) || { id, author, title, createdAt: r.createdAt, tags: new Set(), alts: [] };
    tags.forEach(t => b.tags.add(t));
    b.alts.push(...imgs);
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
  if (!process.env.NOTION_TOKEN || !DB_ID) { console.log("NOTION_TOKEN / DB_MEMBER_BLOG 未設定 → スキップ"); return; }
  const since = process.env.BSKY_SINCE
    ? new Date(process.env.BSKY_SINCE + "T00:00:00+09:00").toISOString()
    : new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString();
  const posts = await fetchFeed(since);
  const blogs = groupByBlog(posts);
  const have  = await existingIds();
  console.log(`Bluesky ${posts.length}投稿 → ブログ${blogs.length}件（${since.slice(0, 10)}以降）/ 登録済み ${have.size}件${DRY_RUN ? " [DRY_RUN]" : ""}`);

  for (const b of blogs.sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const c = classify(b);
    if (c.verdict === "none" || c.verdict === "self") continue;
    const label = `${jstDate(b.createdAt)} ${b.author}「${b.title}」（最少${c.min == null ? "?" : c.min}人）`;
    if (c.verdict === "group") { console.log(`  ⏭ 集合写真のため除外: ${label}`); continue; }
    if (have.has(b.id))        { console.log(`  ・登録済み: ${label}`); continue; }
    const publish = c.verdict === "auto";
    console.log(`  ${publish ? "✅ 公開で登録" : "📝 下書きで登録（要確認）"}: ${label}`);
    if (DRY_RUN) continue;
    await notion.pages.create({
      parent: { database_id: DB_ID },
      properties: {
        Name:      { title: [{ text: { content: b.title.slice(0, 200) } }] },
        URL:       { url: `https://www.hinatazaka46.com/s/official/diary/detail/${b.id}?ima=0000&cd=member` },
        Date:      { date: { start: jstDate(b.createdAt) } },
        Published: { checkbox: publish },
      },
    });
    have.add(b.id);
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
