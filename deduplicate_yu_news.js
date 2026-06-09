// DB_YU_NEWSの重複レコードを削除するスクリプト
// URLが同じレコードのうち、最初に作成されたものを残し残りをアーカイブ（削除）する
// 実行方法:
//   NOTION_TOKEN=xxx DB_YU_NEWS=xxx node deduplicate_yu_news.js

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_YU_NEWS = process.env.DB_YU_NEWS;

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

async function main() {
  if (!DB_YU_NEWS) { console.error("DB_YU_NEWS が未設定です"); process.exit(1); }

  console.log("🔍 DB_YU_NEWS の全レコードを取得中...");
  const all = await queryAll(DB_YU_NEWS);
  console.log(`  ${all.length}件取得\n`);

  // URLごとにグループ化
  const byUrl = new Map();
  let noUrl = 0;
  for (const p of all) {
    const url = p.properties["URL"]?.url || "";
    if (!url) { noUrl++; continue; }
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(p);
  }

  const dupGroups = [...byUrl.values()].filter(g => g.length > 1);
  console.log(`URL重複グループ: ${dupGroups.length}件 (URLなし: ${noUrl}件)\n`);

  if (dupGroups.length === 0) {
    console.log("✅ 重複なし");
    return;
  }

  let totalDel = 0, fail = 0;
  for (const group of dupGroups) {
    // created_time昇順でソート → 最古を残す
    group.sort((a, b) => new Date(a.created_time) - new Date(b.created_time));
    const keep = group[0];
    const remove = group.slice(1);

    const url = keep.properties["URL"]?.url || "";
    const name = keep.properties["Name"]?.title?.map(t => t.plain_text).join("") || "(無題)";
    console.log(`  [保持] ${name.slice(0, 40)} | ${url.slice(0, 60)}`);

    for (const p of remove) {
      process.stdout.write(`    → 削除: ${p.id} ... `);
      try {
        await notion.pages.update({ page_id: p.id, archived: true });
        console.log("✅");
        totalDel++;
      } catch (e) {
        console.log(`❌ ${e.message}`);
        fail++;
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\n完了: 削除 ${totalDel}件 / 失敗 ${fail}件`);
}

main().catch(console.error);
