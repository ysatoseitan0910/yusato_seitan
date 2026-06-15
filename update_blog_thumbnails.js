// ブログDBのMediaプロパティにサムネイル画像を追加するスクリプト
// Mediaが未設定のエントリのURLからページ内最初の画像を取得してNotionに書き込む
//
// 実行方法:
//   NOTION_TOKEN=xxx DB_BLOG=xxx node update_blog_thumbnails.js

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_BLOG        = process.env.DB_BLOG;
const DB_MEMBER_BLOG = process.env.DB_MEMBER_BLOG;

async function fetchFirstImage(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // ブログ本文の画像を取得（diary / moblog パスを含むもの）
    const cdnMatch = html.match(/https:\/\/cdn\.hinatazaka46\.com\/files\/[^"'\s)>]*(?:diary|moblog)[^"'\s)>]*\.(?:jpg|jpeg|png|webp)/i);
    if (cdnMatch) return cdnMatch[0];

    // フォールバック: og:image
    const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    if (ogMatch) return ogMatch[1];

    return null;
  } catch (e) {
    console.error(`  画像取得失敗 (${url}): ${e.message}`);
    return null;
  }
}

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

async function processDB(dbId, label) {
  if (!dbId) { console.log(`  ${label}: DB未設定 → スキップ`); return; }

  console.log(`📋 ${label}を取得中...`);
  const pages = await queryAll(dbId);
  console.log(`  ${pages.length}件取得`);

  const targets = pages.filter(p => {
    const files = p.properties["Media"]?.files || [];
    return files.length === 0;
  });
  console.log(`  うちMedia未設定: ${targets.length}件\n`);

  let success = 0, skip = 0, fail = 0;

  for (const page of targets) {
    const url = page.properties["URL"]?.url || "";
    const name = page.properties["Name"]?.title?.[0]?.plain_text
              || page.properties["Name"]?.rich_text?.[0]?.plain_text
              || "(無題)";

    if (!url) { console.log(`  ⚠️  URLなし: ${name}`); skip++; continue; }

    process.stdout.write(`  🔍 ${name} ... `);
    const imgUrl = await fetchFirstImage(url);

    if (!imgUrl) { console.log("画像なし"); skip++; continue; }

    try {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Media: {
            files: [{ name: "thumbnail", type: "external", external: { url: imgUrl } }],
          },
        },
      });
      console.log(`✅ ${imgUrl.split("/").pop()}`);
      success++;
    } catch (e) {
      console.log(`❌ Notion更新失敗: ${e.message}`);
      fail++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`${label} 完了: 成功 ${success}件 / スキップ ${skip}件 / 失敗 ${fail}件\n`);
}

async function main() {
  if (!DB_BLOG && !DB_MEMBER_BLOG) { console.error("DB_BLOG も DB_MEMBER_BLOG も未設定です"); process.exit(1); }
  await processDB(DB_BLOG, "ブログDB");
  await processDB(DB_MEMBER_BLOG, "他メンバーブログDB");
}

main().catch(console.error);
