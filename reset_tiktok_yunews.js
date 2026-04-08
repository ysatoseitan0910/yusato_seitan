// DB_YU_NEWS の TikTok レコードをすべてアーカイブし、DB_TIKTOK から再追加するスクリプト
// 実行方法:
//   $env:NOTION_TOKEN="xxx"; $env:DB_YU_NEWS="xxx"; $env:DB_TIKTOK="xxx"; node reset_tiktok_yunews.js

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_YU_NEWS = process.env.DB_YU_NEWS;
const DB_TIKTOK  = process.env.DB_TIKTOK;

async function queryAll(dbId, filter) {
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      filter,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

function getText(page, key) {
  const p = page.properties[key];
  if (p?.title?.length)     return p.title.map(t => t.plain_text).join("");
  if (p?.rich_text?.length) return p.rich_text.map(t => t.plain_text).join("");
  return "";
}

function getMedia(page) {
  const files = page.properties["Media"]?.files || [];
  if (!files.length) return "";
  const f = files[0];
  return f.type === "external" ? f.external.url : f.file?.url || "";
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

// ── Step 1: DB_YU_NEWS の TikTok レコードをアーカイブ ──
async function archiveTiktokFromYuNews() {
  console.log("🗑️  DB_YU_NEWS の TikTok レコードを取得中...");
  const pages = await queryAll(DB_YU_NEWS, {
    property: "Platform",
    multi_select: { contains: "TikTok" },
  });
  console.log(`  ${pages.length}件 見つかりました`);
  if (pages.length === 0) return;

  let success = 0, fail = 0;
  for (const page of pages) {
    const name = getText(page, "Name") || "(無題)";
    process.stdout.write(`  アーカイブ: ${name.slice(0, 50)} ... `);
    try {
      await notion.pages.update({ page_id: page.id, archived: true });
      console.log("✅");
      success++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  console.log(`  完了: ${success}件削除 / ${fail}件失敗\n`);
}

// ── Step 2: DB_TIKTOK の全レコードを DB_YU_NEWS に追加 ──
async function addTiktokToYuNews() {
  console.log("➕ DB_TIKTOK から DB_YU_NEWS へ再追加中...");
  const pages = await queryAll(DB_TIKTOK);
  const published = pages.filter(p => {
    const pub = p.properties["Published"];
    if (!pub) return true;
    return pub.checkbox !== false;
  });
  console.log(`  DB_TIKTOK: ${pages.length}件中 公開: ${published.length}件`);

  let success = 0, fail = 0;
  for (const page of published) {
    const url  = page.properties["URL"]?.url || "";
    const name = getText(page, "Name");
    const date = page.properties["Date"]?.date?.start || "";
    const srcDesc = getText(page, "Description");
    if (!url) { console.log(`  ⚠️  URLなし: ${name}`); continue; }

    const cleanUrl = url.split("?")[0];
    const desc = srcDesc || `／\n📢 TikTok公開│ ˙ᵕ˙ )꜆\n＼\n\n佐藤優羽 さん登場のtiktok動画が公開されました！\nぜひご覧ください🪽\n\n${cleanUrl}`;

    // oEmbedから新鮮なサムネイルURLを取得（保存済みURLは期限切れの場合があるため）
    const media = await fetchOembedThumbnail(url) || getMedia(page);

    const props = {
      Name:        { title: [{ text: { content: name } }] },
      URL:         { url },
      Date:        date ? { date: { start: date } } : undefined,
      Description: { rich_text: [{ text: { content: desc } }] },
      Platform:    { multi_select: [{ name: "TikTok" }] },
      Published:   { checkbox: true },
    };
    if (media) props.Media = { files: [{ name: "thumbnail", type: "external", external: { url: media } }] };

    process.stdout.write(`  追加: ${name.slice(0, 50)} ... `);
    try {
      await notion.pages.create({ parent: { database_id: DB_YU_NEWS }, properties: props });
      console.log("✅");
      success++;
    } catch (e) {
      if (media && e.code === "validation_error" && e.message.includes("Media")) {
        delete props.Media;
        try {
          await notion.pages.create({ parent: { database_id: DB_YU_NEWS }, properties: props });
          console.log("✅ (Media未設定)");
          success++;
        } catch (e2) {
          console.log(`❌ ${e2.message}`);
          fail++;
        }
      } else {
        console.log(`❌ ${e.message}`);
        fail++;
      }
    }
    await new Promise(r => setTimeout(r, 400));
  }
  console.log(`  完了: ${success}件追加 / ${fail}件失敗`);
}

async function main() {
  if (!DB_YU_NEWS) { console.error("DB_YU_NEWS が未設定です"); process.exit(1); }
  if (!DB_TIKTOK)  { console.error("DB_TIKTOK が未設定です");  process.exit(1); }

  await archiveTiktokFromYuNews();
  await addTiktokToYuNews();
  console.log("\n🎉 完了");
}

main().catch(console.error);
