// YouTube・LeminoエントリにMediaサムネイルを追加するスクリプト
// 対象DB: DB_YOUTUBE, DB_LEMINO, DB_YU_NEWS (YouTube/Lemino Platform のもの)
//
// 実行方法:
//   NOTION_TOKEN=xxx DB_YOUTUBE=xxx DB_LEMINO=xxx DB_YU_NEWS=xxx node update_media_thumbnails.js

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// ── サムネイル取得 ──

function getYoutubeThumbnail(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return null;
  return `https://img.youtube.com/vi/${m[1]}/maxresdefault.jpg`;
}

async function getLeminoThumbnail(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']+)[\"']/i)
           || html.match(/<meta[^>]+content=[\"']([^\"']+)[\"'][^>]+property=[\"']og:image[\"']/i);
    return m ? m[1] : null;
  } catch (e) {
    console.error(`  Lemino取得失敗 (${url}): ${e.message}`);
    return null;
  }
}

// ── Notion ──

async function queryAll(dbId) {
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function getPlatforms(page) {
  const p = page.properties["Platform"];
  if (p?.select?.name) return [p.select.name];
  if (p?.multi_select?.length) return p.multi_select.map(s => s.name);
  return [];
}

function hasMedia(page) {
  return (page.properties["Media"]?.files || []).length > 0;
}

function getName(page) {
  return page.properties["Name"]?.title?.map(t => t.plain_text).join("")
      || page.properties["Name"]?.rich_text?.map(t => t.plain_text).join("")
      || "(無題)";
}

async function updateMedia(page, imgUrl, label) {
  const name = getName(page);
  process.stdout.write(`  ${label} ${name.slice(0, 40)} ... `);
  try {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        Media: { files: [{ name: "thumbnail", type: "external", external: { url: imgUrl } }] },
      },
    });
    console.log(`✅ ${imgUrl.split("/").pop().slice(0, 60)}`);
    return true;
  } catch (e) {
    console.log(`❌ ${e.message}`);
    return false;
  }
}

// ── DB別処理 ──

async function processYoutubeDB(dbId) {
  if (!dbId) return;
  console.log("\n📺 DB_YOUTUBE を処理中...");
  const pages = await queryAll(dbId);
  const targets = pages.filter(p => !hasMedia(p));
  console.log(`  ${pages.length}件中 Media未設定: ${targets.length}件`);

  let success = 0, skip = 0, fail = 0;
  for (const page of targets) {
    const url = page.properties["URL"]?.url || "";
    if (!url) { console.log(`  ⚠️  URLなし: ${getName(page)}`); skip++; continue; }
    const imgUrl = getYoutubeThumbnail(url);
    if (!imgUrl) { console.log(`  ⚠️  動画ID取得失敗: ${url}`); skip++; continue; }
    const ok = await updateMedia(page, imgUrl, "[YouTube]");
    ok ? success++ : fail++;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`  完了: 追加 ${success}件 / スキップ ${skip}件 / 失敗 ${fail}件`);
}

async function processLeminoDB(dbId) {
  if (!dbId) return;
  console.log("\n🎬 DB_LEMINO を処理中...");
  const pages = await queryAll(dbId);
  const targets = pages.filter(p => !hasMedia(p));
  console.log(`  ${pages.length}件中 Media未設定: ${targets.length}件`);

  let success = 0, skip = 0, fail = 0;
  for (const page of targets) {
    const url = page.properties["URL"]?.url || "";
    if (!url) { console.log(`  ⚠️  URLなし: ${getName(page)}`); skip++; continue; }
    const imgUrl = await getLeminoThumbnail(url);
    if (!imgUrl) { console.log(`  ⚠️  サムネイルなし: ${getName(page).slice(0, 40)}`); skip++; continue; }
    const ok = await updateMedia(page, imgUrl, "[Lemino]");
    ok ? success++ : fail++;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`  完了: 追加 ${success}件 / スキップ ${skip}件 / 失敗 ${fail}件`);
}

async function processYuNewsDB(dbId) {
  if (!dbId) return;
  console.log("\n📋 DB_YU_NEWS (YouTube/Lemino) を処理中...");
  const pages = await queryAll(dbId);
  const targets = pages.filter(p => {
    const platforms = getPlatforms(p).map(s => s.toLowerCase());
    return !hasMedia(p) && (platforms.includes("youtube") || platforms.includes("lemino"));
  });
  console.log(`  ${pages.length}件中 YouTube/LeminoでMedia未設定: ${targets.length}件`);

  let success = 0, skip = 0, fail = 0;
  for (const page of targets) {
    const url       = page.properties["URL"]?.url || "";
    const platforms = getPlatforms(page).map(s => s.toLowerCase());
    if (!url) { console.log(`  ⚠️  URLなし: ${getName(page)}`); skip++; continue; }

    let imgUrl = null;
    if (platforms.includes("youtube")) {
      imgUrl = getYoutubeThumbnail(url);
      if (!imgUrl) { console.log(`  ⚠️  動画ID取得失敗: ${url}`); skip++; continue; }
    } else {
      imgUrl = await getLeminoThumbnail(url);
      if (!imgUrl) { console.log(`  ⚠️  サムネイルなし: ${getName(page).slice(0, 40)}`); skip++; continue; }
    }

    const label = platforms.includes("youtube") ? "[YouTube]" : "[Lemino]";
    const ok = await updateMedia(page, imgUrl, label);
    ok ? success++ : fail++;
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`  完了: 追加 ${success}件 / スキップ ${skip}件 / 失敗 ${fail}件`);
}

// ── メイン ──

async function main() {
  await processYoutubeDB(process.env.DB_YOUTUBE);
  await processLeminoDB(process.env.DB_LEMINO);
  await processYuNewsDB(process.env.DB_YU_NEWS);
}

main().catch(console.error);
