// Notion DB の Media プロパティに残っている GitHub Pages URL を satoyu.info に一括置換する
//
// 実行方法:
//   $env:NOTION_TOKEN="xxx"; $env:DB_ACTIVITIES="xxx"; $env:DB_COMMITTEE_NEWS="xxx"; node migrate_media_urls.js

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const OLD_BASE = "https://ysatoseitan0910.github.io/yusato_seitan";
const NEW_BASE = "https://satoyu.info";

const TARGETS = [
  { dbId: process.env.DB_ACTIVITIES,     label: "活動報告" },
  { dbId: process.env.DB_COMMITTEE_NEWS, label: "委員会News" },
];

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

function getName(page) {
  const p = page.properties["Name"];
  if (p?.title?.length)     return p.title.map(t => t.plain_text).join("");
  if (p?.rich_text?.length) return p.rich_text.map(t => t.plain_text).join("");
  return "(無題)";
}

async function processDB({ dbId, label }) {
  if (!dbId) { console.log(`⚠️  ${label}: DB未設定 → スキップ`); return; }

  console.log(`\n📂 ${label}を処理中...`);
  const pages = await queryAll(dbId);
  console.log(`  ${pages.length}件取得`);

  const targets = pages.filter(p => {
    const files = p.properties["Media"]?.files || [];
    if (!files.length) return false;
    const url = files[0].type === "external" ? files[0].external?.url : files[0].file?.url;
    return url && url.startsWith(OLD_BASE);
  });

  console.log(`  うちGitHub Pages URL: ${targets.length}件\n`);

  let updated = 0, failed = 0;

  for (const page of targets) {
    const files = page.properties["Media"].files;
    const oldUrl = files[0].type === "external" ? files[0].external.url : files[0].file?.url;
    const newUrl = NEW_BASE + oldUrl.slice(OLD_BASE.length);
    const name = getName(page);

    process.stdout.write(`  🔄 ${name} ... `);
    try {
      await notion.pages.update({
        page_id: page.id,
        properties: {
          Media: {
            files: [{ name: "image", type: "external", external: { url: newUrl } }],
          },
        },
      });
      console.log(`✅ ${newUrl.split("/").pop()}`);
      updated++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      failed++;
    }

    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`${label} 完了: 更新 ${updated}件 / 失敗 ${failed}件`);
}

async function main() {
  console.log("🔗 Notion Media URL 移行（GitHub Pages → satoyu.info）");
  console.log("==========================================================");
  console.log(`  ${OLD_BASE}`);
  console.log(`  → ${NEW_BASE}\n`);

  for (const target of TARGETS) {
    await processDB(target);
  }

  console.log("\n🎉 完了！次のビルドからsatoyu.infoの画像URLが使われます。");
}

main().catch(console.error);
