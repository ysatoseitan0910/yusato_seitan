// ブログ一覧ページをスクレイピングしてNotionのDB_BLOGに新規記事を追加するスクリプト
//
// 実行方法:
//   NOTION_TOKEN=xxx DB_BLOG=xxx node add_blog_posts.js
//
// オプション:
//   --months=3   さかのぼる月数（デフォルト: 3）
//   --all        全記事を対象（月数制限なし）

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_BLOG = process.env.DB_BLOG;

const BASE_URL = "https://www.hinatazaka46.com";
const LIST_PATH = "/s/official/diary/member/list?ima=0000&ct=42";

const args = process.argv.slice(2);
const allFlag = args.includes("--all");
const monthsArg = args.find(a => a.startsWith("--months="));
const MAX_MONTHS = allFlag ? 999 : (monthsArg ? parseInt(monthsArg.split("=")[1]) : 3);

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// ── スクレイピング ──

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

function parseArticles(html) {
  // 詳細ページへのリンク（順番通りに並んでいる）
  const urlRe = /href="(\/s\/official\/diary\/detail\/(\d+)[^"]*)"/g;
  const urls = [];
  let um;
  while ((um = urlRe.exec(html)) !== null) {
    urls.push(BASE_URL + `/s/official/diary/detail/${um[2]}?ima=0000&cd=member`);
  }

  // タイトル: <div class="c-blog-article__title">
  const titleRe = /class="c-blog-article__title"[^>]*>\s*([\s\S]*?)\s*<\/div>/g;
  const titles = [];
  let tm;
  while ((tm = titleRe.exec(html)) !== null) {
    titles.push(tm[1].replace(/<[^>]+>/g, "").trim());
  }

  // 日付: <div class="c-blog-article__date">2026.4.6 17:51</div>
  const dateRe = /class="c-blog-article__date"[^>]*>\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/g;
  const dates = [];
  let dm;
  while ((dm = dateRe.exec(html)) !== null) {
    dates.push(`${dm[1]}-${dm[2].padStart(2,"0")}-${dm[3].padStart(2,"0")}`);
  }

  // URLとタイトル・日付を順番に対応させる
  const articles = [];
  const seen = new Set();
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (seen.has(url)) continue;
    seen.add(url);
    articles.push({
      url,
      title: titles[i] || "",
      date:  dates[i]  || "",
    });
  }
  return articles.filter(a => a.title);
}

function getPrevMonthUrl(html) {
  // 「前の月」へのリンク（＜ ボタン）
  const m = html.match(/href="(\/s\/official\/diary\/member\/list\?[^"]*dy=(\d{6})[^"]*)"/);
  if (!m) return null;
  // 現在より過去のリンクを探す（dyが今月より小さい）
  const allDy = [...html.matchAll(/href="(\/s\/official\/diary\/member\/list\?[^"]*dy=(\d{6})[^"]*)"/g)];
  const now = new Date();
  const currentDy = now.getFullYear() * 100 + (now.getMonth() + 1);
  const past = allDy.filter(([,, dy]) => parseInt(dy) < currentDy);
  if (!past.length) return null;
  past.sort((a, b) => parseInt(b[2]) - parseInt(a[2]));
  return BASE_URL + past[0][1];
}

async function scrapeAllPages() {
  const allArticles = [];
  let url = BASE_URL + LIST_PATH;
  let monthCount = 0;

  while (url && monthCount < MAX_MONTHS) {
    console.log(`  📄 取得中: ${url}`);
    let html;
    try {
      html = await fetchPage(url);
    } catch (e) {
      console.error(`  ページ取得失敗: ${e.message}`);
      break;
    }

    const articles = parseArticles(html);
    console.log(`     → ${articles.length}件の記事`);
    allArticles.push(...articles);

    // 前月へのリンクを探す
    const prevUrl = getPrevMonthUrl(html);
    url = prevUrl;
    monthCount++;

    await new Promise(r => setTimeout(r, 500));
  }

  return allArticles;
}

// ── サムネイル取得 ──

async function fetchThumbnail(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/https:\/\/cdn\.hinatazaka46\.com\/files\/[^"'\s)>]*(?:diary|moblog)[^"'\s)>]*\.(?:jpg|jpeg|png|webp)/i);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

// ── Notion ──

async function getExistingData() {
  const urls = new Set();
  let maxNumber = 0;
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_BLOG,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      const u = p.properties["URL"]?.url;
      if (u) urls.add(u.split("?")[0]);
      const n = p.properties["Number"]?.number;
      if (n && n > maxNumber) maxNumber = n;
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return { urls, maxNumber };
}

async function addToNotion(article, imgUrl, number) {
  const props = {
    Name:      { title: [{ text: { content: article.title } }] },
    URL:       { url: article.url },
    Published: { checkbox: true },
    Number:    { number: number },
  };
  if (article.date) props["Date"] = { date: { start: article.date } };
  if (imgUrl) props["Media"] = { files: [{ name: "thumbnail", type: "external", external: { url: imgUrl } }] };

  await notion.pages.create({ parent: { database_id: DB_BLOG }, properties: props });
}

// ── メイン ──

async function main() {
  if (!DB_BLOG) { console.error("DB_BLOG が未設定です"); process.exit(1); }

  console.log(`🔍 ブログ一覧をスクレイピング中（最大${allFlag ? "全" : MAX_MONTHS}ヶ月）...`);
  const scraped = await scrapeAllPages();
  console.log(`\n合計 ${scraped.length} 件取得\n`);

  console.log("📋 既存DBのURLとNumber最大値を取得中...");
  const { urls: existingUrls, maxNumber } = await getExistingData();
  console.log(`  既存: ${existingUrls.size} 件 / 最大Number: ${maxNumber}\n`);

  const newArticles = scraped.filter(a => !existingUrls.has(a.url.split("?")[0]));
  console.log(`✨ 新規追加対象: ${newArticles.length} 件\n`);

  if (newArticles.length === 0) {
    console.log("追加する記事はありません。");
    return;
  }

  // 古い順に並べてから連番を振る
  newArticles.sort((a, b) => a.date.localeCompare(b.date));

  let nextNumber = maxNumber + 1;
  let success = 0, fail = 0;
  for (const article of newArticles) {
    process.stdout.write(`  追加中: [No.${nextNumber}] ${article.title} (${article.date}) ... `);

    const imgUrl = await fetchThumbnail(article.url);

    try {
      await addToNotion(article, imgUrl, nextNumber);
      console.log(imgUrl ? `✅ (サムネイルあり)` : `✅ (サムネイルなし)`);
      nextNumber++;
      success++;
    } catch (e) {
      console.log(`❌ ${e.message}`);
      fail++;
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n完了: 追加 ${success}件 / 失敗 ${fail}件`);
}

main().catch(console.error);
