/**
 * generate_quiz.js — ゆさんブログクイズ問題生成 CLI
 *
 * 使い方:
 *   node generate_quiz.js <ブログURL>
 *   node generate_quiz.js <ブログURL1> <ブログURL2> ...
 *
 * 例:
 *   node generate_quiz.js "https://www.hinatazaka46.com/s/official/diary/detail/49999"
 *
 * 生成した問題は quiz_questions.json に追記されます。
 * git commit & push すれば次回ビルド後にサイトに反映されます。
 *
 * 必要な環境変数 (.env または シェル):
 *   ANTHROPIC_API_KEY  — AnthropicのAPIキー
 *
 * オプション:
 *   --dry-run  保存せずに生成結果だけ表示
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const QUIZ_FILE = path.join(__dirname, "quiz_questions.json");

// .env を手動ロード（dotenvなしで動作するシンプル実装）
function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const isDryRun = process.argv.includes("--dry-run");
const urls = process.argv.slice(2).filter(a => a.startsWith("http"));

// ── ブログ本文スクレイピング ──
async function scrapeBlogContent(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "ja,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  // ページタイトルを取得
  const titleMatch = cleaned.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/\s*[\|｜\-–—]\s*.*$/, "").trim() : "";

  // hinatazaka46.com のブログ本文候補クラス
  const patterns = [
    /class="[^"]*c-blog-article__text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*p-blog-article[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*diary-detail[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /class="[^"]*blog[-_]text[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /id="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ];
  for (const pat of patterns) {
    const m = cleaned.match(pat);
    if (m) {
      const text = m[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s{3,}/g, "\n\n")
        .trim();
      if (text.length > 50) return { title: pageTitle, content: text.slice(0, 3000) };
    }
  }

  // フォールバック: og:description を使用
  const descMatch = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{30,})["']/i)
                 || html.match(/<meta[^>]+content=["']([^"']{30,})["'][^>]+property=["']og:description["']/i);
  if (descMatch) {
    return {
      title: pageTitle,
      content: descMatch[1].replace(/&#39;/g, "'").slice(0, 500),
    };
  }

  throw new Error("ブログ本文を取得できませんでした。URLを確認してください。");
}

// ── Claude API でクイズ問題を生成 ──
async function generateQuestions(title, content, url) {
  const prompt = `以下は日向坂46のメンバー「佐藤優羽」さんの公式ブログ記事です。

タイトル: ${title || "（タイトル不明）"}
URL: ${url}

本文:
${content}

この記事を読んだファンが楽しめる4択クイズを3問作成してください。

条件:
- 記事の具体的な内容（エピソード、食べ物、出来事、感情など）に基づいた問題にすること
- 一般知識では答えられず、この記事を読まないと分からない問題にすること
- 選択肢は自然で、紛らわしい誤答を含めること
- 問題文は「佐藤優羽さんが〜」のような形で書くこと

以下の形式でJSONのみを返してください（前後に説明文不要）:
{"questions":[{"question":"問題文","options":["A. 選択肢1","B. 選択肢2","C. 選択肢3","D. 選択肢4"],"answer":"A","explanation":"解説文"}]}`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("JSON形式の回答が得られませんでした: " + text.slice(0, 200));
  const data = JSON.parse(jsonMatch[0]);
  return Array.isArray(data.questions) ? data.questions : [];
}

// ── quiz_questions.json の読み書き ──
function loadQuestions() {
  if (!fs.existsSync(QUIZ_FILE)) return [];
  return JSON.parse(fs.readFileSync(QUIZ_FILE, "utf-8"));
}

function saveQuestions(questions) {
  fs.writeFileSync(QUIZ_FILE, JSON.stringify(questions, null, 2), "utf-8");
}

// ── メイン ──
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY が設定されていません");
    console.error("   .env ファイルに ANTHROPIC_API_KEY=sk-ant-... を追記してください");
    process.exit(1);
  }
  if (urls.length === 0) {
    console.log("使い方: node generate_quiz.js <ブログURL> [<ブログURL2> ...]");
    console.log("例: node generate_quiz.js \"https://www.hinatazaka46.com/s/official/diary/detail/49999\"");
    process.exit(0);
  }

  const existing = loadQuestions();
  const existingUrls = new Set(existing.map(q => q.sourceUrl));

  for (const url of urls) {
    console.log(`\n📖 処理中: ${url}`);

    if (existingUrls.has(url)) {
      console.log("  ℹ️  この記事からはすでに問題が生成されています。スキップします。");
      console.log("  ※ 再生成したい場合は quiz_questions.json から該当問題を削除してください。");
      continue;
    }

    // ブログ本文を取得
    console.log("  🔍 ブログ本文を取得中...");
    let scraped;
    try {
      scraped = await scrapeBlogContent(url);
      console.log(`  ✅ 本文取得: ${scraped.content.length}文字  タイトル: ${scraped.title}`);
    } catch (e) {
      console.error(`  ❌ スクレイピング失敗: ${e.message}`);
      continue;
    }

    // Claude で問題生成
    console.log("  🤖 Claude で問題を生成中...");
    let questions;
    try {
      questions = await generateQuestions(scraped.title, scraped.content, url);
      console.log(`  ✅ ${questions.length}問 生成完了`);
    } catch (e) {
      console.error(`  ❌ 問題生成失敗: ${e.message}`);
      continue;
    }

    // 結果を表示
    questions.forEach((q, i) => {
      console.log(`\n  【問${i + 1}】${q.question}`);
      q.options.forEach(o => console.log(`    ${o}`));
      console.log(`  ✅ 正解: ${q.answer}  解説: ${q.explanation}`);
    });

    if (!isDryRun) {
      // JSON ファイルに追記
      const newEntries = questions.map(q => ({
        q: q.question,
        options: q.options,
        answer: q.answer,
        explanation: q.explanation,
        sourceTitle: scraped.title,
        sourceUrl: url,
      }));
      const updated = [...existing, ...newEntries];
      saveQuestions(updated);
      console.log(`\n  💾 quiz_questions.json に ${newEntries.length}問を追記しました（合計 ${updated.length}問）`);
      console.log("  次のステップ: git add quiz_questions.json && git commit && git push");
    } else {
      console.log("\n  [--dry-run] 保存しませんでした");
    }
  }
}

main().catch(e => {
  console.error("❌ エラー:", e.message);
  process.exit(1);
});
