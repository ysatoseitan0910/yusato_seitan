/**
 * scrape_member_mentions.js
 *
 * 日向坂46メンバー（ct=1〜46、佐藤優羽さん除く）のブログ本文を取得し、
 * 佐藤優羽さんへの言及をNotionDBに保存する。
 *
 * Notion DBに必要なプロパティ：
 *   Name      (タイトル)         : ブログ記事タイトル
 *   Date      (日付)             : 投稿日
 *   URL       (URL)              : ブログ記事URL
 *   Member    (テキスト)         : メンバー名
 *   MemberCt  (数値)             : メンバーct番号
 *   Keywords  (マルチセレクト)   : マッチしたキーワード
 *   Excerpt   (テキスト)         : キーワード周辺の抜粋
 *   Published (チェックボックス) : true固定
 *
 * 実行方法：
 *   $env:NOTION_TOKEN="xxx"; $env:DB_MENTIONS="xxx"; node scrape_member_mentions.js
 *
 * オプション：
 *   --dry-run   Notionへの書き込みを行わず結果のみ表示
 *   --ct=N      特定のct番号のメンバーのみ処理（テスト用）
 */

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_MENTIONS = process.env.DB_MENTIONS;

const BASE_URL   = "https://www.hinatazaka46.com";
const HEADERS    = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
const KEYWORDS   = ["佐藤優羽", "優羽ちゃん", "ゆうちゃん", "優羽"];
const CUTOFF_DATE = "2025-04-01";
const CUTOFF_DY   = 202504; // YYYYMM形式
const YU_CT       = 42;
const CT_MIN      = 1;
const CT_MAX      = 46;

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");
const specificCt = args.find(a => a.startsWith("--ct="));
const ONLY_CT  = specificCt ? parseInt(specificCt.split("=")[1]) : null;

// ── ユーティリティ ──

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function prevDy(dy) {
  const year  = Math.floor(dy / 100);
  const month = dy % 100;
  return month === 1 ? (year - 1) * 100 + 12 : dy - 1;
}

function currentDy() {
  const now = new Date();
  return now.getFullYear() * 100 + (now.getMonth() + 1);
}

// ── HTTP ──

async function fetchPage(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === retries) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

// ── HTML パース ──

function extractMemberName(html) {
  // ページタイトル: "○○のブログ | 日向坂46公式サイト"
  const m1 = html.match(/<title[^>]*>\s*([^|<\n]{1,20})(?:のブログ)/);
  if (m1) return m1[1].trim();
  // メンバー名要素
  const m2 = html.match(/class="[^"]*(?:l-main-sns__name|c-member__name|p-member__name)[^"]*"[^>]*>[\s\S]*?<[^>]+>([^<\n]{1,20})</);
  if (m2) return m2[1].trim();
  return null;
}

function parseArticles(html) {
  const urlRe = /href="(\/s\/official\/diary\/detail\/(\d+)[^"]*)"/g;
  const urls  = [];
  let um;
  while ((um = urlRe.exec(html)) !== null) {
    urls.push(BASE_URL + `/s/official/diary/detail/${um[2]}?ima=0000`);
  }

  const titleRe = /class="c-blog-article__title"[^>]*>\s*([\s\S]*?)\s*<\/div>/g;
  const titles  = [];
  let tm;
  while ((tm = titleRe.exec(html)) !== null) {
    titles.push(tm[1].replace(/<[^>]+>/g, "").trim());
  }

  const dateRe = /class="c-blog-article__date"[^>]*>\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/g;
  const dates  = [];
  let dm;
  while ((dm = dateRe.exec(html)) !== null) {
    dates.push(`${dm[1]}-${dm[2].padStart(2,"0")}-${dm[3].padStart(2,"0")}`);
  }

  const seen = new Set();
  const articles = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (seen.has(url)) continue;
    seen.add(url);
    articles.push({ url, title: titles[i] || "", date: dates[i] || "" });
  }
  return articles.filter(a => a.title);
}

function extractBlogContent(html) {
  // ブログ本文を複数のパターンで試みる
  const patterns = [
    /class="c-blog-article__text"[^>]*>([\s\S]*?)<\/div>/,
    /class="p-blog-article__text"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*article[_-]text[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    /class="[^"]*diary[_-]text[^"]*"[^>]*>([\s\S]+?)<\/div>/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1].length > 20) {
      return m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, "").replace(/\s+/g, " ").trim();
    }
  }
  // フォールバック: <main> タグ内テキスト
  const mainM = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (mainM) {
    return mainM[1].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, "").replace(/\s+/g, " ").trim();
  }
  return "";
}

function findKeywords(text) {
  // 長いキーワードを優先（"優羽ちゃん"が"優羽"より先にマッチするよう）
  const sorted = [...KEYWORDS].sort((a, b) => b.length - a.length);
  const found  = new Set();
  for (const kw of sorted) {
    if (text.includes(kw)) found.add(kw);
  }
  return [...found];
}

function buildExcerpt(text, keywords) {
  for (const kw of keywords) {
    const idx = text.indexOf(kw);
    if (idx === -1) continue;
    const start   = Math.max(0, idx - 40);
    const end     = Math.min(text.length, idx + kw.length + 40);
    let excerpt   = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (start > 0)          excerpt = "…" + excerpt;
    if (end < text.length)  excerpt = excerpt + "…";
    return excerpt;
  }
  return "";
}

// ── メンバーのブログ一覧収集 ──

async function fetchMemberArticles(ct) {
  const articles  = [];
  let memberName  = null;
  let dy          = currentDy();
  let emptyMonths = 0;

  while (dy >= CUTOFF_DY) {
    const url = `${BASE_URL}/s/official/diary/member/list?ima=0000&ct=${ct}&dy=${dy}`;
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      console.error(`    取得失敗: ${e.message}`);
      break;
    }
    if (!html) break; // 404

    if (!memberName) memberName = extractMemberName(html);

    const pageArticles = parseArticles(html);

    // 最初の数ヶ月で記事が全くなければメンバー不在と判断
    if (!pageArticles.length) {
      emptyMonths++;
      if (emptyMonths >= 3) break;
    } else {
      emptyMonths = 0;
      const inRange = pageArticles.filter(a => a.date >= CUTOFF_DATE);
      articles.push(...inRange);
    }

    dy = prevDy(dy);
    await sleep(600);
  }

  return { memberName: memberName || `ct${ct}`, articles };
}

// ── Notion ──

async function getExistingUrls() {
  if (!DB_MENTIONS || DRY_RUN) return new Set();
  const urls = new Set();
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_MENTIONS,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      const u = p.properties["URL"]?.url;
      if (u) urls.add(u.split("?")[0]);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return urls;
}

async function addToNotion({ title, date, url, memberName, ct, keywords, excerpt }) {
  if (DRY_RUN) return;
  const props = {
    Name:      { title:     [{ text: { content: title } }] },
    URL:       { url },
    Member:    { rich_text: [{ text: { content: memberName } }] },
    MemberCt:  { number: ct },
    Keywords:  { multi_select: keywords.map(k => ({ name: k })) },
    Excerpt:   { rich_text: [{ text: { content: excerpt.slice(0, 2000) } }] },
    Published: { checkbox: true },
  };
  if (date) props["Date"] = { date: { start: date } };
  await notion.pages.create({ parent: { database_id: DB_MENTIONS }, properties: props });
}

// ── メイン ──

async function main() {
  if (!DB_MENTIONS && !DRY_RUN) {
    console.error("DB_MENTIONS が未設定です");
    process.exit(1);
  }

  console.log("🔍 日向坂46メンバーブログ 佐藤優羽さん言及スキャン");
  console.log("=".repeat(50));
  if (DRY_RUN) console.log("⚠️  DRY RUN モード（Notionへの書き込みなし）\n");
  console.log(`対象期間: ${CUTOFF_DATE} 以降`);
  console.log(`検索ワード: ${KEYWORDS.join(" / ")}\n`);

  console.log("📋 既存DBのURL一覧を取得中...");
  const existingUrls = await getExistingUrls();
  console.log(`  ${existingUrls.size}件 既存\n`);

  const ctList = ONLY_CT
    ? [ONLY_CT]
    : Array.from({ length: CT_MAX - CT_MIN + 1 }, (_, i) => CT_MIN + i).filter(ct => ct !== YU_CT);

  let totalFound = 0;
  let totalAdded = 0;
  let totalSkipped = 0;
  let totalMembers = 0;

  for (const ct of ctList) {
    process.stdout.write(`\n[ct=${String(ct).padStart(2)}] ブログ一覧を収集中... `);

    const { memberName, articles } = await fetchMemberArticles(ct);

    if (!articles.length) {
      console.log(`スキップ（記事なし or 非公開メンバー）`);
      continue;
    }

    totalMembers++;
    console.log(`${memberName}（対象記事: ${articles.length}件）`);

    for (const article of articles) {
      // 重複チェック
      if (existingUrls.has(article.url.split("?")[0])) {
        totalSkipped++;
        continue;
      }

      // 本文取得
      let content = "";
      try {
        const html = await fetchPage(article.url);
        if (html) content = extractBlogContent(html);
      } catch (e) {
        process.stdout.write(`    ⚠️  本文取得失敗: ${e.message}\n`);
      }

      // タイトル＋本文でキーワード検索
      const fullText = article.title + " " + content;
      const matched  = findKeywords(fullText);

      if (matched.length > 0) {
        const excerpt = buildExcerpt(content || article.title, matched);
        totalFound++;

        console.log(`  ✅ [${article.date}] ${article.title}`);
        console.log(`     キーワード: ${matched.join(" / ")}`);
        if (excerpt) console.log(`     抜粋: ${excerpt.slice(0, 80)}...`);

        try {
          await addToNotion({
            title: article.title,
            date:  article.date,
            url:   article.url,
            memberName,
            ct,
            keywords: matched,
            excerpt,
          });
          existingUrls.add(article.url.split("?")[0]);
          totalAdded++;
        } catch (e) {
          console.error(`     ❌ Notion書き込み失敗: ${e.message}`);
        }

        await sleep(400); // Notion APIレート制限対策
      }

      await sleep(800); // サイトへの負荷軽減
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log(`🎉 スキャン完了`);
  console.log(`   処理メンバー: ${totalMembers}人`);
  console.log(`   言及あり: ${totalFound}件 / 追加: ${totalAdded}件 / スキップ: ${totalSkipped}件`);
}

main().catch(console.error);
