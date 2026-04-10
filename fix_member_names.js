/**
 * fix_member_names.js
 *
 * DB_MENTIONSのMemberプロパティが "ctXX" になっているレコードを、
 * メンバーのブログページから取得した正しい名前に更新する。
 *
 * 実行方法：
 *   $env:NOTION_TOKEN="xxx"; $env:DB_MENTIONS="xxx"; node fix_member_names.js
 *
 * オプション：
 *   --dry-run   Notionへの書き込みを行わず変更内容のみ表示
 */

const { Client } = require("@notionhq/client");

const notion    = new Client({ auth: process.env.NOTION_TOKEN });
const DB_MENTIONS = process.env.DB_MENTIONS;
const BASE_URL  = "https://www.hinatazaka46.com";
const HEADERS   = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

const args    = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  return res.text();
}

function extractMemberName(html) {
  // "松尾 桜公式ブログ | 日向坂46公式サイト" → "松尾桜"
  const m1 = html.match(/<title[^>]*>\s*([^|<\n]{1,20})(?:公式ブログ|のブログ)/);
  if (m1) return m1[1].replace(/\s/g, "").trim();
  const m2 = html.match(/class="[^"]*(?:l-main-sns__name|c-member__name|p-member__name)[^"]*"[^>]*>[\s\S]*?<[^>]+>([^<\n]{1,20})</);
  if (m2) return m2[1].replace(/\s/g, "").trim();
  return null;
}

// ctXX形式かどうか判定
function isCtFallback(name) {
  return /^ct\d+$/.test(name);
}

// DB_MENTIONSの全レコードを取得
async function queryAll() {
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_MENTIONS,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function main() {
  if (!DB_MENTIONS) { console.error("DB_MENTIONS が未設定です"); process.exit(1); }

  console.log("🔧 Memberプロパティ修正スクリプト");
  console.log("=".repeat(40));
  if (DRY_RUN) console.log("⚠️  DRY RUN モード（書き込みなし）\n");

  console.log("📋 DB_MENTIONSの全レコードを取得中...");
  const pages = await queryAll();
  console.log(`  ${pages.length}件取得\n`);

  // Memberが "ctXX" のレコードを抽出
  const targets = pages.filter(p => {
    const member = p.properties["Member"]?.rich_text?.[0]?.plain_text || "";
    return isCtFallback(member);
  });

  if (!targets.length) {
    console.log("✅ 修正が必要なレコードはありません。");
    return;
  }

  console.log(`修正対象: ${targets.length}件\n`);

  // ct番号ごとにメンバー名をキャッシュ（同じctへの重複リクエストを防ぐ）
  const nameCache = new Map();

  async function getMemberName(ct) {
    if (nameCache.has(ct)) return nameCache.get(ct);
    const url = `${BASE_URL}/s/official/diary/member/list?ima=0000&ct=${ct}`;
    try {
      const html = await fetchPage(url);
      const name = html ? extractMemberName(html) : null;
      nameCache.set(ct, name);
      return name;
    } catch (e) {
      console.error(`  ct=${ct} 取得失敗: ${e.message}`);
      return null;
    }
  }

  let updated = 0;
  let failed  = 0;
  let notFound = 0;

  for (const page of targets) {
    const currentMember = page.properties["Member"]?.rich_text?.[0]?.plain_text || "";
    const ct = page.properties["MemberCt"]?.number;
    const title = page.properties["Name"]?.title?.[0]?.plain_text || "(タイトルなし)";

    if (ct == null) {
      console.log(`  ⚠️  スキップ（MemberCtなし）: ${title}`);
      notFound++;
      continue;
    }

    const newName = await getMemberName(ct);
    if (!newName) {
      console.log(`  ⚠️  名前取得失敗（ct=${ct}）: ${title}`);
      notFound++;
      continue;
    }

    console.log(`  ${currentMember} → ${newName} : ${title}`);

    if (!DRY_RUN) {
      try {
        await notion.pages.update({
          page_id: page.id,
          properties: {
            Member: { rich_text: [{ text: { content: newName } }] },
          },
        });
        updated++;
      } catch (e) {
        console.error(`    ❌ 更新失敗: ${e.message}`);
        failed++;
      }
      await sleep(350); // Notion APIレート制限対策
    } else {
      updated++;
    }
  }

  console.log("\n" + "=".repeat(40));
  console.log(`🎉 完了: 更新 ${updated}件 / 名前取得失敗 ${notFound}件 / エラー ${failed}件`);
}

main().catch(console.error);
