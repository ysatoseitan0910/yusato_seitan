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
  schedule:      process.env.DB_SCHEDULE,
};

// ── ヘルパー ──
function prop(page, key) { return page.properties[key]; }
function getText(page, key) {
  const p = prop(page, key);
  if (p?.title?.length)      return p.title.map(t => t.plain_text).join("");
  if (p?.rich_text?.length)  return p.rich_text.map(t => t.plain_text).join("");
  return "";
}
function getUrl(page, key="URL") { return prop(page,key)?.url || ""; }
function getDate(page, key="Date") { return prop(page,key)?.date?.start || ""; }
function getSelect(page, key) {
  const p = prop(page, key);
  if (p?.select?.name) return p.select.name;
  if (p?.multi_select?.length) return p.multi_select[0].name;
  return "";
}
function getTags(page, key) {
  const p = prop(page, key);
  if (p?.multi_select?.length) return p.multi_select.map(s => s.name);
  if (p?.select?.name) return [p.select.name];
  return [];
}
function getMedia(page, key="Media") {
  const files = prop(page,key)?.files || [];
  if (!files.length) return "";
  const f = files[0];
  return f.type === "external" ? f.external.url : f.file?.url || "";
}
function isPublished(page) {
  const p = prop(page, "Published");
  // Publishedプロパティがない、またはチェックなしの場合も公開扱い
  if (!p) return true;
  if (p.checkbox === false) return false;
  return true;
}
function fmtDate(d) {
  if (!d) return "";
  return d.slice(0, 10).replace(/-/g, ".");
}
function badgeClass(platform) {
  const map = { Blog:"blog", X:"x", TikTok:"tiktok", YouTube:"youtube", Lemino:"lemino", "インタビュー、雑誌掲載":"interview", Web:"web" };
  return "badge badge-" + (map[platform] || "blog");
}

async function queryDB(dbId, sorts=[{property:"Date",direction:"descending"}]) {
  if (!dbId) return [];
  try {
    const res = await notion.databases.query({ database_id: dbId, sorts });
    const published = res.results.filter(isPublished);
    console.log(`  DB(${dbId.slice(0,8)}...): ${res.results.length}件取得, ${published.length}件公開`);
    return published;
  } catch(e) {
    console.error(`DB query error (${dbId}):`, e.message);
    return [];
  }
}

// syncToYuNews専用: 全件のURLをページネーションで取得（Published問わず重複チェック用）
async function queryAllUrls(dbId) {
  const urls = new Set();
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      const u = getUrl(p);
      if (u) urls.add(u);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return urls;
}

// ── テンプレート読み込み ──
function loadTemplate(active) {
  let t = fs.readFileSync("_template.html","utf-8");
  const pages = ["INDEX","YU","COMMITTEE","ACTIVITIES","YUNEWS","BLOG","INTERVIEW","X","TIKTOK","YOUTUBE","LEMINO","ABOUT","TERMS","JOIN"];
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
  const url   = getUrl(page);
  const title = getText(page,"Name") || (url.includes("tiktok.com") ? "TikTok動画" : url.includes("youtu") ? "YouTube動画" : "詳細を見る");
  const date  = fmtDate(getDate(page));
  const desc  = getText(page,"Description");
  const img   = getMedia(page);
  const platform = getSelect(page,"Platform") || badgeLabel;
  const badge = platform ? `<span class="${badgeClass(platform)}">${platform}</span>` : "";
  const link  = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">詳しく見る →</a>` : "";
  const descHtml = desc ? desc.replace(/\n/g, "<br>") : "";

  if (img) {
    return `
  <div class="card news-card news-card--img" style="animation-delay:${Math.random()*0.3}s">
    <img class="news-card-img" src="${img}" alt="${title}" loading="lazy">
    <div class="news-card-img-body">
      <div style="display:flex;gap:16px;align-items:flex-start;">
        <div class="news-card-date">${date}</div>
        <div class="news-card-body">
          ${badge}
          <p class="news-card-title" style="margin-top:${badge?'6px':'0'}">${title}</p>
        </div>
      </div>
      ${descHtml ? `<p class="news-card-desc" style="margin-top:10px;">${descHtml}</p>` : ""}
      ${link}
    </div>
  </div>`;
  }

  return `
  <div class="card news-card" style="animation-delay:${Math.random()*0.3}s">
    <div class="news-card-date">${date}</div>
    <div class="news-card-body">
      ${badge}
      <p class="news-card-title" style="margin-top:${badge?'6px':'0'}">${title}</p>
      ${descHtml ? `<p class="news-card-desc">${descHtml}</p>` : ""}
      ${link}
    </div>
  </div>`;
}

function mediaCard(page, badgeLabel, overrideImg) {
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  const desc  = getText(page,"Description");
  const url   = getUrl(page);
  const img   = overrideImg !== undefined ? overrideImg : getMedia(page);
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

async function fetchLeminoThumbnail(url) {
  if (!url) return "";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function fetchOembedThumbnail(url) {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return "";
    const data = await res.json();
    return data.thumbnail_url || "";
  } catch {
    return "";
  }
}

function tiktokCard(page, thumbUrl = "") {
  const url = getUrl(page);
  const title = getText(page,"Name");
  const date  = fmtDate(getDate(page));
  const videoId = url.split("/video/")[1]?.split("?")[0] || "";
  const preview = thumbUrl
    ? `<div class="tiktok-lite" data-id="${videoId}" style="position:relative;cursor:pointer;background:#000;overflow:hidden;">
        <img src="${thumbUrl}" alt="${escAttr(title)}" loading="lazy" style="width:100%;aspect-ratio:9/16;object-fit:cover;display:block;opacity:0.85;">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <div style="width:52px;height:52px;background:rgba(0,0,0,0.65);border-radius:50%;display:flex;align-items:center;justify-content:center;">
            <div style="width:0;height:0;border-style:solid;border-width:11px 0 11px 20px;border-color:transparent transparent transparent #fff;margin-left:4px;"></div>
          </div>
        </div>
       </div>`
    : `<div class="tiktok-lite" data-id="${videoId}" style="width:100%;aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;background:#111;cursor:pointer;">
        <div style="color:#fff;font-size:11px;">タップして再生</div>
       </div>`;
  return `
  <div class="card embed-card" style="animation-delay:${Math.random()*0.3}s">
    ${preview}
    <div class="embed-header">
      <span class="badge badge-tiktok">TikTok</span>
      <span style="font-size:10px;color:var(--text-light)">${date}</span>
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
    ? `<div class="yt-lite" data-id="${videoId}" style="position:relative;width:100%;aspect-ratio:16/9;cursor:pointer;background:#000;border-radius:8px;overflow:hidden;">
        <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="${escAttr(title)}" loading="lazy" style="width:100%;height:100%;object-fit:cover;opacity:0.85;display:block;">
        <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
          <div style="width:56px;height:40px;background:#ff0000;border-radius:8px;display:flex;align-items:center;justify-content:center;">
            <div style="width:0;height:0;border-style:solid;border-width:9px 0 9px 18px;border-color:transparent transparent transparent #fff;margin-left:4px;"></div>
          </div>
        </div>
       </div>`
    : `<a href="${url}" target="_blank" rel="noopener" style="font-size:12px;color:var(--emerald)">動画を見る</a>`;
  return `
  <div class="card embed-card" style="animation-delay:${Math.random()*0.3}s">
    <div class="embed-header">
      <span class="badge badge-youtube">YouTube</span>
      <span style="font-size:10px;color:var(--text-light)">${date}</span>
    </div>
    <div class="embed-wrap" style="min-height:0;padding:0;">${embed}</div>
    <div class="embed-footer">
      <p class="embed-title">${title}</p>
      ${desc ? `<p style="font-size:11px;color:var(--text-muted);margin-top:4px;">${desc}</p>` : ""}
    </div>
  </div>`;
}

async function fetchTwitterOembed(url) {
  if (!url) return "";
  try {
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&lang=ja&omit_script=true`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return "";
    const data = await res.json();
    return data.html || "";
  } catch {
    return "";
  }
}

function xCard(page, embedHtml) {
  const url   = getUrl(page);
  const title = getText(page, "Name");
  const fallback = `<blockquote class="twitter-tweet" data-lang="ja"><a href="${url}"></a></blockquote>`;
  return `
  <div class="x-card" style="animation-delay:${Math.random()*0.3}s">
    ${embedHtml || fallback}
    ${title ? `<p class="x-card-label">${title}</p>` : ""}
  </div>`;
}

function statusBadge(status) {
  if (!status) return "";
  const cls = status.includes("募集中") ? "badge-open" : "badge-closed";
  return `<span class="badge ${cls}">${status}</span>`;
}

function escAttr(s) {
  return (s || "").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function actModalAttrs(p) {
  const title  = getText(p,"Name");
  const date   = fmtDate(getDate(p));
  const status = getSelect(p,"Status");
  const desc   = getText(p,"Description");
  const url    = getUrl(p);
  const img    = getMedia(p);
  if (!desc) return "";
  return `data-act-modal="1" data-title="${escAttr(title)}" data-date="${escAttr(date)}" data-status="${escAttr(status)}" data-desc="${escAttr(desc)}" data-url="${escAttr(url)}" data-img="${escAttr(img)}"`;
}

// ── ページビルダー ──
async function buildIndex(tpl) {
  const [yuNews, activities, committeeNews, schedule] = await Promise.all([
    queryDB(DB.yuNews),
    queryDB(DB.activities),
    queryDB(DB.committeeNews),
    queryDB(DB.schedule, [{ property: "Date", direction: "ascending" }]),
  ]);

  // ── 委員会News: リスト行（全件・クリックでモーダル） ──
  const committeeRows = committeeNews.map(p => {
    const status = getSelect(p, "Status");
    const title  = getText(p, "Name");
    const date   = fmtDate(getDate(p));
    const desc   = getText(p, "Description");
    const url    = getUrl(p);
    const img    = getMedia(p);
    const mAttrs = `data-act-modal="1" data-title="${escAttr(title)}" data-date="${escAttr(date)}" data-status="${escAttr(status)}" data-desc="${escAttr(desc)}" data-url="${escAttr(url)}" data-img="${escAttr(img)}"`;
    return `
    <div class="committee-list-row" ${mAttrs}>
      <span class="committee-row-date">${date}</span>
      <span class="committee-row-title">${title}</span>
      ${statusBadge(status)}
    </div>`;
  }).join("\n");

  // ── 活動報告: サムネイルグリッド ──
  const actCards = activities.map(p => {
    const title  = getText(p, "Name");
    const date   = fmtDate(getDate(p));
    const img    = getMedia(p);
    const mAttrs = actModalAttrs(p);
    const imgTag = img
      ? `<img class="act-thumb-img" src="${img}" alt="${title}" loading="lazy">`
      : `<div class="act-thumb-no-img">No Image</div>`;
    return `
    <div class="act-thumb-card" ${mAttrs} style="animation-delay:${Math.random()*0.3}s">
      ${imgTag}
      <div class="act-thumb-body">
        <p class="act-thumb-title">${title}</p>
        <span class="act-thumb-date">${date}</span>
      </div>
    </div>`;
  }).join("\n");

  // ── 佐藤優羽さんNews: 均一グリッド ──
  const yuNewsCards = yuNews.slice(0, 20).map(p => {
    const url      = getUrl(p);
    const title    = getText(p, "Name") || "詳細を見る";
    const date     = fmtDate(getDate(p));
    const img      = getMedia(p);
    const platform = getSelect(p, "Platform");
    const badge    = platform ? `<span class="${badgeClass(platform)}" style="font-size:9px;padding:2px 7px;">${platform}</span>` : "";
    const imgTag   = img
      ? `<img class="yunews-img" src="${img}" alt="${title}" loading="lazy">`
      : `<div class="yunews-no-img">No Image</div>`;
    const inner = `${imgTag}<div class="yunews-body">${badge}<p class="yunews-title" style="margin-top:${badge?'4px':'0'}">${title}</p><div class="yunews-meta"><span class="yunews-date">${date}</span></div></div>`;
    return url
      ? `<a href="${url}" target="_blank" rel="noopener" class="yunews-card" style="animation-delay:${Math.random()*0.3}s">${inner}</a>`
      : `<div class="yunews-card" style="animation-delay:${Math.random()*0.3}s">${inner}</div>`;
  }).join("\n");

  // ── サイドバー: スケジュール ──
  const today = new Date().toISOString().slice(0, 10);
  const scheduleRows = schedule.map(p => {
    const title  = getText(p, "Name");
    const date   = getDate(p);
    const status = getSelect(p, "Status");
    const url    = getUrl(p);
    const isPast = date && date < today;
    const dateStr = fmtDate(date);
    const inner = `
      <span class="schedule-date${isPast ? " schedule-date--past" : ""}">${dateStr}</span>
      <span class="schedule-title${isPast ? " schedule-title--past" : ""}">${title}</span>
      ${status ? `<span class="badge ${status.includes("募集中") ? "badge-open" : "badge-closed"}" style="font-size:9px;padding:2px 6px;white-space:nowrap;">${status}</span>` : ""}`;
    return url
      ? `<a href="${url}" class="schedule-row" target="_blank" rel="noopener">${inner}</a>`
      : `<div class="schedule-row">${inner}</div>`;
  }).join("\n");

  // ── サイドバー: YouTube（固定動画・lite-embed） ──
  const ytEmbedHtml = `<div class="yt-lite" data-id="QXQUKkvSrCQ" style="position:relative;width:100%;aspect-ratio:16/9;cursor:pointer;background:#000;overflow:hidden;">
    <img src="https://img.youtube.com/vi/QXQUKkvSrCQ/hqdefault.jpg" alt="YouTube動画" loading="lazy" style="width:100%;height:100%;object-fit:cover;opacity:0.85;display:block;">
    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;">
      <div style="width:48px;height:34px;background:#ff0000;border-radius:6px;display:flex;align-items:center;justify-content:center;">
        <div style="width:0;height:0;border-style:solid;border-width:8px 0 8px 16px;border-color:transparent transparent transparent #fff;margin-left:3px;"></div>
      </div>
    </div>
  </div>`;

  // ── サイドバー: X（固定ツイート・oEmbed） ──
  const xEmbedHtml = await fetchTwitterOembed("https://x.com/ysatoseitan/status/2040992766583550402?s=20");

  const body = `
  <div class="top-layout">

    <!-- メインコンテンツ -->
    <div class="top-main">

      <!-- 生誕委員会News -->
      <section>
        <div class="top-section-header">
          <h2>生誕委員会 News</h2>
          <a href="committee.html">すべて見る →</a>
        </div>
        <div class="committee-list">
          ${committeeRows}
        </div>
      </section>

      <!-- 活動報告 -->
      <section>
        <div class="top-section-header">
          <h2>活動報告</h2>
          <a href="activities.html">すべて見る →</a>
        </div>
        <div class="act-thumb-grid">
          ${actCards}
        </div>
      </section>

      <!-- 佐藤優羽さんNews -->
      <section>
        <div class="top-section-header">
          <h2>佐藤優羽さん News</h2>
          <a href="yunews.html">すべて見る →</a>
        </div>
        <div class="yunews-grid">
          ${yuNewsCards}
        </div>
      </section>

    </div>

    <!-- サイドバー -->
    <aside class="top-sidebar">

      ${scheduleRows ? `
      <div class="sidebar-widget">
        <div style="padding:10px 14px 6px;font-family:'Shippori Mincho',serif;font-size:13px;font-weight:500;color:var(--text);border-bottom:1px solid var(--border);">スケジュール</div>
        <div class="schedule-list">${scheduleRows}</div>
      </div>` : ""}

      ${ytEmbedHtml ? `<div class="sidebar-widget">${ytEmbedHtml}</div>` : ""}

      ${xEmbedHtml ? `<div class="sidebar-widget sidebar-widget-inner">
        ${xEmbedHtml}
        <script>
(function(){
  function loadWidgets(){var s=document.createElement('script');s.src='https://platform.twitter.com/widgets.js';s.async=true;s.charset='utf-8';document.body.appendChild(s);}
  var tweet=document.querySelector('.twitter-tweet');
  if(!tweet){return;}
  if(!('IntersectionObserver' in window)){loadWidgets();return;}
  var obs=new IntersectionObserver(function(entries){
    if(entries[0].isIntersecting){loadWidgets();obs.disconnect();}
  },{rootMargin:'300px'});
  obs.observe(tweet);
})();
<\/script>
      </div>` : ""}

      <div class="sidebar-links">
        <a href="terms.html">生誕委員規約</a>
        <a href="about.html">当委員会について</a>
        <a href="join.html">入会の流れ</a>
      </div>

    </aside>

  </div>`;

  return buildPage(tpl, "トップ","Yu Sato Birthday Celebration Committee", "佐藤優羽生誕祭実行委員会", "佐藤優羽さんの最新情報・委員会活動をお届けします", body);
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
    const modalAttrs = actModalAttrs(p);
    return `
    <div class="card media-card" style="animation-delay:${Math.random()*0.3}s" ${modalAttrs}>
      ${imgTag}
      <div class="media-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          ${statusBadge(status)}
          <span class="media-date">${date}</span>
        </div>
        <p class="media-title">${title}</p>
        ${desc ? `<p class="media-desc">${desc.split("\n").slice(0,3).join("<br>")}</p>` : ""}
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
    const modalAttrs = actModalAttrs(p);
    return `
    <div class="card media-card" style="animation-delay:${Math.random()*0.3}s" ${modalAttrs}>
      ${imgTag}
      <div class="media-body">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          ${statusBadge(status)}
          <span class="media-date">${date}</span>
        </div>
        <p class="media-title">${title}</p>
        ${desc ? `<p class="media-desc">${desc.split("\n").slice(0,3).join("<br>")}</p>` : ""}
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
  const cards = pages.map(p => mediaCard(p, "インタビュー、雑誌掲載")).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "インタビュー、雑誌掲載集", "INTERVIEW", "インタビュー、 <em>雑誌掲載集</em>", "佐藤優羽さんのインタビュー記事、雑誌掲載をまとめています", body);
}

async function buildX(tpl) {
  const pages = await queryDB(DB.x);

  // oEmbed HTMLをページIDをキーに並列取得
  console.log(`  X oEmbed取得中 (${pages.length}件)...`);
  const embedMap = new Map();
  await Promise.all(pages.map(async (p) => {
    const html = await fetchTwitterOembed(getUrl(p));
    if (html) embedMap.set(p.id, html);
  }));
  console.log(`  oEmbed取得成功: ${embedMap.size}件`);

  // タグごとにグループ化（multi_select対応）
  const taggedGroups = {};
  const untagged = [];
  for (const p of pages) {
    const tags = getTags(p, "Tag");
    if (tags.length === 0) {
      untagged.push(p);
    } else {
      const tag = tags[0];
      if (!taggedGroups[tag]) taggedGroups[tag] = [];
      taggedGroups[tag].push(p);
    }
  }

  const gridHtml = (ps) =>
    `<div class="x-embed-grid">${ps.map(p => xCard(p, embedMap.get(p.id))).join("\n")}</div>`;

  let body = "";

  for (const [tag, ps] of Object.entries(taggedGroups)) {
    body += `
    <section style="margin-bottom:48px;">
      <h2 style="font-family:'Shippori Mincho',serif;font-size:18px;font-weight:500;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);">${tag}</h2>
      ${gridHtml(ps)}
    </section>`;
  }

  if (untagged.length > 0) {
    body += `
    <section style="margin-bottom:48px;">
      ${gridHtml(untagged)}
    </section>`;
  }

  body += `\n  <script>
(function(){
  function loadWidgets(){var s=document.createElement('script');s.src='https://platform.twitter.com/widgets.js';s.async=true;s.charset='utf-8';document.body.appendChild(s);}
  var tweet=document.querySelector('.twitter-tweet');
  if(!tweet){return;}
  if(!('IntersectionObserver' in window)){loadWidgets();return;}
  var obs=new IntersectionObserver(function(entries){
    if(entries[0].isIntersecting){loadWidgets();obs.disconnect();}
  },{rootMargin:'300px'});
  obs.observe(tweet);
})();
<\/script>`;

  return buildPage(tpl, "Xまとめ", "X / TWITTER", "X <em>まとめ</em>", "佐藤優羽さんのX投稿をまとめています", body);
}

async function buildTiktok(tpl) {
  const pages = await queryDB(DB.tiktok);
  console.log(`  TikTokサムネイル取得中 (${pages.length}件)...`);
  const thumbs = await Promise.all(pages.map(p => fetchOembedThumbnail(getUrl(p))));
  const cards = pages.map((p, i) => tiktokCard(p, thumbs[i])).join("\n");
  const body = `<div class="grid-3">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "TikTokまとめ", "TIKTOK", "TikTok <em>Gallery</em>", "佐藤優羽さんのTikTok動画をまとめています", body);
}

async function buildYoutube(tpl) {
  const pages = await queryDB(DB.youtube);

  const channelOrder = [
    "日向坂ちゃんねる",
    "日向坂46 OFFICIAL YouTube CHANNEL",
    "Lemino",
  ];

  const groups = {};
  for (const p of pages) {
    const ch = getSelect(p, "Channel") || getText(p, "Channel") || "その他";
    if (!groups[ch]) groups[ch] = [];
    groups[ch].push(p);
  }

  const orderedChannels = [
    ...channelOrder.filter(ch => groups[ch]),
    ...Object.keys(groups).filter(ch => !channelOrder.includes(ch)),
  ];

  const body = orderedChannels.map(ch => {
    const cards = groups[ch].map(p => youtubeCard(p)).join("\n");
    return `
    <section style="margin-bottom:48px;">
      <h2 style="font-family:'Shippori Mincho',serif;font-size:18px;font-weight:500;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);">${ch}</h2>
      <div class="grid-3">${cards}</div>
    </section>`;
  }).join("\n");

  return buildPage(tpl, "YouTubeまとめ", "YOUTUBE", "YouTube <em>まとめ</em>", "佐藤優羽さんのYouTube動画をまとめています", body);
}

async function buildYuNews(tpl) {
  const pages = await queryDB(DB.yuNews);
  const cards = pages.map(p => newsCard(p)).join("\n");
  const body = `<div class="grid-3">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "佐藤優羽さんNews", "YU NEWS", "佐藤優羽さん <em>News</em>", "佐藤優羽さんの最新情報をまとめています", body);
}

async function buildLemino(tpl) {
  const pages = await queryDB(DB.lemino);
  console.log(`  Leminoサムネイル取得中 (${pages.length}件)...`);
  const thumbs = await Promise.all(pages.map(p => {
    const stored = getMedia(p);
    return stored ? Promise.resolve(stored) : fetchLeminoThumbnail(getUrl(p));
  }));
  const cards = pages.map((p, i) => mediaCard(p, "Lemino", thumbs[i])).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "Leminoまとめ", "LEMINO", "Lemino <em>まとめ</em>", "佐藤優羽さんのLemino配信をまとめています", body);
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

  // 既存のYu NewsのURLを全件取得（ページネーション対応・Published問わず）
  console.log("  既存URLを全件確認中...");
  const existingUrls = await queryAllUrls(DB.yuNews);
  console.log(`  既存URL: ${existingUrls.size}件`);

  // ── 既存レコードのDescription更新（YouTube/TikTok） ──
  console.log("  既存レコードのDescription同期中...");
  for (const platform of ["YouTube", "TikTok"]) {
    const dbId = platform === "YouTube" ? DB.youtube : DB.tiktok;
    const srcPages = await queryDB(dbId);
    const withDesc = srcPages.filter(p => getText(p, "Description"));
    for (const page of withDesc) {
      const url  = getUrl(page);
      const desc = getText(page, "Description");
      if (!url) continue;
      try {
        const res = await notion.databases.query({
          database_id: DB.yuNews,
          filter: { property: "URL", url: { equals: url } },
        });
        for (const yuPage of res.results) {
          await notion.pages.update({
            page_id: yuPage.id,
            properties: { Description: { rich_text: [{ text: { content: desc } }] } },
          });
          console.log(`  ✅ Description更新: [${platform}] ${getText(page,"Name")}`);
        }
      } catch(e) {
        console.error(`  ❌ Description更新失敗: ${getText(page,"Name")}`, e.message);
      }
    }
  }

  for (const { db, platform } of sources) {
    const pages = await queryDB(db);
    for (const page of pages) {
      const url  = getUrl(page);
      const name = getText(page,"Name");
      const date = getDate(page);
      const srcDesc = getText(page,"Description");
      if (!url || existingUrls.has(url)) continue;
      // プラットフォーム別の説明文生成
      let desc = srcDesc;
      if (platform === "TikTok" && !desc) {
        const cleanUrl = url.split("?")[0];
        desc = `／\n📢 TikTok公開│ ˙ᵕ˙ )꜆\n＼\n\n佐藤優羽 さん登場のtiktok動画が公開されました！\nぜひご覧ください🪽\n\n${cleanUrl}`;
      }
      // TikTokはoEmbedから新鮮なサムネイルURLを取得（保存済みURLは期限切れの場合があるため）
      const media = platform === "TikTok"
        ? (await fetchOembedThumbnail(url) || getMedia(page))
        : getMedia(page);
      const baseProps = {
        Name:        { title: [{ text: { content: name } }] },
        URL:         { url },
        Date:        date ? { date: { start: date } } : undefined,
        Description: { rich_text: [{ text: { content: desc } }] },
        Platform:    { multi_select: [{ name: platform }] },
        Published:   { checkbox: true },
      };
      if (media) baseProps.Media = { files: [{ name: "thumbnail", type: "external", external: { url: media } }] };
      try {
        await notion.pages.create({ parent: { database_id: DB.yuNews }, properties: baseProps });
        existingUrls.add(url);
        console.log(`  ✅ Yu Newsに追加: [${platform}] ${name}`);
      } catch(e) {
        if (media && e.code === "validation_error" && e.message.includes("Media")) {
          // DB_YU_NEWSにMediaプロパティがない場合はMediaなしで再試行
          delete baseProps.Media;
          try {
            await notion.pages.create({ parent: { database_id: DB.yuNews }, properties: baseProps });
            existingUrls.add(url);
            console.log(`  ✅ Yu Newsに追加（Media未設定）: [${platform}] ${name}`);
          } catch(e2) {
            console.error(`  ❌ Yu News追加失敗: ${name}`, e2.message);
          }
        } else {
          console.error(`  ❌ Yu News追加失敗: ${name}`, e.message);
        }
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
    "top.html":        { fn: buildIndex,     active: "INDEX" },
    "committee.html":  { fn: buildCommittee, active: "COMMITTEE" },
    "activities.html": { fn: buildActivities,active: "ACTIVITIES" },
    "yunews.html":     { fn: buildYuNews,    active: "YUNEWS" },
    "blog.html":       { fn: buildBlog,      active: "BLOG" },
    "interview.html":  { fn: buildInterview, active: "INTERVIEW" },
    "x.html":          { fn: buildX,         active: "X" },
    "tiktok.html":     { fn: buildTiktok,    active: "TIKTOK" },
    "youtube.html":    { fn: buildYoutube,   active: "YOUTUBE" },
    "lemino.html":     { fn: buildLemino,    active: "LEMINO" },
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
