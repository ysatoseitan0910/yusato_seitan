/**
 * update_notion_media.js
 *
 * download_media.js が生成した download_map.csv を読み込み、
 * NotionのMediaプロパティを GitHub Pages の外部URLに更新する。
 *
 * 実行前提：
 *   - download_media.js を実行済み
 *   - images/ をGitHubにpush済み（GitHub Pages上でURLが有効になっている）
 *
 * 実行方法：
 *   $env:NOTION_TOKEN="xxx"; $env:DB_ACTIVITIES="xxx"; $env:DB_COMMITTEE_NEWS="xxx"; node update_notion_media.js
 *
 * ファイルをリネームした場合：
 *   download_map.csv の local_file 列を新しいファイル名に書き換えてから実行。
 *   github_url 列も対応するURLに書き換えること。
 */

const { Client } = require("@notionhq/client");
const fs = require("fs");
const path = require("path");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const SITE_URL = "https://ysatoseitan0910.github.io/yusato_seitan";

const TARGETS = [
  { dir: "images/activities", label: "活動報告" },
  { dir: "images/committee",  label: "委員会News" },
];

function parseCSV(content) {
  const lines = content.replace(/^\uFEFF/, "").split("\n").filter(l => l.trim());
  const header = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    // CSVのダブルクォート・カンマを正しくパース
    const values = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === "," && !inQ) {
        values.push(cur); cur = "";
      } else {
        cur += c;
      }
    }
    values.push(cur);
    return Object.fromEntries(header.map((h, i) => [h, values[i] ?? ""]));
  });
}

async function updateMedia(pageId, filename, githubUrl) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Media: {
        files: [{
          type: "external",
          name: filename,
          external: { url: githubUrl },
        }],
      },
    },
  });
}

async function processDir({ dir, label }) {
  const csvPath = path.join(dir, "download_map.csv");
  if (!fs.existsSync(csvPath)) {
    console.log(`⚠️  ${label}：${csvPath} が見つかりません。download_media.js を先に実行してください。`);
    return;
  }

  const rows = parseCSV(fs.readFileSync(csvPath, "utf-8"));
  const targets = rows.filter(r => r.page_id && r.github_url && !r.github_url.startsWith("ERROR"));

  console.log(`\n📂 ${label}（${targets.length}件を更新）`);

  let updated = 0;
  let skipped = 0;
  let failed  = 0;

  for (const row of targets) {
    const { page_id, name, local_file, github_url } = row;

    // ファイルがローカルに存在するか確認（リネームされて消えていないかチェック）
    const localPath = path.join(dir, local_file);
    if (!fs.existsSync(localPath)) {
      console.log(`  ⚠️  スキップ（ローカルファイル未確認）: ${local_file}`);
      console.log(`       → リネームした場合はCSVの local_file と github_url を更新してください`);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`  🔄 更新中: ${name || page_id.slice(0, 8)} → ${local_file} ... `);
      await updateMedia(page_id, local_file, github_url);
      console.log("完了");
      updated++;
    } catch (e) {
      console.log(`失敗: ${e.message}`);
      failed++;
    }

    // Notion API レート制限対策
    await new Promise(r => setTimeout(r, 350));
  }

  console.log(`  ✅ ${updated}件更新、${skipped}件スキップ、${failed}件失敗`);
}

async function main() {
  console.log("🔗 Notion Media 外部URL一括更新");
  console.log("==================================");
  console.log("前提: images/ を GitHub に push 済みであること\n");

  for (const target of TARGETS) {
    await processDir(target);
  }

  console.log("\n🎉 完了！");
  console.log("次のGitHub Actionsビルド後、サイトに反映されます。");
}

main().catch(console.error);
