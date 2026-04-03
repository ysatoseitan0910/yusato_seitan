const { Client } = require("@notionhq/client");
const fs = require("fs");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  committeeNews: process.env.DB_COMMITTEE_NEWS,
  yuNews:        process.env.DB_YU_NEWS,
  activities:    process.env.DB_ACTIVITIES,
  blog:          process.env.DB_BLOG,
  interview:     process.env.DB_INTERVIEW,
  tiktok:        process.env.DB_TIKTOK,
  x:             process.env.DB_X,
  youtube:       process.env.DB_YOUTUBE,
  lemino:        process.env.DB_LEMINO,
  web:           process.env.DB_WEB,
};

// ── ヘルパー ──
function prop(page, key) { return page.properties[key]; }
function getText(page, key) { return prop(page,key)?.title?.[0]?.plain_text || prop(page,key)?.rich_text?.[0]?.plain_text || ""; }
function getUrl(page, key="URL") { return prop(page,key)?.url || ""; }
function getDate(page, key="Date") { return prop(page,key)?.date?.start || ""; }
function getSelect(page, key) { return prop(page,key)?.select?.name || ""; }
function getMedia(page, key="Media") {
  const files = prop(page,key)?.files || [];
  if (!files.length) return "";
  const f = files[0];
  return f.type === "external" ? f.external.url : f.file?.url || "";
}
function isPublished(page) {
  const p = prop(page,"Published");
  if (!p) return true;
  return p.checkbox === true;
}
function fmtDate(d) {
  if (!d) return "";
  return d.replace(/-/g, ".");
}
function badgeClass(platform) {
  const map = { Blog:"blog", X:"x", TikTok:"tiktok", YouTube:"youtube", Lemino:"lemino", "インタビュー":"interview", Web:"web" };
  return "badge badge-" + (map[platform] || "blog");
}

async function queryDB(dbId, sorts=[{property:"Date",direction:"descending"}]) {
  if (!dbId) return [];
  try {
    const res = await notion.databases.query({ database_id: dbId, sorts });
    return res.results.filter(isPublished);
  } catch(e) {
    console.error(`DB query error (${dbId}):`, e.message);
    return [];
  }
}

// ── テンプレート読み込み ──
function loadTemplate(active) {
  let t = fs.readFileSync("_template.html","utf-8");
  const pages = ["INDEX","COMMITTEE","ACTIVITIES","BLOG","INTERVIEW","X","TIKTOK","YOUTUBE","LEMINO","WEB"];
  pages.forEach(p => {
    t = t.replace(`{{ACTIVE_${p}}}`, p === active ? 'class="active"' : '');
  });
  return t;
}

function buildPage(template, title, tag, h1, desc, body) {
  const now = new Date().toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
  return template
    .replace("{{PAGE_TITLE}}", title)
    .replace("{{BODY}}", `
      <div class="page-hero">
        <div class="page-hero-tag">${tag}</div>
        <h1>${h1}</h1>
        <p>${desc}</p>
        <p class="last-updated">最終更新：${now}</p>
      </div>
      <div class="content">${body}</div>
    `)
    .replace("<!-- LAST_UPDATED -->", now);
}

// ── カードビルダー ──
function newsCard(page, badgeLabel) {
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  const desc  = getText(page,"Description");
  const url   = getUrl(page);
  const platform = getSelect(page,"Platform") || badgeLabel;
  const badge = platform ? `<span class="${badgeClass(platform)}">${platform}</span>` : "";
  const link  = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">詳しく見る →</a>` : "";
  return `
  <div class="card news-card" style="animation-delay:${Math.random()*0.3}s">
    <div class="news-card-date">${date}</div>
    <div class="news-card-body">
      ${badge}
      <p class="news-card-title" style="margin-top:${badge?'6px':'0'}">${title}</p>
      ${desc ? `<p class="news-card-desc">${desc}</p>` : ""}
      ${link}
    </div>
  </div>`;
}

function mediaCard(page, badgeLabel) {
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  const desc  = getText(page,"Description");
  const url   = getUrl(page);
  const img   = getMedia(page);
  const platform = getSelect(page,"Platform") || badgeLabel;
  const badge = platform ? `<span class="${badgeClass(platform)}">${platform}</span>` : "";
  const imgTag = img ? `<img class="media-img" src="${img}" alt="${title}" loading="lazy">` : `<div class="media-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:12px;">No Image</div>`;
  const link = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">詳しく見る →</a>` : "";
  return `
  <div class="card media-card" style="animation-delay:${Math.random()*0.3}s">
    ${imgTag}
    <div class="media-body">
      ${badge}
      <p class="media-title" style="margin-top:${badge?'6px':'0'}">${title}</p>
      ${desc ? `<p class="media-desc">${desc}</p>` : ""}
      <div class="media-meta">
        <span class="media-date">${date}</span>
        ${link}
      </div>
    </div>
  </div>`;
}

function tiktokCard(page) {
  const url = getUrl(page);
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  const videoId = url.split("/video/")[1]?.split("?")[0] || "";
  return `
  <div class="card embed-card" style="animation-delay:${Math.random()*0.3}s">
    <div class="embed-header">
      <span class="badge badge-tiktok">TikTok</span>
      <span style="font-size:10px;color:var(--text-light)">${date}</span>
    </div>
    <div class="embed-wrap">
      <blockquote class="tiktok-embed" cite="${url}" data-video-id="${videoId}"><section></section></blockquote>
    </div>
    <div class="embed-footer">
      <p class="embed-title">${title}</p>
      <a href="${url}" class="embed-link" target="_blank" rel="noopener">動画を見る →</a>
    </div>
  </div>`;
}

function youtubeCard(page) {
  const url = getUrl(page);
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  const desc  = getText(page,"Description");
  let videoId = "";
  const m = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
  if (m) videoId = m[1];
  const embed = videoId
    ? `<iframe width="100%" height="220" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen loading="lazy" style="display:block;border-radius:8px;"></iframe>`
    : `<a href="${url}" target="_blank" rel="noopener" style="font-size:12px;color:var(--rose)">動画を見る</a>`;
  return `
  <div class="card embed-card" style="animation-delay:${Math.random()*0.3}s">
    <div class="embed-header">
      <span class="badge badge-youtube">YouTube</span>
      <span style="font-size:10px;color:var(--text-light)">${date}</span>
    </div>
    <div class="embed-wrap" style="min-height:220px;">${embed}</div>
    <div class="embed-footer">
      <p class="embed-title">${title}</p>
      ${desc ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">${desc}</p>` : ""}
    </div>
  </div>`;
}

function xCard(page) {
  const url = getUrl(page);
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  return `
  <div class="card embed-card" style="animation-delay:${Math.random()*0.3}s">
    <div class="embed-header">
      <span class="badge badge-x">X (Twitter)</span>
      <span style="font-size:10px;color:var(--text-light)">${date}</span>
    </div>
    <div class="embed-wrap" style="min-height:200px;">
      <blockquote class="twitter-tweet" data-lang="ja"><a href="${url}"></a></blockquote>
    </div>
    <div class="embed-footer">
      <p class="embed-title">${title}</p>
      <a href="${url}" class="embed-link" target="_blank" rel="noopener">投稿を見る →</a>
    </div>
  </div>`;
}

function statusBadge(status) {
  if (!status) return "";
  const cls = status.includes("募集中") ? "badge-open" : "badge-closed";
  return `<span class="badge ${cls}">${status}</span>`;
}

// ── ページビルダー ──
async function buildIndex(tpl) {
  const pages = await queryDB(DB.yuNews);
  const cards = pages.map(p => newsCard(p, "")).join("\n");
  const body = `<div style="display:flex;flex-direction:column;gap:12px;">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "NEWS", "LATEST NEWS", "佐藤<em>優羽</em> News", "佐藤優羽さんに関する最新情報をお届けします", body);
}

async function buildCommittee(tpl) {
  const pages = await queryDB(DB.committeeNews);
  const cards = pages.map(p => {
    const status = getSelect(p,"Status");
    const img = getMedia(p);
    const title = getText(p,"Name");
    const date  = fmtDate(getDate(p));
    const desc  = getText(p,"Description");
    const url   = getUrl(p);
    const imgTag = img ? `<img class="media-img" src="${img}" alt="${title}" loading="lazy">` : "";
    const link = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">詳しく見る →</a>` : "";
    return `
    <div class="card media-card" style="animation-delay:${Math.random()*0.3}s">
      ${imgTag}
      <div class="media-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          ${statusBadge(status)}
          <span class="media-date">${date}</span>
        </div>
        <p class="media-title">${title}</p>
        ${desc ? `<p class="media-desc">${desc}</p>` : ""}
        <div class="media-meta"><span></span>${link}</div>
      </div>
    </div>`;
  }).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "委員会News", "COMMITTEE NEWS", "委員会 <em>News</em>", "佐藤優羽生誕祭実行委員会からのお知らせ", body);
}

async function buildActivities(tpl) {
  const pages = await queryDB(DB.activities);
  const cards = pages.map(p => {
    const status = getSelect(p,"Status");
    const img = getMedia(p);
    const title = getText(p,"Name");
    const date  = fmtDate(getDate(p));
    const desc  = getText(p,"Description");
    const url   = getUrl(p);
    const imgTag = img ? `<img class="media-img" src="${img}" alt="${title}" loading="lazy">` : "";
    const link = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">詳しく見る →</a>` : "";
    return `
    <div class="card media-card" style="animation-delay:${Math.random()*0.3}s">
      ${imgTag}
      <div class="media-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          ${statusBadge(status)}
          <span class="media-date">${date}</span>
        </div>
        <p class="media-title">${title}</p>
        ${desc ? `<p class="media-desc">${desc}</p>` : ""}
        <div class="media-meta"><span></span>${link}</div>
      </div>
    </div>`;
  }).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "活動報告", "ACTIVITIES", "活動 <em>報告</em>", "委員会の活動をご紹介します", body);
}

async function buildBlog(tpl) {
  const pages = await queryDB(DB.blog);
  const cards = pages.map(p => mediaCard(p, "Blog")).join("\n");
  const body = `<div class="grid-3">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "ブログまとめ", "BLOG", "ブログ <em>まとめ</em>", "佐藤優羽さんの公式ブログをまとめています", body);
}

async function buildInterview(tpl) {
  const pages = await queryDB(DB.interview);
  const cards = pages.map(p => mediaCard(p, "インタビュー")).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "インタビュー集", "INTERVIEW", "インタビュー <em>集</em>", "佐藤優羽さんのインタビュー記事をまとめています", body);
}

async function buildX(tpl) {
  const pages = await queryDB(DB.x);
  const cards = pages.map(p => xCard(p)).join("\n");
  const body = `<div class="grid-3">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>
  <script async src="https://platform.twitter.com/widgets.js"><\/script>`;
  return buildPage(tpl, "Xまとめ", "X / TWITTER", "X <em>まとめ</em>", "佐藤優羽さんのX投稿をまとめています", body);
}

async function buildTiktok(tpl) {
  const pages = await queryDB(DB.tiktok);
  const cards = pages.map(p => tiktokCard(p)).join("\n");
  const body = `<div class="grid-3">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>
  <script async src="https://www.tiktok.com/embed.js"><\/script>`;
  return buildPage(tpl, "TikTokまとめ", "TIKTOK", "TikTok <em>Gallery</em>", "佐藤優羽さんのTikTok動画をまとめています", body);
}

async function buildYoutube(tpl) {
  const pages = await queryDB(DB.youtube);
  const cards = pages.map(p => youtubeCard(p)).join("\n");
  const body = `<div class="grid-3">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "YouTubeまとめ", "YOUTUBE", "YouTube <em>まとめ</em>", "佐藤優羽さんのYouTube動画をまとめています", body);
}

async function buildLemino(tpl) {
  const pages = await queryDB(DB.lemino);
  const cards = pages.map(p => mediaCard(p, "Lemino")).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "Leminoまとめ", "LEMINO", "Lemino <em>まとめ</em>", "佐藤優羽さんのLemino配信をまとめています", body);
}

async function buildWeb(tpl) {
  const pages = await queryDB(DB.web);
  const cards = pages.map(p => mediaCard(p, "Web")).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "その他Webまとめ", "WEB", "Web <em>まとめ</em>", "佐藤優羽さんのWeb記事・メディア情報をまとめています", body);
}

// ── 自動集約: 各DBの新着をYu Newsへ追加 ──
async function syncToYuNews() {
  const sources = [
    { db: DB.blog,      platform: "Blog" },
    { db: DB.interview, platform: "インタビュー" },
    { db: DB.x,         platform: "X" },
    { db: DB.tiktok,    platform: "TikTok" },
    { db: DB.youtube,   platform: "YouTube" },
    { db: DB.lemino,    platform: "Lemino" },
    { db: DB.web,       platform: "Web" },
  ];

  // 既存のYu NewsのURLを取得（重複登録防止）
  const existing = await queryDB(DB.yuNews);
  const existingUrls = new Set(existing.map(p => getUrl(p)).filter(Boolean));

  for (const { db, platform } of sources) {
    const pages = await queryDB(db);
    for (const page of pages) {
      const url  = getUrl(page);
      const name = getText(page,"Name");
      const date = getDate(page);
      const desc = getText(page,"Description");
      if (!url || existingUrls.has(url)) continue;
      try {
        await notion.pages.create({
          parent: { database_id: DB.yuNews },
          properties: {
            Name:      { title: [{ text: { content: name } }] },
            URL:       { url },
            Date:      date ? { date: { start: date } } : undefined,
            Description: { rich_text: [{ text: { content: desc } }] },
            Platform:  { select: { name: platform } },
            Published: { checkbox: true },
          },
        });
        existingUrls.add(url);
        console.log(`  ✅ Yu Newsに追加: [${platform}] ${name}`);
      } catch(e) {
        console.error(`  ❌ Yu News追加失敗: ${name}`, e.message);
      }
    }
  }
}

// ── メイン ──
async function main() {
  console.log("🔄 Yu Newsへ自動集約中...");
  await syncToYuNews();

  console.log("🏗️  HTMLビルド開始...");
  const pages = {
    "index.html":      { fn: buildIndex,     active: "INDEX" },
    "committee.html":  { fn: buildCommittee, active: "COMMITTEE" },
    "activities.html": { fn: buildActivities,active: "ACTIVITIES" },
    "blog.html":       { fn: buildBlog,      active: "BLOG" },
    "interview.html":  { fn: buildInterview, active: "INTERVIEW" },
    "x.html":          { fn: buildX,         active: "X" },
    "tiktok.html":     { fn: buildTiktok,    active: "TIKTOK" },
    "youtube.html":    { fn: buildYoutube,   active: "YOUTUBE" },
    "lemino.html":     { fn: buildLemino,    active: "LEMINO" },
    "web.html":        { fn: buildWeb,       active: "WEB" },
  };

  for (const [filename, { fn, active }] of Object.entries(pages)) {
    const tpl = loadTemplate(active);
    const html = await fn(tpl);
    fs.writeFileSync(filename, html, "utf-8");
    console.log(`  ✅ ${filename} 生成完了`);
  }

  console.log("🎉 全ページ生成完了！");
}

main().catch(console.error);
