// DB_YU_NEWSのYouTube・LeminoエントリにMediaサムネイルを追加するスクリプト
//
// 実行方法:
//   NOTION_TOKEN=xxx DB_YU_NEWS=xxx node update_media_thumbnails.js

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_YU_NEWS = process.env.DB_YU_NEWS;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// ── サムネイル取得 ──

function getYoutubeThumbnail(url) {
  // youtube.com/watch?v=ID or youtu.be/ID
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (!m) return null;
  return `https://img.youtube.com/vi/${m[1]}/maxresdefault.jpg`;
}

async function getLeminoThumbnail(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    // og:image を探す
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

function getPlatform(page) {
  const p = page.properties["Platform"];
  if (p?.select?.name) return p.select.name;
  if (p?.multi_select?.length) return p.multi_select[0].name;
  return "";
}

function getMedia(page) {
  const files = page.properties["Media"]?.files || [];
  return files.length > 0;
}

// ── メイン ──

async function main() {
  if (!DB_YU_NEWS) { console.error("DB_YU_NEWS が未設定です"); process.exit(1); }

  console.log("📋 DB_YU_NEWSを取得中...");
  const pages = await queryAll(DB_YU_NEWS);
  console.log(`  ${pages.length}件取得`);

  // YouTube・LeminoでMediaが未設定のもの
  const targets = pages.filter(p => {
    const platform = getPlatform(p);
    return (platform === "YouTube" || platform === "Lemino") && !getMedia(p);
  });
  console.log(`  うちYouTube/LeminoでMedia未設定: ${targets.length}件\n`);

  let success = 0, skip = 0, fail = 0;

  for (const page of targets) {
    const url      = page.properties["URL"]?.url || "";
    const platform = getPlatform(page);
    const name     = page.properties["Name"]?.title?.[0]?.plain_text
                  || page.properties["Name"]?.rich_text?.[0]?.plain_text
                  || "(無題)";

    if (!url) { console.log(`  ⚠️  URLなし: ${name}`); skip++; continue; }

    process.stdout.write(`  [${platform}] ${name} ... `);

    let imgUrl = null;
    if (platform === "YouTube") {
      imgUrl = getYoutubeThumbnail(url);
      if (!imgUrl) { console.log("動画ID取得失敗"); skip++; continue; }
    } else if (platform === "Lemino") {
      imgUrl = await getLeminoThumbnail(url);
      if (!imgUrl) { console.log("サムネイルなし"); skip++; continue; }
    }

    try {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Media: {
            files: [{ name: "thumbnail", type: "external", external: { url: imgUrl } }],
          },
        },
      });
      console.log(`✅ ${imgUrl.split("/").pop().slice(0, 60)}`);
      success++;
    } catch (e) {
      console.log(`❌ Notion更新失敗: ${e.message}`);
      fail++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n完了: 成功 ${success}件 / スキップ ${skip}件 / 失敗 ${fail}件`);
}

main().catch(console.error);
