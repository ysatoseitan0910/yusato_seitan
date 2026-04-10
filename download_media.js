const { Client } = require("@notionhq/client");
const fs = require("fs");
const https = require("https");
const http = require("http");
const path = require("path");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const SITE_URL = "https://ysatoseitan0910.github.io/yusato_seitan";

const TARGETS = [
  {
    dbId: process.env.DB_ACTIVITIES,
    label: "活動報告",
    dir: "images/activities",
  },
  {
    dbId: process.env.DB_COMMITTEE_NEWS,
    label: "委員会News",
    dir: "images/committee",
  },
];

function getDate(page) {
  return page.properties["Date"]?.date?.start || "";
}

function getName(page) {
  const p = page.properties["Name"];
  if (p?.title?.length) return p.title.map(t => t.plain_text).join("");
  if (p?.rich_text?.length) return p.rich_text.map(t => t.plain_text).join("");
  return "";
}

function getMediaFile(page) {
  const files = page.properties["Media"]?.files || [];
  if (!files.length) return null;
  const f = files[0];
  return {
    url: f.type === "external" ? f.external.url : f.file?.url || "",
    type: f.type, // "file" = Notion内部（期限切れあり）、"external" = 外部URL
  };
}

function guessExt(url) {
  const match = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  return match ? `.${match[1].toLowerCase().replace("jpeg", "jpg")}` : ".jpg";
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(dest);
    client.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", err => {
      file.close();
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      reject(err);
    });
  });
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

async function processDB({ dbId, label, dir }) {
  if (!dbId) {
    console.log(`⚠️  ${label}：DB IDが未設定のためスキップ`);
    return [];
  }

  console.log(`\n📂 ${label} を処理中...`);
  fs.mkdirSync(dir, { recursive: true });

  const pages = await queryAll(dbId);
  console.log(`  ${pages.length}件取得`);

  const csvRows = [["page_id", "name", "date", "type", "original_url", "local_file", "github_url"]];
  let downloaded = 0;
  let skipped = 0;
  let counters = {};

  for (const page of pages) {
    const media = getMediaFile(page);
    if (!media || !media.url) {
      skipped++;
      continue;
    }

    const date = getDate(page).slice(0, 10) || "0000-00-00";
    const ext = guessExt(media.url);

    // 連番でファイル名を生成（後でリネーム想定）
    counters[date] = (counters[date] || 0) + 1;
    const seq = String(counters[date]).padStart(3, "0");
    const filename = `${date}_${seq}${ext}`;
    const dest = path.join(dir, filename);
    const githubUrl = `${SITE_URL}/${dir}/${filename}`;

    const name = getName(page);

    if (fs.existsSync(dest)) {
      console.log(`  ⏭️  スキップ（既存）: ${filename}`);
      csvRows.push([page.id, name, date, media.type, media.url, filename, githubUrl]);
      skipped++;
      continue;
    }

    try {
      process.stdout.write(`  ⬇️  ダウンロード中: ${filename} ... `);
      await downloadFile(media.url, dest);
      const size = (fs.statSync(dest).size / 1024).toFixed(0);
      console.log(`完了 (${size}KB)`);
      csvRows.push([page.id, name, date, media.type, media.url, filename, githubUrl]);
      downloaded++;
    } catch (e) {
      console.log(`失敗: ${e.message}`);
      csvRows.push([page.id, name, date, media.type, media.url, `ERROR: ${e.message}`, ""]);
    }
  }

  // CSV出力
  const csvPath = `${dir}/download_map.csv`;
  const csvContent = csvRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  fs.writeFileSync(csvPath, "\uFEFF" + csvContent, "utf-8"); // BOM付きUTF-8（Excel対応）

  console.log(`  ✅ ${downloaded}件ダウンロード、${skipped}件スキップ`);
  console.log(`  📄 対応表: ${csvPath}`);

  return csvRows;
}

async function main() {
  console.log("🖼️  Notionメディア画像 一括ダウンロード");
  console.log("==========================================");
  console.log("※ Notion内部ファイルのURLは1時間で期限切れになります。");
  console.log("  ダウンロード後、images/をGitHubにpushしてください。\n");

  for (const target of TARGETS) {
    await processDB(target);
  }

  console.log("\n🎉 完了！");
  console.log("\n次のステップ:");
  console.log("  1. images/ 内のファイルを確認・リネーム（YYYY-MM-DD_キーワード.jpg形式）");
  console.log("  2. git add images/ && git commit && git push");
  console.log("  3. download_map.csv を参照してNotionのMediaを外部URLに更新");
}

main().catch(console.error);
