const { Client } = require("@notionhq/client");
const fs = require("fs");

const SITE_URL = "https://satoyu.info";
const DEFAULT_OGP_IMAGE = `${SITE_URL}/images/ogp.png`;

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
  quiz:          process.env.DB_QUIZ,
  memberBlog:    process.env.DB_MEMBER_BLOG,
  history:       process.env.DB_HISTORY || "38928fd03f5380bf981ffffd95c540bd",
  news:          process.env.DB_TOP_NEWS,
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
  const map = { blog:"blog", x:"x", tiktok:"tiktok", youtube:"youtube", lemino:"lemino", "インタビュー、雑誌掲載":"interview", web:"web" };
  return "badge badge-" + (map[platform.toLowerCase()] || "blog");
}

async function queryDB(dbId, sorts=[{property:"Date",direction:"descending"}]) {
  if (!dbId) return [];
  try {
    const all = [];
    let cursor;
    do {
      const query = { database_id: dbId, page_size: 100, start_cursor: cursor };
      if (sorts.length > 0) query.sorts = sorts;
      const res = await notion.databases.query(query);
      all.push(...res.results);
      cursor = res.has_more ? res.next_cursor : undefined;
    } while (cursor);
    const published = all.filter(isPublished);
    console.log(`  DB(${dbId.slice(0,8)}...): ${all.length}件取得, ${published.length}件公開`);
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
  const pages = ["INDEX","YU","COMMITTEE","ACTIVITIES","YUNEWS","BLOG","MEMBER_BLOG","INTERVIEW","X","TIKTOK","YOUTUBE","LEMINO","QUIZ","ABOUT","SITE_INFO","TERMS","JOIN","CARD","MESSAGE","HISTORY","WEEKLY"];
  pages.forEach(p => {
    t = t.replace(`{{ACTIVE_${p}}}`, p === active ? 'class="active"' : '');
  });
  return t;
}

function buildPage(template, title, tag, h1, desc, body, pageFile = "", ogpImage = "", heroClass = "", ogpDesc = "", heroExtra = "", heroLeftExtra = "", customHero = "") {
  const now = new Date().toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"});
  const ogpTitle = `${title} | さとうゆほーむ`;
  const ogpUrl = pageFile ? `${SITE_URL}/${pageFile}` : SITE_URL;
  const ogpImg = ogpImage || DEFAULT_OGP_IMAGE;
  const heroClassAttr = heroClass ? ` ${heroClass}` : "";
  const effectiveOgpDesc = (ogpDesc || desc).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').trim();
  const heroInner = (heroExtra || heroLeftExtra)
    ? `<div class="page-hero-left"><div class="page-hero-tag">${tag}</div><h1>${h1}</h1>${desc ? `<p>${desc}</p>` : ''}${heroLeftExtra}</div>${heroExtra}`
    : `<div class="page-hero-tag">${tag}</div><h1>${h1}</h1>${desc ? `<p>${desc}</p>` : ''}`;
  const heroBlock = customHero
    ? customHero
    : `<div class="page-hero${heroClassAttr}">${heroInner}</div>`;
  return template
    .replace("{{PAGE_TITLE}}", title)
    .replaceAll("{{OGP_TITLE}}", ogpTitle)
    .replaceAll("{{OGP_DESC}}", effectiveOgpDesc)
    .replace("{{OGP_URL}}", ogpUrl)
    .replaceAll("{{OGP_IMAGE}}", ogpImg)
    .replace("{{BODY}}", `
      ${heroBlock}
      <div class="content">${body}</div>
    `)
    .replace("<!-- LAST_UPDATED -->", now);
}

// ── カードビルダー ──
function newsCard(page, badgeLabel, overrideImg) {
  const url   = getUrl(page);
  const title = getText(page,"Name") || (url.includes("tiktok.com") ? "TikTok動画" : url.includes("youtu") ? "YouTube動画" : "詳細を見る");
  const date  = fmtDate(getDate(page));
  const desc  = getText(page,"Description");
  const img   = overrideImg !== undefined ? overrideImg : getMedia(page);
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

function youtubeCard(page, channelLabel = "YouTube") {
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
      <span class="badge badge-youtube">${escAttr(channelLabel)}</span>
      <span style="font-size:10px;color:var(--text-light)">${date}</span>
    </div>
    <div class="embed-wrap" style="min-height:0;padding:0;">${embed}</div>
    <div class="embed-footer">
      <p class="embed-title">${title}</p>
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

function deadlineBadge(deadlineStr) {
  if (!deadlineStr) return "";
  const dl = new Date(deadlineStr + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((dl - today) / 86400000);
  const dlFmt = fmtDate(deadlineStr);
  let cls, label;
  if (days < 0)      { cls = "deadline-past";   label = `締切済 ${dlFmt}`; }
  else if (days === 0){ cls = "deadline-today";  label = `⏰ 本日締切！`; }
  else if (days <= 3) { cls = "deadline-urgent"; label = `⏰ 締切 ${dlFmt}<br>（あと${days}日）`; }
  else if (days <= 7) { cls = "deadline-soon";   label = `締切 ${dlFmt}<br>（あと${days}日）`; }
  else                { cls = "deadline-normal";  label = `締切 ${dlFmt}`; }
  return `<span class="deadline-badge ${cls}">${label}</span>`;
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
  const [yuNews, activities, committeeNews, schedule, news] = await Promise.all([
    queryDB(DB.yuNews),
    queryDB(DB.activities),
    queryDB(DB.committeeNews, [{ property: "Priority", direction: "ascending" }]),
    queryDB(DB.schedule, [{ property: "Date", direction: "ascending" }]),
    DB.news ? queryDB(DB.news).catch(() => []) : Promise.resolve([]),
  ]);

  // ── 委員会News: リスト行（全件・クリックでモーダル） ──
  const committeeRows = committeeNews.map(p => {
    const status   = getSelect(p, "Status");
    const title    = getText(p, "Name");
    const date     = fmtDate(getDate(p));
    const desc     = getText(p, "Description");
    const url      = getUrl(p);
    const img      = getMedia(p);
    const deadline = getDate(p, "締め切り");
    const mAttrs = `data-act-modal="1" data-title="${escAttr(title)}" data-date="${escAttr(date)}" data-status="${escAttr(status)}" data-desc="${escAttr(desc)}" data-url="${escAttr(url)}" data-img="${escAttr(img)}" data-deadline="${escAttr(deadline)}"`;
    const thumbEl = img
      ? `<img class="committee-row-thumb-img" src="${img}" alt="" loading="lazy">`
      : `<div class="committee-row-thumb-empty"></div>`;
    return `
    <div class="committee-list-row" ${mAttrs}>
      <div class="committee-row-thumb">${thumbEl}</div>
      <span class="committee-row-date">${date}</span>
      <span class="committee-row-title">${title}</span>
      <span class="committee-row-meta">${statusBadge(status)}${deadlineBadge(deadline)}</span>
    </div>`;
  }).join("\n");

  // ── 最新ニュース ──
  const newsSection = news.length ? `
  <div class="top-news">
    <span class="top-news-label">📢 最新ニュース</span>
    <div class="top-news-items">
      ${news.slice(0, 10).map(p => {
        const title = getText(p, "Name");
        const date  = fmtDate(getDate(p));
        const url   = getUrl(p);
        const text  = url
          ? `<a href="${escAttr(url)}" class="top-news-text" target="_blank" rel="noopener">${title}</a>`
          : `<span class="top-news-text">${title}</span>`;
        return `<div class="top-news-item"><span class="top-news-date">${date}</span>${text}</div>`;
      }).join("\n      ")}
    </div>
  </div>` : "";

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
  const yuNewsSlice = yuNews.slice(0, 12);

  // TikTokは保存済みURLが期限切れになるため常にoEmbedから取得
  const tiktokTargetsIdx = yuNewsSlice.map(p =>
    getUrl(p).includes("tiktok.com") ? getUrl(p) : null
  );
  const tiktokThumbs = await Promise.all(
    tiktokTargetsIdx.map(u => u ? fetchOembedThumbnail(u) : Promise.resolve(""))
  );

  // LeminoはMediaが未設定の場合のみog:imageをビルド時に取得
  const leminoTargetsIdx = yuNewsSlice.map(p =>
    (!getMedia(p) && getUrl(p).includes("lemino")) ? getUrl(p) : null
  );
  const leminoThumbs = await Promise.all(
    leminoTargetsIdx.map(u => u ? fetchLeminoThumbnail(u) : Promise.resolve(""))
  );

  const yuNewsCards = yuNewsSlice.map((p, i) => {
    const url      = getUrl(p);
    const title    = getText(p, "Name") || "詳細を見る";
    const date     = fmtDate(getDate(p));
    const platform = getSelect(p, "Platform");
    const badge    = platform ? `<span class="${badgeClass(platform)}" style="font-size:9px;padding:2px 7px;">${platform}</span>` : "";

    // サムネイル: TikTokは常にoEmbed → Notion保存済み → Leminoはog:image → YouTube自動生成 → なし
    let img = tiktokThumbs[i] || "";
    if (!img) img = getMedia(p) || leminoThumbs[i] || "";
    if (!img) {
      const ytMatch = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
      if (ytMatch) img = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }

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

  const tileGroups = [
    { id: "satoyu",    label: "さとうゆ情報",  emoji: "💚", bg: "var(--emerald-light)",
      links: [{href:"yu.html",text:"佐藤優羽さんについて"},{href:"yunews.html",text:"News"},{href:"history.html",text:"ヒストリー"},{href:"quiz.html",text:"クイズ"}] },
    { id: "blog",      label: "ブログ等",       emoji: "📝", bg: "var(--pink)",
      links: [{href:"blog.html",text:"ブログ"},{href:"member-blog.html",text:"他メンバーブログ"},{href:"interview.html",text:"インタビュー"}] },
    { id: "sns",       label: "SNS",            emoji: "📱", bg: "var(--butter)",
      links: [{href:"x.html",text:"X"},{href:"tiktok.html",text:"TikTok"}] },
    { id: "video",     label: "動画",           emoji: "▶️",  bg: "var(--sky)",
      links: [{href:"youtube.html",text:"YouTube"},{href:"lemino.html",text:"Lemino"}] },
    { id: "card",      label: "カード作成",     emoji: "🎴", bg: "var(--emerald-pale)",
      links: [{href:"card.html",text:"プロフィールカード"},{href:"message.html",text:"お誕生日メッセージ"}] },
    { id: "committee", label: "委員会",         emoji: "🌿", bg: "var(--cream)",
      links: [{href:"committee.html",text:"委員会News"},{href:"activities.html",text:"活動報告"},{href:"about.html",text:"委員会について"},{href:"site-info.html",text:"このサイトについて"},{href:"terms.html",text:"規約"},{href:"join.html",text:"入会"}] },
  ];
  const tileNav = `
  <div class="mobile-tile-nav" role="navigation" aria-label="コンテンツナビゲーション">
    <div class="tile-grid">
      ${tileGroups.map(g => `<button class="tile-item" data-group="${g.id}" aria-expanded="false">${g.label}</button>`).join("\n      ")}
    </div>
    ${tileGroups.map(g => `<div class="tile-submenu" data-for="${g.id}">
      ${g.links.map(l => `<a href="${l.href}">${l.text}</a>`).join("\n      ")}
    </div>`).join("\n    ")}
  </div>
  <script>
  (function(){
    var tiles = document.querySelectorAll('.tile-item[data-group]');
    var menus = document.querySelectorAll('.tile-submenu');
    tiles.forEach(function(tile){
      tile.addEventListener('click', function(){
        var id = tile.dataset.group;
        var isActive = tile.classList.contains('active');
        tiles.forEach(function(t){ t.classList.remove('active'); t.setAttribute('aria-expanded','false'); });
        menus.forEach(function(m){ m.classList.remove('open'); });
        if (!isActive) {
          tile.classList.add('active');
          tile.setAttribute('aria-expanded','true');
          var menu = document.querySelector('.tile-submenu[data-for="' + id + '"]');
          if (menu) menu.classList.add('open');
        }
      });
    });
  })();
  </script>`;

  // ── PC専用ヒーロー（案A：サイド分割） ──
  const pcHeroHtml = `
<div class="hero-pc-wrap">
  <div class="hero-pc">
    <span class="hero-pc-dot" style="left:70px;top:84px;width:14px;height:14px;background:var(--pink);"></span>
    <span class="hero-pc-dot" style="left:110px;top:118px;width:8px;height:8px;background:var(--emerald-light);"></span>
    <span class="hero-pc-dot" style="left:44%;bottom:30px;width:10px;height:10px;background:var(--butter);"></span>
    <div class="hero-pc-text">
      <div class="hero-pc-badge">SATOYU HOME</div>
      <h1 class="hero-pc-title">さとうゆ<em>ほーむ</em></h1>
      <div class="hero-pc-box">
        <p><strong>さとうゆほーむ</strong>は、日向坂46五期生・佐藤優羽さんの情報をまとめた非公式ファンサイトです。</p>
        <p>運営：<a href="about.html">佐藤優羽生誕祭実行委員会</a><a href="site-info.html" class="hero-pc-box-link">このサイトについて →</a></p>
      </div>
      ${newsSection ? newsSection.replace('<div class="top-news">', '<div class="top-news hero-pc-news">') : ""}
    </div>
    <div class="hero-pc-imgwrap">
      <img src="/images/円周率.png" alt="佐藤優羽さんイラスト" class="hero-pc-img" loading="eager">
    </div>
  </div>
</div>`;

  // ── モバイル用ヒーロー（既存のコンパクト2カラム） ──
  const mobileHeroHtml = `
<div class="hero-mobile-wrap">
  <div class="page-hero page-hero--index">
    <div class="page-hero-left">
      <div class="page-hero-tag">SATOYU HOME</div>
      <h1>さとうゆ<em>ほーむ</em></h1>
      <div class="top-intro">
        <p class="top-intro-text top-intro-mobile">
          佐藤優羽さんの情報をまとめた非公式ファンサイトです。｜運営：佐藤優羽生誕祭実行委員会
        </p>
      </div>
    </div>
    <div class="top-hero-img-wrap">
      <img src="/images/円周率.png" alt="佐藤優羽さんイラスト" class="top-hero-img" loading="eager">
    </div>
  </div>
</div>`;

  const customHero = pcHeroHtml + mobileHeroHtml;

  const body = `
  ${tileNav}
  ${newsSection ? `<div class="top-news-mobile-only">${newsSection}</div>` : ""}
  <div class="top-layout">

    <!-- メインコンテンツ -->
    <div class="top-main">

      <!-- 佐藤優羽さんNews（メイン） -->
      <section class="top-sec-yunews">
        <div class="top-section-header">
          <h2>佐藤優羽さん News</h2>
          <a href="yunews.html">すべて見る →</a>
        </div>
        <div class="yunews-grid">
          ${yuNewsCards}
        </div>
      </section>

      <!-- 生誕委員会からのお知らせ -->
      <section class="top-sec-committee">
        <div class="top-section-header">
          <h2 style="font-size:15px;color:var(--text-muted);">生誕委員会からのお知らせ</h2>
          <a href="committee.html">すべて見る →</a>
        </div>
        <div class="committee-list">
          ${committeeRows}
        </div>
      </section>

      <!-- 活動報告 -->
      <section class="top-sec-activities">
        <div class="top-section-header">
          <h2 style="font-size:15px;color:var(--text-muted);">活動報告</h2>
          <a href="activities.html">すべて見る →</a>
        </div>
        <div class="act-thumb-grid">
          ${actCards}
        </div>
      </section>

    </div>

    <!-- サイドバー -->
    <aside class="top-sidebar">

      ${scheduleRows ? `
      <div class="sidebar-widget top-sidebar-schedule">
        <div style="padding:10px 14px 6px;font-family:'Shippori Mincho',serif;font-size:13px;font-weight:500;color:var(--text);border-bottom:1px solid var(--border);">スケジュール</div>
        <div class="schedule-list">${scheduleRows}</div>
      </div>` : ""}

      ${ytEmbedHtml ? `<div class="sidebar-widget top-sidebar-yt">${ytEmbedHtml}</div>` : ""}

      ${xEmbedHtml ? `<div class="sidebar-widget sidebar-widget-inner top-sidebar-x">
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

      <div class="sidebar-links top-sidebar-links">
        <a href="about.html">委員会について</a>
        <a href="terms.html">生誕委員規約</a>
        <a href="join.html">入会の流れ</a>
      </div>

    </aside>

  </div>`;

  return buildPage(tpl, "トップ", "", "", "", body, "index.html", "", "", "佐藤優羽さんの最新情報をお届けするファンサイト｜運営：佐藤優羽生誕祭実行委員会", "", "", customHero);
}

async function buildCommittee(tpl) {
  const pages = await queryDB(DB.committeeNews, [{ property: "Priority", direction: "ascending" }]);
  const cards = pages.map(p => {
    const status       = getSelect(p,"Status");
    const img          = getMedia(p);
    const title        = getText(p,"Name");
    const date         = fmtDate(getDate(p));
    const desc         = getText(p,"Description");
    const url          = getUrl(p);
    const deadline     = getDate(p, "締め切り");
    const announceDate = fmtDate(getDate(p, "お知らせ日"));
    const imgTag = img ? `<img class="media-img" src="${img}" alt="${title}" loading="lazy">` : "";
    const link = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">詳しく見る →</a>` : "";
    const modalAttrs = actModalAttrs(p);
    const deadlineAttr = deadline ? ` data-deadline="${escAttr(deadline)}"` : "";
    return `
    <div class="card media-card" style="animation-delay:${Math.random()*0.3}s" ${modalAttrs}${deadlineAttr}>
      ${imgTag}
      <div class="media-body">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
          ${statusBadge(status)}
          ${announceDate ? `<span class="announce-date">📢 ${announceDate}</span>` : `<span class="media-date">${date}</span>`}
          ${deadlineBadge(deadline)}
        </div>
        <p class="media-title">${title}</p>
        <div class="media-meta">
          ${date && announceDate ? `<span class="media-date-small">実行日：${date}</span>` : "<span></span>"}
          ${link}
        </div>
      </div>
    </div>`;
  }).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "委員会News", "COMMITTEE NEWS", "委員会 <em>News</em>", "佐藤優羽生誕祭実行委員会からのお知らせ・活動情報", body, "committee.html");
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
        <div class="media-meta"><span></span>${link}</div>
      </div>
    </div>`;
  }).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "活動報告", "ACTIVITIES", "活動 <em>報告</em>", "委員会の活動をご紹介します", body, "activities.html");
}

async function buildBlog(tpl) {
  const pages = await queryDB(DB.blog);
  const cards = pages.map(p => mediaCard(p, "Blog")).join("\n");
  const body = `<div class="grid-3" id="blog-grid">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>
  <div class="load-more-wrap" id="blog-more-wrap">
    <p class="load-more-count" id="blog-more-count"></p>
    <button class="load-more-btn" id="blog-more-btn">もっと見る</button>
  </div>
  <script>
  (function(){
    var mobile=window.innerWidth<768;
    var BATCH=mobile?10:30;
    var grid=document.getElementById('blog-grid');
    var btn=document.getElementById('blog-more-btn');
    var countEl=document.getElementById('blog-more-count');
    var wrap=document.getElementById('blog-more-wrap');
    var all=Array.from(grid.querySelectorAll('.card'));
    var total=all.length;
    var shown=0;
    all.forEach(function(c){c.style.display='none';});
    function showMore(){
      var next=Math.min(shown+BATCH,total);
      for(var i=shown;i<next;i++) all[i].style.display='';
      shown=next;
      countEl.textContent=shown+' / '+total+' 件表示中';
      if(shown>=total) wrap.style.display='none';
      else btn.textContent='もっと見る（残り'+(total-shown)+'件）';
    }
    btn.addEventListener('click',showMore);
    showMore();
  })();
  <\/script>`;
  return buildPage(tpl, "ブログまとめ", "BLOG", "ブログ <em>まとめ</em>", "佐藤優羽さんの公式ブログをまとめています", body, "blog.html");
}

function getMemberNames(page) {
  const p = page.properties["Member"];
  if (!p) return [];
  if (p.multi_select?.length) return p.multi_select.map(s => s.name);
  if (p.select?.name)         return [p.select.name];
  if (p.rich_text?.length) {
    const text = p.rich_text.map(t => t.plain_text).join("").trim();
    return text ? text.split(/[,、・／/]/).map(s => s.trim()).filter(Boolean) : [];
  }
  return [];
}

async function buildMemberBlog(tpl) {
  const pages = await queryDB(DB.memberBlog);

  // 日向坂46メンバー番号順（ポカを先頭、以降は背番号順）
  const MEMBER_ORDER = [
    "ポカ",
    "金村美玖","小坂菜緒","上村ひなの","高橋未来虹","森本茉莉","山口陽世",
    "石塚瑠季","小西夏菜実","清水理央","正源司陽子","竹内希来里","平尾帆夏",
    "平岡海月","藤嶋果歩","宮地すみれ","山下葉留花","渡辺莉奈","大田美月",
    "大野愛実","片山紗希","蔵盛妃那乃","坂井新奈","佐藤優羽","下田衣珠季",
    "高井俐香","鶴崎仁香","松尾桜",
  ];
  // 旧字体・異体字を統一してから照合（髙→高、嶌→嶋 など）
  const normName = (s) => s.replace(/\s/g, "").normalize("NFKC").replace(/髙/g, "高").replace(/嶌/g, "嶋");
  const memberRank = (name) => {
    const n = normName(name);
    const idx = MEMBER_ORDER.findIndex(m => normName(m) === n);
    return idx === -1 ? 999 : idx;
  };

  // メンバー名を番号順に収集
  const memberSet = new Set();
  pages.forEach(p => getMemberNames(p).forEach(m => memberSet.add(m)));
  const allMembers = [...memberSet].sort((a, b) => memberRank(a) - memberRank(b));

  const cards = pages.map(p => {
    const url     = getUrl(p);
    const title   = getText(p, "Name");
    const date    = fmtDate(getDate(p));
    const desc    = getText(p, "Description");
    const img     = getMedia(p);
    const members = getMemberNames(p);
    const memberBadges = members.map(m => `<span class="badge badge-member">${m}</span>`).join(" ");
    const blogBadge = `<span class="badge badge-blog">ブログ</span>`;
    const badges = [memberBadges, blogBadge].filter(Boolean).join(" ");
    const membersAttr = escAttr(members.join(","));
    const imgTag = img
      ? `<img class="media-img" src="${img}" alt="${escAttr(title)}" loading="lazy">`
      : `<div class="media-img" style="display:flex;align-items:center;justify-content:center;color:var(--text-light);font-size:12px;">No Image</div>`;
    const link = url ? `<a href="${url}" class="news-card-link" target="_blank" rel="noopener">ブログを読む →</a>` : "";
    return `
  <div class="card media-card mblog-card" data-members="${membersAttr}" style="animation-delay:${Math.random()*0.3}s">
    ${imgTag}
    <div class="media-body">
      ${badges}
      <p class="media-title" style="margin-top:6px">${title}</p>
      <div class="media-meta">
        <span class="media-date">${date}</span>
        ${link}
      </div>
    </div>
  </div>`;
  }).join("\n");

  const filterBtns = [
    `<button class="mbf-btn mbf-btn--active" data-member="">すべて (${pages.length})</button>`,
    ...allMembers.map(m => {
      const count = pages.filter(p => getMemberNames(p).includes(m)).length;
      return `<button class="mbf-btn" data-member="${escAttr(m)}">${m} <span class="mbf-count">(${count})</span></button>`;
    }),
  ].join("\n    ");

  const body = `
<style>
.mbf-wrap { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
.mbf-btn {
  padding:6px 16px; border:2px solid var(--border); border-radius:99px;
  background:var(--white); font-family:'Zen Maru Gothic',serif; font-size:13px;
  color:var(--text-muted); cursor:pointer; transition:all 0.15s; line-height:1.4;
}
.mbf-btn:hover { border-color:var(--pink); color:#7a1535; }
.mbf-btn--active { border-color:var(--pink); background:var(--pink); color:#7a1535; font-weight:600; }
.mbf-count { font-size:11px; opacity:0.75; }
</style>
<div class="mbf-wrap" id="mbf-wrap">
  ${filterBtns}
</div>
<div class="grid-3" id="mbf-grid">
  <!-- GALLERY_START -->
  ${cards}
  <!-- GALLERY_END -->
</div>
<div class="load-more-wrap" id="mblog-more-wrap">
  <p class="load-more-count" id="mblog-more-count"></p>
  <button class="load-more-btn" id="mblog-more-btn">もっと見る</button>
</div>
<script>
(function(){
  var mobile=window.innerWidth<768;
  var BATCH=mobile?10:30;
  var btns=document.querySelectorAll('.mbf-btn');
  var cards=Array.from(document.querySelectorAll('.mblog-card'));
  var moreWrap=document.getElementById('mblog-more-wrap');
  var moreBtn=document.getElementById('mblog-more-btn');
  var countEl=document.getElementById('mblog-more-count');
  var currentMember='';
  var shown=0;

  function getFiltered(){
    if(!currentMember) return cards;
    return cards.filter(function(c){
      return (c.dataset.members||'').split(',').indexOf(currentMember)>=0;
    });
  }

  function reset(){
    var filtered=getFiltered();
    cards.forEach(function(c){c.style.display='none';});
    shown=0;
    if(currentMember){
      filtered.forEach(function(c){c.style.display='';});
      shown=filtered.length;
      moreWrap.style.display='none';
    } else {
      moreWrap.style.display='';
      showMore();
    }
  }

  function showMore(){
    var filtered=getFiltered();
    var total=filtered.length;
    var next=Math.min(shown+BATCH,total);
    for(var i=shown;i<next;i++) filtered[i].style.display='';
    shown=next;
    countEl.textContent=shown+' / '+total+' 件表示中';
    if(shown>=total) moreWrap.style.display='none';
    else{ moreWrap.style.display=''; moreBtn.textContent='もっと見る（残り'+(total-shown)+'件）'; }
  }

  btns.forEach(function(btn){
    btn.addEventListener('click',function(){
      btns.forEach(function(b){b.classList.remove('mbf-btn--active');});
      this.classList.add('mbf-btn--active');
      currentMember=this.dataset.member;
      reset();
    });
  });
  moreBtn.addEventListener('click',showMore);
  reset();
})();
<\/script>`;

  return buildPage(tpl, "他メンバーブログ", "MEMBER BLOG", "他メンバー <em>ブログ</em>", "佐藤優羽さんの登場している他メンバーのブログをまとめています", body, "member-blog.html");
}

async function buildInterview(tpl) {
  const pages = await queryDB(DB.interview);
  const cards = pages.map(p => mediaCard(p, "インタビュー、雑誌掲載")).join("\n");
  const body = `<div class="grid-2">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>`;
  return buildPage(tpl, "インタビュー、雑誌掲載集", "INTERVIEW", "インタビュー、 <em>雑誌掲載集</em>", "佐藤優羽さんのインタビュー記事、雑誌掲載をまとめています", body, "interview.html");
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

  const H2_STYLE = "font-family:'Shippori Mincho',serif;font-size:18px;font-weight:500;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);";
  const xSection = (tag, ps) => {
    const initial  = ps.slice(0, 3);
    const deferred = ps.slice(3);
    const initialHtml = initial.map((p, i) => {
      let card = xCard(p, embedMap.get(p.id));
      // 3件目はモバイルで非表示（CSSで制御）
      if (i === 2) card = card.replace('class="x-card"', 'class="x-card x-card--third"');
      return card;
    }).join("\n");
    const deferredHtml = deferred.map(p => xCard(p, embedMap.get(p.id))).join("\n");
    const heading  = tag ? `<h2 style="${H2_STYLE}">${tag}</h2>` : '';
    const moreHtml = ps.length > 2 ? `
    <template class="x-more-tpl">${deferredHtml}</template>
    <div class="x-more-wrap">
      <button class="x-more-btn" type="button">さらに表示</button>
    </div>` : '';
    return `
  <section style="margin-bottom:48px;" class="x-section">
    ${heading}
    <div class="x-embed-grid">${initialHtml}</div>
    ${moreHtml}
  </section>`;
  };

  let body = "";
  for (const [tag, ps] of Object.entries(taggedGroups)) body += xSection(tag, ps);
  if (untagged.length > 0) body += xSection("", untagged);

  body += `\n  <script>
(function(){
  var widgetsLoaded=false, pending=[];

  function renderCard(card){
    if(card.dataset.rendered)return;
    card.dataset.rendered='1';
    if(widgetsLoaded){
      window.twttr&&window.twttr.widgets&&twttr.widgets.load(card);
    }else{
      pending.push(card);
    }
  }

  var cardObs=('IntersectionObserver' in window)?new IntersectionObserver(function(entries,o){
    entries.forEach(function(e){if(e.isIntersecting){renderCard(e.target);o.unobserve(e.target);}});
  },{rootMargin:'200px'}):null;

  document.querySelectorAll('.x-section').forEach(function(sec){
    var grid=sec.querySelector('.x-embed-grid');
    var tpl=sec.querySelector('.x-more-tpl');
    var btn=sec.querySelector('.x-more-btn');
    var third=grid?grid.querySelector('.x-card--third'):null;
    var mobile=window.innerWidth<600;
    var BATCH=mobile?2:3;
    var pool=[];
    if(third&&mobile){third.style.display='none';pool.push({dom:true,el:third});}
    if(tpl){Array.from(tpl.content.querySelectorAll('.x-card')).forEach(function(c){pool.push({dom:false,el:c});});}
    function showBatch(){
      pool.splice(0,BATCH).forEach(function(item){
        if(item.dom)item.el.style.display='';
        else grid.appendChild(item.el);
        if(cardObs)cardObs.observe(item.el);else renderCard(item.el);
      });
      if(pool.length>0)btn.textContent='さらに表示（残り'+pool.length+'件）';
      else btn.closest('.x-more-wrap').style.display='none';
    }
    if(!btn)return;
    if(pool.length>0){btn.textContent='さらに表示（'+pool.length+'件）';btn.addEventListener('click',showBatch);}
    else btn.closest('.x-more-wrap').style.display='none';
  });

  function loadWidgets(){
    var s=document.createElement('script');
    s.src='https://platform.twitter.com/widgets.js';
    s.async=true;s.charset='utf-8';
    s.onload=function(){
      widgetsLoaded=true;
      window.twttr&&window.twttr.ready(function(){
        pending.forEach(function(c){twttr.widgets.load(c);});
        pending=[];
      });
    };
    document.body.appendChild(s);
  }

  var tweets=document.querySelectorAll('.twitter-tweet');
  if(!tweets.length)return;

  document.querySelectorAll('.x-card').forEach(function(card){
    if(cardObs)cardObs.observe(card);else renderCard(card);
  });

  if(!('IntersectionObserver' in window)){loadWidgets();return;}
  var obs=new IntersectionObserver(function(entries){
    if(entries[0].isIntersecting){loadWidgets();obs.disconnect();}
  },{rootMargin:'300px'});
  obs.observe(tweets[0]);
})();
<\/script>`;

  return buildPage(tpl, "Xまとめ", "X / TWITTER", "X <em>まとめ</em>", "佐藤優羽さん関連のX投稿をまとめています", body, "x.html");
}

async function buildTiktok(tpl) {
  const pages = await queryDB(DB.tiktok);
  console.log(`  TikTokサムネイル取得中 (${pages.length}件)...`);
  const thumbs = await Promise.all(pages.map(p => fetchOembedThumbnail(getUrl(p))));
  const cards = pages.map((p, i) => tiktokCard(p, thumbs[i])).join("\n");
  const body = `<div class="grid-3" id="tiktok-grid">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>
  <div class="load-more-wrap" id="tiktok-more-wrap">
    <p class="load-more-count" id="tiktok-more-count"></p>
    <button class="load-more-btn" id="tiktok-more-btn">もっと見る</button>
  </div>
  <script>
  (function(){
    var mobile=window.innerWidth<768;
    var BATCH=mobile?6:9;
    var grid=document.getElementById('tiktok-grid');
    var btn=document.getElementById('tiktok-more-btn');
    var countEl=document.getElementById('tiktok-more-count');
    var wrap=document.getElementById('tiktok-more-wrap');
    var all=Array.from(grid.querySelectorAll('.card'));
    var total=all.length;
    var shown=0;
    all.forEach(function(c){c.style.display='none';});
    function showMore(){
      var next=Math.min(shown+BATCH,total);
      for(var i=shown;i<next;i++) all[i].style.display='';
      shown=next;
      countEl.textContent=shown+' / '+total+' 件表示中';
      if(shown>=total) wrap.style.display='none';
      else btn.textContent='もっと見る（残り'+(total-shown)+'件）';
    }
    btn.addEventListener('click',showMore);
    showMore();
  })();
  <\/script>`;
  return buildPage(tpl, "TikTokまとめ", "TIKTOK", "TikTok <em>まとめ</em>", "佐藤優羽さんのTikTok動画をまとめています", body, "tiktok.html");
}

async function buildYoutube(tpl) {
  const pages = await queryDB(DB.youtube);

  const typeOrder = [
    "個人PV", "ドキュメンタリー", "企画", "生配信", "MV", "コール動画", "ひななり", "ひなこい",
  ];

  // Type でグループ化（Channel はカードのバッジに表示）
  const groups = {};
  for (const p of pages) {
    const type = getSelect(p, "Type") || "その他";
    if (!groups[type]) groups[type] = [];
    groups[type].push(p);
  }

  const orderedTypes = [
    ...typeOrder.filter(t => groups[t]),
    ...Object.keys(groups).filter(t => !typeOrder.includes(t)),
  ];

  const body = orderedTypes.map(type => {
    const cards = groups[type].map(p => {
      const ch = getSelect(p, "Channel") || getText(p, "Channel") || "YouTube";
      return youtubeCard(p, ch);
    }).join("\n");
    return `
    <section style="margin-bottom:48px;">
      <h2 style="font-family:'Shippori Mincho',serif;font-size:18px;font-weight:500;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--border);">${type}</h2>
      <div class="grid-3">${cards}</div>
    </section>`;
  }).join("\n");

  return buildPage(tpl, "YouTubeまとめ", "YOUTUBE", "YouTube <em>まとめ</em>", "佐藤優羽さんのYouTube動画をまとめています", body, "youtube.html");
}

async function buildYuNews(tpl) {
  const pages = await queryDB(DB.yuNews);

  // TikTokは保存済みURLが期限切れになるため常にoEmbedから取得
  const tiktokTargets = pages.map(p =>
    getUrl(p).includes("tiktok.com") ? getUrl(p) : null
  );
  const hasTiktok = tiktokTargets.some(Boolean);
  if (hasTiktok) console.log(`  Yu News TikTokサムネイル取得中 (${tiktokTargets.filter(Boolean).length}件)...`);
  const tiktokThumbs = await Promise.all(
    tiktokTargets.map(u => u ? fetchOembedThumbnail(u) : Promise.resolve(""))
  );

  // LeminoはMediaが未設定の場合のみog:imageをビルド時に取得
  const leminoTargets = pages.map(p =>
    (!getMedia(p) && getUrl(p).includes("lemino")) ? getUrl(p) : null
  );
  const hasLemino = leminoTargets.some(Boolean);
  if (hasLemino) console.log(`  Yu News Leminoサムネイル取得中 (${leminoTargets.filter(Boolean).length}件)...`);
  const leminoThumbs = await Promise.all(
    leminoTargets.map(u => u ? fetchLeminoThumbnail(u) : Promise.resolve(""))
  );

  const cards = pages.map((p, i) => {
    let img = tiktokThumbs[i] || "";
    if (!img) img = getMedia(p) || leminoThumbs[i] || "";
    if (!img) {
      const url = getUrl(p);
      const ytMatch = url.match(/(?:v=|youtu\.be\/)([^&?/]+)/);
      if (ytMatch) img = `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;
    }
    return newsCard(p, undefined, img);
  }).join("\n");

  const body = `<div class="grid-3" id="yunews-grid">
    <!-- GALLERY_START -->
    ${cards}
    <!-- GALLERY_END -->
  </div>
  <div class="load-more-wrap" id="yunews-more-wrap">
    <p class="load-more-count" id="yunews-more-count"></p>
    <button class="load-more-btn" id="yunews-more-btn">もっと見る</button>
  </div>
  <script>
  (function(){
    var mobile=window.innerWidth<768;
    var BATCH=mobile?10:15;
    var grid=document.getElementById('yunews-grid');
    var btn=document.getElementById('yunews-more-btn');
    var countEl=document.getElementById('yunews-more-count');
    var wrap=document.getElementById('yunews-more-wrap');
    var all=Array.from(grid.querySelectorAll('.news-card'));
    var total=all.length;
    var shown=0;
    all.forEach(function(c){c.style.display='none';});
    function showMore(){
      var next=Math.min(shown+BATCH,total);
      for(var i=shown;i<next;i++) all[i].style.display='';
      shown=next;
      countEl.textContent=shown+' / '+total+' 件表示中';
      if(shown>=total) wrap.style.display='none';
      else btn.textContent='もっと見る（残り'+(total-shown)+'件）';
    }
    btn.addEventListener('click',showMore);
    showMore();
  })();
  <\/script>`;
  return buildPage(tpl, "佐藤優羽さんNews", "YU NEWS", "佐藤優羽さん <em>News</em>", "佐藤優羽さんの最新情報をまとめています", body, "yunews.html");
}

async function buildLemino(tpl) {
  const today = new Date().toISOString().split('T')[0];

  // 配信終了予定が過ぎた「日向坂で会いましょう」エントリを自動非公開化
  // queryDB は Published=true のみ返すため、期限切れを事前にチェックする
  const allLemino = await queryDB(DB.lemino);
  const expired = allLemino.filter(p => {
    const prog = getSelect(p, "Program") || getText(p, "Program");
    const expiry = getDate(p, "配信終了予定");
    return prog === "日向坂で会いましょう" && expiry && expiry < today;
  });
  if (expired.length > 0) {
    console.log(`  Lemino: 配信終了済み ${expired.length}件を非公開化...`);
    await Promise.all(expired.map(p =>
      notion.pages.update({ page_id: p.id, properties: { Published: { checkbox: false } } })
        .catch(e => console.error(`    ❌ 非公開化失敗: ${p.id}`, e.message))
    ));
  }

  // 非公開化後の有効エントリで表示
  const activePages = allLemino.filter(p => !expired.some(e => e.id === p.id));

  console.log(`  Leminoサムネイル取得中 (${activePages.length}件)...`);
  const thumbs = await Promise.all(activePages.map(p => {
    const stored = getMedia(p);
    return stored ? Promise.resolve(stored) : fetchLeminoThumbnail(getUrl(p));
  }));

  // Programごとにグループ化
  const PROGRAM_ORDER = ["日向坂になりましょう", "日向坂で会いましょう"];
  const groups = {};
  activePages.forEach((p, i) => {
    const prog = getSelect(p, "Program") || getText(p, "Program") || "その他";
    if (!groups[prog]) groups[prog] = [];
    groups[prog].push({ page: p, thumb: thumbs[i] });
  });

  const displayOrder = [
    ...PROGRAM_ORDER,
    ...Object.keys(groups).filter(k => !PROGRAM_ORDER.includes(k)),
  ];

  const PROGRAM_LABELS = {
    "日向坂になりましょう": "日向坂になりましょう（佐藤優羽さん登場回）",
  };

  const LEMINO_BATCH = 8;
  const sections = displayOrder
    .filter(prog => groups[prog]?.length)
    .map((prog, idx) => {
      const cards = groups[prog].map(({ page: p, thumb }) => mediaCard(p, "Lemino", thumb)).join("\n");
      const label = PROGRAM_LABELS[prog] || prog;
      const gridId = `lemino-grid-${idx}`;
      const wrapId = `lemino-more-wrap-${idx}`;
      const btnId  = `lemino-more-btn-${idx}`;
      const cntId  = `lemino-more-count-${idx}`;
      return `<h2 class="program-heading">${label}</h2>
    <div class="grid-2 program-grid" id="${gridId}">
      ${cards}
    </div>
    <div class="load-more-wrap" id="${wrapId}">
      <p class="load-more-count" id="${cntId}"></p>
      <button class="load-more-btn" id="${btnId}">もっと見る</button>
    </div>
    <script>
    (function(){
      var BATCH=${LEMINO_BATCH};
      var grid=document.getElementById('${gridId}');
      var btn=document.getElementById('${btnId}');
      var countEl=document.getElementById('${cntId}');
      var wrap=document.getElementById('${wrapId}');
      var all=Array.from(grid.querySelectorAll('.card'));
      var total=all.length;
      var shown=0;
      all.forEach(function(c){c.style.display='none';});
      function showMore(){
        var next=Math.min(shown+BATCH,total);
        for(var i=shown;i<next;i++) all[i].style.display='';
        shown=next;
        countEl.textContent=shown+' / '+total+' 件表示中';
        if(shown>=total) wrap.style.display='none';
        else btn.textContent='もっと見る（残り'+(total-shown)+'件）';
      }
      btn.addEventListener('click',showMore);
      showMore();
    })();
    <\/script>`;
    })
    .join("\n");

  const body = `<div class="lemino-programs">
    ${sections}
  </div>`;
  return buildPage(tpl, "Leminoまとめ", "LEMINO", "Lemino <em>まとめ</em>", "佐藤優羽さんのLemino配信をまとめています", body, "lemino.html");
}


// ── ヒストリーページ ──
async function buildHistory(tpl) {
  const pages = await queryDB(DB.history, [{ property: "Date", direction: "descending" }]);
  // ビルド時点（JST）の年月 → その月をデフォルトで開く
  const _nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const curYear  = String(_nowJst.getUTCFullYear());
  const curMonth = `${_nowJst.getUTCMonth() + 1}月`;

  if (pages.length === 0) {
    const body = `<p style="color:var(--text-muted);text-align:center;padding:60px 0">データがありません</p>`;
    return buildPage(tpl, "ヒストリー", "HISTORY", "さとうゆ <em>ヒストリー</em>", "佐藤優羽さんの歩みをまとめた年表です", body, "history.html");
  }

  // Type → 色のパレット（ハッシュで安定割り当て）
  const TYPE_PALETTE = [
    { bg: "#dbeafe", color: "#1d4ed8" }, // 青
    { bg: "#dcfce7", color: "#15803d" }, // 緑
    { bg: "#fef3c7", color: "#b45309" }, // 黄
    { bg: "#f3e8ff", color: "#7c3aed" }, // 紫
    { bg: "#ffedd5", color: "#c2410c" }, // オレンジ
    { bg: "#fce7f3", color: "#be185d" }, // ピンク
    { bg: "#e0f2fe", color: "#0369a1" }, // 水色
    { bg: "#fef9c3", color: "#854d0e" }, // 黄緑
  ];
  const typeStyle = (type) => {
    let h = 0;
    for (const c of type) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    const { bg, color } = TYPE_PALETTE[h % TYPE_PALETTE.length];
    return `background:${bg};color:${color}`;
  };

  // 年 → 月 でグループ化（挿入順を保持）
  const byYear = {};
  for (const p of pages) {
    const date = getDate(p);
    const year = date ? date.slice(0, 4) : "不明";
    const month = date ? `${parseInt(date.slice(5, 7), 10)}月` : "不明";
    if (!byYear[year]) byYear[year] = {};
    if (!byYear[year][month]) byYear[year][month] = [];
    byYear[year][month].push(p);
  }

  const sections = Object.entries(byYear).map(([year, months]) => {
    const monthBlocks = Object.entries(months).map(([month, items]) => {
      const entries = items.map(p => {
        const title = getText(p, "Name");
        const date = fmtDate(getDate(p));
        const type = getSelect(p, "Type");
        const url = getUrl(p);
        const titleHtml = url
          ? `<a href="${escAttr(url)}" target="_blank" rel="noopener">${title}</a>`
          : title;
        const typeBadge = type
          ? `<span class="tl-type" style="${typeStyle(type)}">${type}</span>`
          : "";
        return `
          <div class="tl-item">
            <div class="tl-dot"></div>
            <span class="tl-date">${date}</span>
            ${typeBadge}
            <p class="tl-title">${titleHtml}</p>
          </div>`;
      }).join("\n");
      const openAttr = (year === curYear && month === curMonth) ? " open" : "";
      return `
        <details class="tl-month"${openAttr}>
          <summary class="tl-month-label">${month}<span class="tl-month-count">${items.length}件</span></summary>
          <div class="tl-track">${entries}</div>
        </details>`;
    }).join("\n");
    return `
      <div class="tl-year-block">
        <div class="tl-year-label">${year}</div>
        ${monthBlocks}
      </div>`;
  }).join("\n");

  const body = `
<style>
.tl-wrap { max-width: 780px; margin: 0 auto; }
.tl-year-block { margin-bottom: 32px; }
.tl-year-label {
  font-family: 'Caveat', cursive; font-size: 30px; font-weight: 700;
  color: var(--emerald-dark); padding-left: 18px;
  border-left: 5px solid var(--emerald); margin-bottom: 10px;
}
.tl-month { margin-left: 12px; margin-bottom: 6px; }
.tl-month-label {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 700; color: var(--emerald-dark);
  padding: 7px 14px; border-radius: 8px;
  background: var(--emerald-pale); border: 1.5px solid var(--emerald-light);
  cursor: pointer; list-style: none; user-select: none;
}
.tl-month-label::-webkit-details-marker { display: none; }
.tl-month-label::before { content: '▶'; font-size: 10px; color: var(--emerald); transition: transform .2s; }
details[open] .tl-month-label::before { transform: rotate(90deg); }
.tl-month-count { font-size: 11px; color: var(--text-muted); font-weight: 400; margin-left: auto; }
.tl-track {
  padding: 10px 0 4px 32px;
  border-left: 3px solid var(--emerald-light);
  margin-left: 10px;
  display: flex; flex-direction: column; gap: 8px;
}
.tl-item {
  position: relative; display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px;
  padding: 9px 14px; background: #fff;
  border: 2px solid var(--border); border-radius: 10px;
  box-shadow: 0 2px 6px rgba(0,0,0,0.03);
}
.tl-dot {
  position: absolute; left: -40px; top: 13px;
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--emerald); border: 2px solid #fff;
  box-shadow: 0 0 0 2px var(--emerald);
}
.tl-date {
  font-family: 'Caveat', cursive; font-size: 13px;
  color: var(--text-light); white-space: nowrap; flex-shrink: 0;
}
.tl-type {
  font-size: 11px; font-weight: 600; padding: 2px 8px;
  border-radius: 20px; white-space: nowrap; flex-shrink: 0;
}
.tl-title {
  font-size: 14px; font-weight: 600; color: var(--text);
  line-height: 1.5; margin: 0; flex: 1; min-width: 0;
}
.tl-title a { color: var(--emerald-dark); text-decoration: none; }
.tl-title a:hover { text-decoration: underline; }
@media (max-width: 600px) {
  .tl-year-label { font-size: 24px; }
  .tl-item { flex-direction: column; gap: 4px; }
}
</style>
<div class="tl-wrap">${sections}</div>`;

  return buildPage(tpl, "ヒストリー", "HISTORY", "さとうゆ <em>ヒストリー</em>", "佐藤優羽さんの歩みをまとめた年表です", body, "history.html");
}

// ── 今週のさとうゆ ──
// DB_TOP_NEWS の「今週のさとうゆ（…）」レコードのBodyをパースしてリンク付きで表示
function renderWeeklyBody(text) {
  const sections = [];
  let cur = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("📅")) continue;                  // タイトル行はNameを使う
    if (line.startsWith("#")) continue;                    // 旧レコードのハッシュタグ
    if (/^https?:\/\/satoyu\.info\/?$/.test(line)) continue; // 旧レコードのフッターURL
    if (line.startsWith("▼")) {
      cur = { label: line.replace(/^▼/, "").trim(), items: [] };
      sections.push(cur);
      continue;
    }
    if (/^https?:\/\//.test(line)) {
      if (cur && cur.items.length) cur.items[cur.items.length - 1].url = line;
      continue;
    }
    const itemText = line.replace(/^・/, "").trim();
    if (!cur) { cur = { label: "", items: [] }; sections.push(cur); }
    cur.items.push({ text: itemText, url: null });
  }
  return sections.map(s => {
    const items = s.items.map(it => {
      const safe = escAttr(it.text);
      return it.url
        ? `<li class="wk-item"><a href="${escAttr(it.url)}" target="_blank" rel="noopener">${safe}</a></li>`
        : `<li class="wk-item wk-item-plain">${safe}</li>`;
    }).join("");
    const label = s.label ? `<h3 class="wk-sec">${escAttr(s.label)}</h3>` : "";
    return `${label}<ul class="wk-list">${items}</ul>`;
  }).join("\n");
}

async function buildWeekly(tpl) {
  const all = await queryDB(DB.news, [{ property: "Date", direction: "descending" }]);
  const weeks = all.filter(p => getText(p, "Name").startsWith("今週のさとうゆ"));

  const style = `
<style>
.wk-wrap { max-width: 760px; margin: 0 auto; }
.wk-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
.wk-tab { padding: 7px 16px; border: 2px solid var(--emerald-light); border-radius: 99px; background: #fff; font-family: 'Zen Maru Gothic', serif; font-size: 13px; color: var(--text-muted); cursor: pointer; transition: all .15s; }
.wk-tab:hover { border-color: var(--emerald); color: var(--emerald-dark); }
.wk-tab.active { background: var(--emerald); color: #fff; border-color: var(--emerald); box-shadow: 2px 2px 0 var(--emerald-dark); }
.wk-week { background: var(--white, #fff); border: 2px solid var(--emerald-light); border-radius: 16px; padding: 22px 24px; margin-bottom: 24px; box-shadow: 0 3px 14px rgba(31,122,82,0.06); scroll-margin-top: 80px; }
.wk-week-title { font-family: 'Zen Maru Gothic', serif; font-size: 20px; font-weight: 700; color: var(--emerald-dark); padding-bottom: 10px; margin-bottom: 12px; border-bottom: 2px dashed var(--emerald-light); }
.wk-sec { font-size: 14px; font-weight: 700; color: var(--emerald-dark); background: var(--emerald-pale); border-radius: 8px; padding: 5px 12px; display: inline-block; margin: 14px 0 8px; }
.wk-list { list-style: none; padding: 0 0 0 4px; margin: 0; display: flex; flex-direction: column; gap: 7px; }
.wk-item { font-size: 14px; line-height: 1.6; padding-left: 16px; position: relative; }
.wk-item::before { content: '・'; position: absolute; left: 0; color: var(--emerald); }
.wk-item a { color: var(--text, #0f1e16); text-decoration: none; border-bottom: 1px solid var(--emerald-light); transition: color .15s, border-color .15s; }
.wk-item a:hover { color: var(--emerald-dark); border-color: var(--emerald); }
.wk-item-plain { color: var(--text-muted); }
.wk-empty { text-align: center; color: var(--text-muted); padding: 60px 0; }
</style>`;

  if (!weeks.length) {
    const body = `${style}<div class="wk-wrap"><p class="wk-empty">まだ「今週のさとうゆ」はありません。</p></div>`;
    return buildPage(tpl, "今週のさとうゆ", "WEEKLY", "今週の <em>さとうゆ</em>", "佐藤優羽さんの1週間の出来事・ブログ・TikTok・他メンバーブログ登場をまとめています", body, "weekly.html");
  }

  // OGP画像：最新週のもの（管理ページ生成時にweekly.pngへ上書き）。?v=で新しい週を認識させる
  const latestEnd = getDate(weeks[0]) || "";
  const latestLabel = (getText(weeks[0], "Name").match(/（(.+?)）/) || [])[1] || "";
  const ogpImage = latestEnd ? `${SITE_URL}/ogp/weekly.png?v=${latestEnd}` : "";
  const ogpDesc = latestLabel ? `今週のさとうゆ（${latestLabel}）｜出来事・ブログ・TikTok・他メンバーブログ登場まとめ` : "";

  const weekData = weeks.map(p => {
    const title = getText(p, "Name");
    const anchor = "w-" + (getDate(p) || "");
    const m = title.match(/（(.+?)）/);
    const label = m ? m[1] : title;
    return { title, anchor, label, inner: renderWeeklyBody(getText(p, "Body")) };
  });

  const tabs = weekData.map(w =>
    `<button class="wk-tab" data-week="${escAttr(w.anchor)}">${escAttr(w.label)}</button>`
  ).join("");

  const sections = weekData.map(w =>
    `<div class="wk-week" id="${escAttr(w.anchor)}">
      <h2 class="wk-week-title">${escAttr(w.title)}</h2>
      ${w.inner}
    </div>`
  ).join("\n");

  const script = `<script>(function(){
    var tabs=[].slice.call(document.querySelectorAll('.wk-tab'));
    var weeks=[].slice.call(document.querySelectorAll('.wk-week'));
    function show(id){
      weeks.forEach(function(w){ w.style.display=(w.id===id)?'':'none'; });
      tabs.forEach(function(t){ t.classList.toggle('active', t.dataset.week===id); });
    }
    var hashId=location.hash?location.hash.slice(1):'';
    var initial=(hashId&&document.getElementById(hashId))?hashId:(weeks[0]&&weeks[0].id);
    if(initial) show(initial);
    tabs.forEach(function(t){ t.addEventListener('click', function(){ show(t.dataset.week); history.replaceState(null,'','#'+t.dataset.week); }); });
    window.addEventListener('hashchange', function(){ var h=location.hash.slice(1); if(h&&document.getElementById(h)) show(h); });
  })();</script>`;

  const body = `${style}<div class="wk-wrap"><div class="wk-tabs">${tabs}</div>${sections}</div>${script}`;
  return buildPage(tpl, "今週のさとうゆ", "WEEKLY", "今週の <em>さとうゆ</em>", "佐藤優羽さんの1週間の出来事・ブログ・TikTok・他メンバーブログ登場をまとめています", body, "weekly.html", ogpImage, "", ogpDesc);
}

// ── クイズページ ──
async function buildQuiz(tpl) {
  // quiz_questions.json から問題を読み込む（ファイルがなければ空）
  let questions = [];
  if (fs.existsSync("quiz_questions.json")) {
    try {
      questions = JSON.parse(fs.readFileSync("quiz_questions.json", "utf-8"));
    } catch (e) {
      console.error("  quiz_questions.json の読み込みエラー:", e.message);
    }
  }

  const total = questions.length;
  const questionsJson = JSON.stringify(questions);

  const body = `
<style>
.quiz-wrap { max-width: 680px; margin: 0 auto; }
.quiz-screen { display: none; }
.quiz-screen.active { display: block; }
.quiz-start-box {
  text-align: center; padding: 48px 24px;
  background: #fff; border: 2px solid var(--ink); border-radius: 24px;
  box-shadow: 6px 6px 0 var(--pink);
}
.quiz-start-icon { font-size: 56px; margin-bottom: 16px; line-height: 1; }
.quiz-start-box h2 {
  font-family: 'Zen Maru Gothic',serif; font-size: 22px; font-weight: 600;
  color: var(--emerald-dark); margin-bottom: 12px;
}
.quiz-start-box p { font-size: 14px; color: var(--text-muted); margin-bottom: 28px; }
.quiz-btn {
  display: inline-block; padding: 14px 36px;
  background: var(--emerald); color: #fff;
  font-family: 'Zen Maru Gothic',serif; font-size: 16px; font-weight: 600;
  border: 2px solid var(--emerald-dark); border-radius: 50px;
  box-shadow: 3px 3px 0 var(--emerald-dark); cursor: pointer;
  text-decoration: none; transition: transform 0.1s,box-shadow 0.1s;
}
.quiz-btn:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--emerald-dark); }
.quiz-btn:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--emerald-dark); }
.quiz-btn.pink { background: var(--pink); border-color: #c8456e; box-shadow: 3px 3px 0 #c8456e; color: #fff; }
.quiz-btn.pink:hover { box-shadow: 4px 4px 0 #c8456e; }

.quiz-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.quiz-counter { font-family: 'Caveat',cursive; font-size: 18px; color: var(--text-muted); white-space: nowrap; }
.quiz-bar-wrap { flex: 1; height: 8px; background: var(--emerald-light); border-radius: 4px; overflow: hidden; }
.quiz-bar { height: 100%; background: var(--emerald); border-radius: 4px; transition: width 0.4s ease; }
.quiz-score-live { font-family: 'Caveat',cursive; font-size: 16px; color: var(--emerald-dark); white-space: nowrap; }

.quiz-q-box {
  background: #fff; border: 2px solid var(--ink); border-radius: 20px;
  box-shadow: 5px 5px 0 var(--butter); padding: 28px 24px; margin-bottom: 20px;
}
.quiz-q-text { font-family: 'Zen Maru Gothic',serif; font-size: 17px; font-weight: 600; color: var(--text); line-height: 1.7; }

.quiz-options { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
.quiz-opt-btn {
  width: 100%; padding: 14px 18px; text-align: left;
  background: #fff; border: 2px solid var(--border); border-radius: 14px;
  font-family: 'Zen Maru Gothic',serif; font-size: 14px; color: var(--text);
  cursor: pointer; transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  line-height: 1.6;
}
.quiz-opt-btn:hover:not(:disabled) {
  border-color: var(--emerald); background: var(--emerald-pale);
  box-shadow: 2px 2px 0 var(--emerald-light);
}
.quiz-opt-btn.correct {
  border-color: var(--emerald-dark); background: var(--emerald-pale);
  box-shadow: 3px 3px 0 var(--emerald-dark); font-weight: 600;
}
.quiz-opt-btn.wrong {
  border-color: #c8456e; background: var(--pink-pale);
  box-shadow: 3px 3px 0 #c8456e;
}
.quiz-opt-btn:disabled { cursor: default; }

.quiz-result-box {
  background: var(--cream); border: 2px dashed var(--emerald);
  border-radius: 16px; padding: 20px 22px; margin-bottom: 20px;
  animation: fadeUp 0.3s ease;
}
.quiz-result-label { font-size: 22px; margin-bottom: 8px; }
.quiz-result-exp { font-size: 13px; color: var(--text-muted); line-height: 1.85; margin-bottom: 14px; }
.quiz-source-link {
  display: inline-block; font-family: 'Zen Maru Gothic',serif; font-size: 12px;
  color: var(--emerald-dark); text-decoration: none; border-bottom: 1px solid var(--emerald-light);
  margin-bottom: 16px;
}
.quiz-source-link:hover { color: var(--pink); border-color: var(--pink); }
.quiz-next-wrap { text-align: right; }

.quiz-final-box {
  text-align: center; padding: 48px 24px;
  background: #fff; border: 2px solid var(--ink); border-radius: 24px;
  box-shadow: 6px 6px 0 var(--emerald-light);
}
.quiz-score-circle {
  width: 120px; height: 120px; border-radius: 50%; margin: 0 auto 24px;
  background: var(--emerald); border: 4px solid var(--emerald-dark);
  box-shadow: 4px 4px 0 var(--emerald-dark);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.quiz-score-circle .score-num {
  font-family: 'Caveat',cursive; font-size: 48px; font-weight: 700;
  color: #fff; line-height: 1;
}
.quiz-score-circle .score-den {
  font-family: 'Caveat',cursive; font-size: 16px; color: rgba(255,255,255,0.8);
}
.quiz-final-msg { font-family: 'Zen Maru Gothic',serif; font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 8px; }
.quiz-final-sub { font-size: 13px; color: var(--text-muted); margin-bottom: 28px; }
.quiz-final-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }

@media (max-width: 600px) {
  .quiz-q-text { font-size: 15px; }
  .quiz-opt-btn { font-size: 13px; padding: 12px 14px; }
}
</style>

<div class="quiz-wrap">

  <!-- ── スタート画面 ── -->
  <div id="quiz-start" class="quiz-screen active">
    <div class="quiz-start-box">
      <div class="quiz-start-icon">✨</div>
      <h2>さとうゆクイズ</h2>
      <p>
        佐藤優羽さんの過去の出演番組や出演ライブ、ブログ等から出題！<br>
        全${total}問からランダム5問に挑戦しよう♪
      </p>
      ${total === 0
        ? `<p style="font-size:12px;color:var(--text-light);">問題を準備中です…もうしばらくお待ちください</p>`
        : `<button class="quiz-btn" onclick="startQuiz()">スタート！</button>`}
    </div>
  </div>

  <!-- ── 問題画面 ── -->
  <div id="quiz-question" class="quiz-screen">
    <div class="quiz-header">
      <span class="quiz-counter">問 <span id="q-num">1</span> / <span id="q-total">10</span></span>
      <div class="quiz-bar-wrap">
        <div class="quiz-bar" id="q-bar" style="width:10%"></div>
      </div>
      <span class="quiz-score-live">正解 <span id="q-score">0</span></span>
    </div>

    <div class="quiz-q-box">
      <p class="quiz-q-text" id="q-text"></p>
    </div>

    <div class="quiz-options" id="q-options"></div>

    <div id="q-result" class="quiz-result-box" style="display:none">
      <div class="quiz-result-label" id="q-label"></div>
      <p class="quiz-result-exp" id="q-exp"></p>
      <a class="quiz-source-link" id="q-source" href="#" target="_blank" rel="noopener"></a>
      <div class="quiz-next-wrap">
        <button class="quiz-btn" id="q-next-btn" onclick="nextQuestion()">次の問題 →</button>
      </div>
    </div>
  </div>

  <!-- ── 結果画面 ── -->
  <div id="quiz-final" class="quiz-screen">
    <div class="quiz-final-box">
      <div class="quiz-score-circle">
        <span class="score-num" id="r-score">0</span>
        <span class="score-den">/ <span id="r-total">10</span></span>
      </div>
      <p class="quiz-final-msg" id="r-msg"></p>
      <p class="quiz-final-sub" id="r-sub"></p>
      <div class="quiz-final-actions">
        <button class="quiz-btn pink" onclick="startQuiz()">もう一度挑戦！</button>
        <a class="quiz-btn" href="blog.html">ブログを読む</a>
        <a class="quiz-btn" href="youtube.html">YouTube動画を見る</a>
        <a class="quiz-btn" href="tiktok.html">TikTok動画を見る</a>
        <a class="quiz-btn" href="lemino.html">Lemino動画を見る</a>
      </div>
    </div>
  </div>

</div>

<script>
(function(){
  var ALL_QUESTIONS = ${questionsJson};
  var QUIZ_SIZE = Math.min(5, ALL_QUESTIONS.length);

  var state = { questions: [], idx: 0, score: 0 };

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function showScreen(id) {
    ['quiz-start','quiz-question','quiz-final'].forEach(function(s){
      var el = document.getElementById(s);
      if (el) { el.classList.remove('active'); }
    });
    var target = document.getElementById(id);
    if (target) target.classList.add('active');
  }

  window.startQuiz = function() {
    state.questions = shuffle(ALL_QUESTIONS).slice(0, QUIZ_SIZE);
    state.idx = 0;
    state.score = 0;
    showScreen('quiz-question');
    renderQuestion();
  };

  function renderQuestion() {
    var q = state.questions[state.idx];
    var num = state.idx + 1;
    var total = state.questions.length;

    document.getElementById('q-num').textContent = num;
    document.getElementById('q-total').textContent = total;
    document.getElementById('q-score').textContent = state.score;
    document.getElementById('q-bar').style.width = (num / total * 100) + '%';
    document.getElementById('q-text').textContent = q.q;

    var optDiv = document.getElementById('q-options');
    optDiv.innerHTML = '';
    q.options.forEach(function(opt, i) {
      var btn = document.createElement('button');
      btn.className = 'quiz-opt-btn';
      btn.textContent = opt;
      btn.dataset.idx = i;
      btn.onclick = function() { selectAnswer(i, q); };
      optDiv.appendChild(btn);
    });

    var resBox = document.getElementById('q-result');
    resBox.style.display = 'none';
  }

  function selectAnswer(choiceIdx, q) {
    var opts = document.querySelectorAll('.quiz-opt-btn');
    opts.forEach(function(b) { b.disabled = true; });

    var labels = ['A','B','C','D'];
    var chosen = labels[choiceIdx];
    var correct = (q.answer || '').toUpperCase();
    var isCorrect = chosen === correct;

    if (typeof gtag === 'function') {
      gtag('event', 'quiz_answer', {
        question_no: state.idx + 1,
        question: q.q.slice(0, 100),
        correct: isCorrect ? 1 : 0
      });
    }

    if (isCorrect) {
      state.score++;
      opts[choiceIdx].classList.add('correct');
    } else {
      opts[choiceIdx].classList.add('wrong');
      var correctIdx = labels.indexOf(correct);
      if (correctIdx >= 0 && opts[correctIdx]) opts[correctIdx].classList.add('correct');
    }

    document.getElementById('q-score').textContent = state.score;
    document.getElementById('q-label').textContent = isCorrect ? '⭕ 正解！' : '❌ 不正解';
    document.getElementById('q-exp').textContent = q.explanation || '';

    var srcEl = document.getElementById('q-source');
    if (q.sourceUrl) {
      var isBlog = q.sourceUrl.indexOf('hinatazaka46.com') >= 0;
      var verb = isBlog ? 'を読む →' : 'を見る →';
      srcEl.href = q.sourceUrl;
      srcEl.textContent = (q.sourceTitle ? '「' + q.sourceTitle + '」' : '出典') + verb;
      srcEl.style.display = '';
    } else {
      srcEl.style.display = 'none';
    }

    var nextBtn = document.getElementById('q-next-btn');
    var isLast = state.idx >= state.questions.length - 1;
    nextBtn.textContent = isLast ? '結果を見る ✨' : '次の問題 →';

    document.getElementById('q-result').style.display = '';
  }

  window.nextQuestion = function() {
    state.idx++;
    if (state.idx >= state.questions.length) {
      showFinal();
    } else {
      renderQuestion();
    }
  };

  function showFinal() {
    var s = state.score;
    var t = state.questions.length;
    document.getElementById('r-score').textContent = s;
    document.getElementById('r-total').textContent = t;

    var msgs = [
      [t,       '🌟 全問正解！さとうゆクイズマスター！',   'さとうゆのことを知り尽くしてる…！すごい！'],
      [t * 0.8, '✨ すばらしい！',                         'さとうゆのことをよく知ってるんですね♪'],
      [t * 0.6, '💪 なかなか良い！',                       'もっとさとうゆを知ればパーフェクトも夢じゃない！'],
      [t * 0.4, '🌱 もう少し！',                           'さとうゆのことをもっと知って再挑戦しよう！'],
      [0,       '📖 さとうゆのことを知って再挑戦しよう！', '出演番組やブログでさとうゆのことを知ろう♪'],
    ];
    var msg = msgs[msgs.length - 1];
    for (var i = 0; i < msgs.length; i++) {
      if (s >= msgs[i][0]) { msg = msgs[i]; break; }
    }
    document.getElementById('r-msg').textContent = msg[1];
    document.getElementById('r-sub').textContent = msg[2];
    if (typeof gtag === 'function') {
      gtag('event', 'quiz_complete', { score: s, total: t });
    }
    showScreen('quiz-final');
  }
})();
<\/script>`;

  return buildPage(tpl, "さとうゆクイズ", "SATOYU QUIZ", "さとうゆ <em>クイズ</em>", `佐藤優羽さんの過去の出演番組や出演ライブ、ブログ等から出題！全${total}問からランダム5問に挑戦しよう`, body, "quiz.html");
}

// ── 自動集約: 各DBの新着をYu Newsへ追加 ──
async function syncToYuNews() {
  const sources = [
    { db: DB.blog,      platform: "Blog" },
    { db: DB.interview, platform: "インタビュー" },
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

  // ── 既存レコードのMedia同期（Blog/インタビュー/Lemino） ──
  // syncToYuNews新規追加時にMediaが未設定だったエントリをソースDBから遡って補完する
  console.log("  既存レコードのMedia同期中...");
  const mediaSyncSources = [
    { db: DB.blog,      platform: "Blog" },
    { db: DB.interview, platform: "インタビュー" },
    { db: DB.lemino,    platform: "Lemino" },
  ];
  for (const { db, platform } of mediaSyncSources) {
    if (!db) continue;
    const srcPages = await queryDB(db);
    const withMedia = srcPages.filter(p => getMedia(p));
    for (const page of withMedia) {
      const url   = getUrl(page);
      const media = getMedia(page);
      if (!url || !media) continue;
      try {
        const res = await notion.databases.query({
          database_id: DB.yuNews,
          filter: { property: "URL", url: { equals: url } },
        });
        for (const yuPage of res.results) {
          if (getMedia(yuPage)) continue; // 既にMediaあり → スキップ
          await notion.pages.update({
            page_id: yuPage.id,
            properties: { Media: { files: [{ name: "thumbnail", type: "external", external: { url: media } }] } },
          });
          console.log(`  ✅ Media更新: [${platform}] ${getText(page,"Name")}`);
          await new Promise(r => setTimeout(r, 400));
        }
      } catch(e) {
        console.error(`  ❌ Media更新失敗: ${getText(page,"Name")}`, e.message);
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

// ── DB_QUIZからquiz_questions.jsonを生成 ──
async function buildQuizJson() {
  if (!DB.quiz) { console.log("  DB_QUIZ未設定 → スキップ"); return; }
  const pages = await queryDB(DB.quiz);
  const questions = pages.map(p => ({
    q:           getText(p, "Name"),
    options: [
      getText(p, "OptionA"),
      getText(p, "OptionB"),
      getText(p, "OptionC"),
      getText(p, "OptionD"),
    ],
    answer:      p.properties["Answer"]?.select?.name || "A",
    explanation: getText(p, "Explanation"),
    sourceUrl:   p.properties["SourceUrl"]?.url || "",
    sourceTitle: getText(p, "SourceTitle"),
  }));
  fs.writeFileSync("quiz_questions.json", JSON.stringify(questions, null, 2), "utf-8");
  console.log(`  ✅ quiz_questions.json 生成完了（${questions.length}問）`);
}

// ── メイン ──
// ページ別エイリアス（node build.js index yunews のように指定可能）
const PAGE_ALIASES = {
  index:      ["index.html", "top.html"],
  yunews:     ["yunews.html"],
  committee:  ["committee.html"],
  activities: ["activities.html"],
  blog:       ["blog.html"],
  memberblog: ["member-blog.html"],
  interview:  ["interview.html"],
  x:          ["x.html"],
  tiktok:     ["tiktok.html"],
  youtube:    ["youtube.html"],
  lemino:     ["lemino.html"],
  history:    ["history.html"],
  quiz:       ["quiz.html"],
};

async function main() {
  const argPages = process.argv.slice(2);
  const isPartial = argPages.length > 0;
  const targetFiles = isPartial
    ? new Set(argPages.flatMap(a => PAGE_ALIASES[a] ?? []))
    : null;

  if (isPartial) {
    console.log(`📄 部分ビルド: ${[...targetFiles].join(", ")}`);
  } else {
    console.log("🔄 Yu Newsへ自動集約中...");
    await syncToYuNews();
    console.log("📝 クイズデータ生成中...");
    await buildQuizJson();
  }

  console.log("🏗️  HTMLビルド開始...");
  const pages = {
    "index.html":      { fn: buildIndex,     active: "INDEX" },
    "top.html":        { fn: buildIndex,     active: "INDEX" },
    "committee.html":  { fn: buildCommittee, active: "COMMITTEE" },
    "activities.html": { fn: buildActivities,active: "ACTIVITIES" },
    "yunews.html":     { fn: buildYuNews,    active: "YUNEWS" },
    "blog.html":        { fn: buildBlog,       active: "BLOG" },
    "member-blog.html": { fn: buildMemberBlog, active: "MEMBER_BLOG" },
    "interview.html":   { fn: buildInterview,  active: "INTERVIEW" },
    "x.html":          { fn: buildX,         active: "X" },
    "tiktok.html":     { fn: buildTiktok,    active: "TIKTOK" },
    "youtube.html":    { fn: buildYoutube,   active: "YOUTUBE" },
    "lemino.html":     { fn: buildLemino,    active: "LEMINO" },
    "history.html":   { fn: buildHistory,   active: "HISTORY" },
    "weekly.html":    { fn: buildWeekly,    active: "WEEKLY" },
    "quiz.html":       { fn: buildQuiz,      active: "QUIZ" },
  };

  for (const [filename, { fn, active }] of Object.entries(pages)) {
    if (targetFiles && !targetFiles.has(filename)) continue;
    const tpl = loadTemplate(active);
    const html = await fn(tpl);
    fs.writeFileSync(filename, html, "utf-8");
    console.log(`  ✅ ${filename} 生成完了`);
  }

  console.log(isPartial ? "✅ 部分ビルド完了！" : "🎉 全ページ生成完了！");
}

main().catch(console.error);
