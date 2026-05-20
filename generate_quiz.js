/**
 * generate_quiz.js
 *
 * 日向坂46公式ブログをスクレイピングし、Claude APIでクイズ問題を生成して
 * Notion DB_QUIZ に保存するスクリプト。
 *
 * Notion DB_QUIZ に必要なプロパティ:
 *   Name        (title)     ← 問題文
 *   OptionA     (rich_text) ← 選択肢A
 *   OptionB     (rich_text) ← 選択肢B
 *   OptionC     (rich_text) ← 選択肢C
 *   OptionD     (rich_text) ← 選択肢D
 *   Answer      (select)    ← 正解 ("A"/"B"/"C"/"D")
 *   Explanation (rich_text) ← 解説
 *   SourceTitle (rich_text) ← ブログ記事タイトル
 *   SourceURL   (url)       ← ブログ記事URL
 *   Published   (checkbox)  ← trueにするとquiz.htmlに掲載
 *
 * 環境変数:
 *   NOTION_TOKEN, DB_BLOG, DB_QUIZ, ANTHROPIC_API_KEY
 */

const { Client } = require("@notionhq/client");
const Anthropic = require("@anthropic-ai/sdk");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DB_BLOG = process.env.DB_BLOG;
const DB_QUIZ = process.env.DB_QUIZ;

// 1回の実行で処理する最大ブログ記事数（Claude APIコスト制御）
const MAX_POSTS_PER_RUN = 5;

// ── Notionヘルパー ──
function getText(page, key) {
  const p = page.properties[key];
  if (p?.title?.length)     return p.title.map(t => t.plain_text).join("");
  if (p?.rich_text?.length) return p.rich_text.map(t => t.plain_text).join("");
  return "";
}
function getUrl(page, key = "URL") {
  return page.properties[key]?.url || "";
}
function isPublished(page) {
  const p = page.properties.Published;
  if (!p) return true;
  if (p.checkbox === false) return false;
  return true;
}

// ── ブログ本文スクレイピング ──
async function scrapeBlogContent(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en;q=0.9",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // scriptとstyleを除去
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");

    // hinatazaka46.com ブログ本文の候補クラス
    const patterns = [
      /class="[^"]*c-blog-article__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*diary-detail[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*blog-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
      /class="[^"]*p-blog-article__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    ];

    for (const pat of patterns) {
      const m = cleaned.match(pat);
      if (m) {
        const text = m[1]
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'")
          .replace(/\s{3,}/g, "\n\n")
          .trim();
        if (text.length > 50) return text.slice(0, 3000);
      }
    }

    // フォールバック: og:description を本文の代替として使用
    const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{50,})["']/i)
                   || html.match(/<meta[^>]+content=["']([^"']{50,})["'][^>]+property=["']og:description["']/i);
    if (descMatch) return descMatch[1].replace(/&#39;/g, "'").slice(0, 500);

    return null;
  } catch (e) {
    console.error(`  スクレイピング失敗 (${url}):`, e.message);
    return null;
  }
}

// ── Claude APIでクイズ問題を生成 ──
async function generateQuestions(title, content) {
  const prompt = `以下は日向坂46のメンバー「佐藤優羽」さんの公式ブログ記事です。

タイトル: ${title}

本文:
${content}

この記事を読んだファンが楽しめる4択クイズを3問作成してください。

条件:
- 記事の具体的な内容（エピソード、食べ物、出来事、感情など）に基づいた問題にすること
- 一般知識では答えられず、この記事を読まないと分からない問題にすること
- 選択肢は自然で、紛らわしい誤答を含めること
- 問題文は「佐藤優羽さんが〜」のような形で書くこと

以下の形式でJSONのみを返してください（前後に説明文不要）:
{"questions":[{"question":"問題文","options":["A. 選択肢1","B. 選択肢2","C. 選択肢3","D. 選択肢4"],"answer":"A","explanation":"解説文（なぜその答えなのかを簡潔に）"}]}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0]?.text || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const data = JSON.parse(jsonMatch[0]);
    return Array.isArray(data.questions) ? data.questions : [];
  } catch (e) {
    console.error("  Claude API エラー:", e.message);
    return [];
  }
}

// ── Notion DB_QUIZ にクイズ問題を保存 ──
async function saveQuestion(q, sourceTitle, sourceUrl) {
  const options = q.options || [];
  await notion.pages.create({
    parent: { database_id: DB_QUIZ },
    properties: {
      Name:        { title:     [{ text: { content: q.question || "" } }] },
      OptionA:     { rich_text: [{ text: { content: options[0] || "" } }] },
      OptionB:     { rich_text: [{ text: { content: options[1] || "" } }] },
      OptionC:     { rich_text: [{ text: { content: options[2] || "" } }] },
      OptionD:     { rich_text: [{ text: { content: options[3] || "" } }] },
      Answer:      { select:    { name: q.answer || "A" } },
      Explanation: { rich_text: [{ text: { content: q.explanation || "" } }] },
      SourceTitle: { rich_text: [{ text: { content: sourceTitle } }] },
      SourceURL:   { url: sourceUrl },
      Published:   { checkbox: true },
    },
  });
}

// ── DB_QUIZ から生成済みのSourceURL一覧を取得 ──
async function getExistingSourceUrls() {
  const urls = new Set();
  let cursor;
  do {
    const res = await notion.databases.query({
      database_id: DB_QUIZ,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const p of res.results) {
      const u = getUrl(p, "SourceURL");
      if (u) urls.add(u);
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return urls;
}

// ── メイン ──
async function main() {
  if (!DB_BLOG || !DB_QUIZ) {
    console.error("❌ DB_BLOG または DB_QUIZ が未設定です");
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY が未設定です");
    process.exit(1);
  }

  console.log("🔍 ブログ記事一覧を取得中...");
  const blogRes = await notion.databases.query({
    database_id: DB_BLOG,
    sorts: [{ property: "Date", direction: "descending" }],
  });
  const blogPosts = blogRes.results.filter(isPublished);
  console.log(`  ブログ記事: ${blogPosts.length}件`);

  console.log("🗂️  既存のクイズ問題のソースURLを確認中...");
  const existingUrls = await getExistingSourceUrls();
  console.log(`  既存問題のソース: ${existingUrls.size}件`);

  // まだ問題を生成していない記事を抽出
  const newPosts = blogPosts.filter(p => {
    const url = getUrl(p);
    return url && !existingUrls.has(url);
  });
  console.log(`  未処理記事: ${newPosts.length}件 (最大${MAX_POSTS_PER_RUN}件を処理)`);

  const targets = newPosts.slice(0, MAX_POSTS_PER_RUN);

  let totalGenerated = 0;
  for (const post of targets) {
    const title = getText(post, "Name");
    const url   = getUrl(post);
    console.log(`\n📖 処理中: ${title}`);

    // ブログ本文をスクレイピング
    const content = await scrapeBlogContent(url);
    if (!content) {
      console.log("  ⚠️  本文を取得できませんでした。スキップします。");
      continue;
    }
    console.log(`  本文取得: ${content.length}文字`);

    // Claude APIで問題生成
    const questions = await generateQuestions(title, content);
    console.log(`  問題生成: ${questions.length}問`);

    // Notionに保存
    let saved = 0;
    for (const q of questions) {
      try {
        await saveQuestion(q, title, url);
        saved++;
      } catch (e) {
        console.error(`  ❌ 保存失敗:`, e.message);
      }
    }
    console.log(`  ✅ ${saved}問を DB_QUIZ に保存しました`);
    totalGenerated += saved;

    // レートリミット対策（2秒待機）
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n🎉 完了！ 合計${totalGenerated}問を新規追加しました`);
}

main().catch(e => {
  console.error("❌ エラー:", e);
  process.exit(1);
});
