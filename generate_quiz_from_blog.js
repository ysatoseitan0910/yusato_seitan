// 佐藤優羽さんのブログからクイズ問題を自動生成してNotionのDB_QUIZに追加するスクリプト
// Published=false（非公開）で追加するため、内容確認後に手動で公開してください
//
// 実行方法（PowerShell）:
//   $env:NOTION_TOKEN="xxx"; $env:DB_BLOG="xxx"; $env:DB_QUIZ="xxx"; $env:ANTHROPIC_API_KEY="xxx"; node generate_quiz_from_blog.js
//
// オプション:
//   --limit=10   処理するブログ記事数の上限（デフォルト: 20）
//   --all        全記事を対象（上限なし）

const { Client } = require("@notionhq/client");
const Anthropic = require("@anthropic-ai/sdk");

const notion    = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DB_BLOG = process.env.DB_BLOG;
const DB_QUIZ = process.env.DB_QUIZ;

const args     = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith("--limit="));
const allFlag  = args.includes("--all");
const LIMIT    = allFlag ? Infinity : (limitArg ? parseInt(limitArg.split("=")[1]) : 20);

const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getText(prop) {
  if (!prop) return "";
  if (prop.title)     return prop.title.map(s => s.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map(s => s.plain_text).join("");
  return "";
}

function t(content) {
  return content ? [{ text: { content: String(content) } }] : [];
}

// ── ブログ本文取得 ──

async function fetchBlogContent(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    // タイトル
    const titleMatch = html.match(/class="c-blog-article__title"[^>]*>\s*([\s\S]*?)\s*<\/div>/);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

    // 本文: 複数のクラス名を試みる
    const bodyPatterns = [
      /class="c-blog-article__text"[^>]*>([\s\S]*?)<\/div>/,
      /class="p-blog-detail__text"[^>]*>([\s\S]*?)<\/div>/,
      /class="l-article__text"[^>]*>([\s\S]*?)<\/div>/,
    ];
    let rawBody = "";
    for (const pat of bodyPatterns) {
      const m = html.match(pat);
      if (m) { rawBody = m[1]; break; }
    }

    let text;
    if (rawBody) {
      text = rawBody
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<img[^>]+>/gi, "")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    } else {
      // フォールバック: <p>タグを集める
      const pTags = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
        .map(m => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim())
        .filter(s => s.length > 20);
      text = pTags.join("\n");
    }

    if (!text || text.length < 80) return null;
    return { title, text };
  } catch (e) {
    console.error(`  本文取得失敗: ${e.message}`);
    return null;
  }
}

// ── Claude でクイズ生成 ──

const QUIZ_PROMPT = `あなたは日向坂46五期生・佐藤優羽さんのファンサイト向けクイズ作成者です。
以下のブログ記事からクイズ問題を最大2問作成してください。

【クイズ作成ルール】
- ブログ内に具体的・客観的な事実（数字、固有名詞、出来事、エピソード、好きなもの・苦手なものなど）がある場合のみ作成する
- 曖昧な内容や答えを確認できない主観的な感情表現だけの場合はクイズを作らない
- 選択肢は4択（A/B/C/D）で、それぞれ明確に異なる内容にする（誤りの選択肢も具体的に）
- 正解は問題ごとにバラつかせる（全部Aにならないよう）
- 解説は40〜80文字程度で簡潔に
- クイズになる内容がなければ空の配列を返す

【ブログタイトル】
{TITLE}

【本文（抜粋）】
{TEXT}

以下のJSON形式のみで返してください（前後に余分なテキスト不要）:
{"quizzes":[{"question":"問題文","optionA":"選択肢A","optionB":"選択肢B","optionC":"選択肢C","optionD":"選択肢D","answer":"A","explanation":"解説"}]}`;

async function generateQuizzes(title, url, text) {
  const prompt = QUIZ_PROMPT
    .replace("{TITLE}", title)
    .replace("{TEXT}", text.slice(0, 3000));

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const data = JSON.parse(jsonMatch[0]);
    return (data.quizzes || []).map(q => ({ ...q, sourceTitle: title, sourceUrl: url }));
  } catch (e) {
    console.error(`  Claude APIエラー: ${e.message}`);
    return [];
  }
}

// ── Notion 操作 ──

async function queryAllBlogs() {
  const results = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: DB_BLOG,
      start_cursor: cursor,
      page_size: 100,
      filter: { property: "Published", checkbox: { equals: true } },
      sorts: [{ property: "Date", direction: "descending" }],
    });
    results.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function queryExistingQuizUrls() {
  const urls = new Set();
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: DB_QUIZ,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of r.results) {
      const url = p.properties.SourceUrl?.url;
      if (url) urls.add(url);
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return urls;
}

async function addQuizToNotion(quiz) {
  await notion.pages.create({
    parent: { database_id: DB_QUIZ },
    properties: {
      Name:        { title: t(quiz.question) },
      OptionA:     { rich_text: t(quiz.optionA) },
      OptionB:     { rich_text: t(quiz.optionB) },
      OptionC:     { rich_text: t(quiz.optionC) },
      OptionD:     { rich_text: t(quiz.optionD) },
      Answer:      { select: { name: quiz.answer || "A" } },
      Explanation: { rich_text: t(quiz.explanation) },
      SourceUrl:   { url: quiz.sourceUrl || null },
      SourceTitle: { rich_text: t(quiz.sourceTitle) },
      Published:   { checkbox: false },
    },
  });
}

// ── メイン ──

async function main() {
  console.log("=== ブログからクイズ自動生成 ===");
  console.log(`上限: ${LIMIT === Infinity ? "なし（--all）" : `${LIMIT}件`}`);

  if (!DB_BLOG) { console.error("DB_BLOG が未設定です"); process.exit(1); }
  if (!DB_QUIZ) { console.error("DB_QUIZ が未設定です"); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY が未設定です"); process.exit(1); }

  // 既存クイズのSourceUrlを収集（重複防止）
  console.log("\n📋 既存クイズURL取得中...");
  const existingUrls = await queryExistingQuizUrls();
  console.log(`  ${existingUrls.size}件のURLが登録済み`);

  // ブログ一覧取得
  console.log("\n📚 ブログ一覧取得中...");
  const blogs = await queryAllBlogs();
  console.log(`  ${blogs.length}件のブログ記事を取得`);

  let processed = 0;
  let added = 0;
  let skipped = 0;

  for (const blog of blogs) {
    if (processed >= LIMIT) break;

    const name = getText(blog.properties.Name);
    const url  = blog.properties.URL?.url;
    const date = blog.properties.Date?.date?.start || "";

    if (!url) { skipped++; continue; }

    // 既存クイズがあるブログはスキップ
    if (existingUrls.has(url)) {
      console.log(`  ⏭ スキップ（クイズ登録済）: ${name}`);
      skipped++;
      continue;
    }

    processed++;
    console.log(`\n[${processed}] ${date} 「${name}」`);

    // ブログ本文取得
    const content = await fetchBlogContent(url);
    await sleep(300);

    if (!content) {
      console.log("  ⏭ スキップ（本文取得失敗）");
      skipped++;
      continue;
    }
    console.log(`  本文 ${content.text.length}文字`);

    // クイズ生成
    const quizzes = await generateQuizzes(content.title || name, url, content.text);
    await sleep(800);

    if (quizzes.length === 0) {
      console.log("  ⏭ スキップ（クイズなし：内容が不十分）");
      skipped++;
      continue;
    }

    // Notionに追加
    for (const q of quizzes) {
      try {
        await addQuizToNotion(q);
        added++;
        console.log(`  ✅ 追加: ${q.question}`);
        console.log(`     答え: ${q.answer} / 解説: ${q.explanation}`);
      } catch (e) {
        console.error(`  ❌ Notion追加失敗: ${e.message}`);
      }
      await sleep(300);
    }
  }

  console.log(`\n=== 完了 ===`);
  console.log(`処理: ${processed}件 | 追加: ${added}問 | スキップ: ${skipped}件`);
  console.log("NotionのDB_QUIZで内容を確認し、問題なければPublishedをONにしてください。");
}

main().catch(console.error);
