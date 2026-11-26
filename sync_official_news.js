// 日向坂46公式サイトのニュースから、新しいライブ・イベント・リリース・ミーグリ（と佐藤優羽さんのメディア出演）の
// お知らせを検知して DB_SCHEDULE（トップのスケジュール）に入れ、日付が過ぎた予定を DB_HISTORY（ヒストリー）に移す。
//
// 1) ニュース → スケジュール
//    ニュース一覧（月ごと：news/list?dy=YYYYMM）から対象カテゴリの記事を拾い、本文を Claude に読ませて
//    「新しく決まった予定か」「日程・会場・名前」を取り出す（photo_judge.js と同じ claude-opus-5-5）。
//    チケット発売・注意事項・グッズ・特典などのお知らせは予定ではないので入れない。
//    複数日の公演は1日1行（スケジュールの書き方に合わせる）。既にある予定とは Claude と名前・日付の両方で重複を見る。
//    読んだ記事のIDは state/official-news.json に残し、同じ記事は二度読まない（deploy.yml が VPS と行き来させる）。
// 2) スケジュール → ヒストリー
//    公開中のスケジュールのうち、日付が今日以前で、ヒストリーにまだ無いものを追加する（SINCE 以降のみ）。
//    手で入れた予定も対象。Type は名前から決める（ライブ／イベント／リリース／誕生日など）。
//
// 通常は直近 WINDOW_DAYS 日のニュースだけを見る。過去分は NEWS_SINCE=YYYY-MM-DD で一度だけ流す。
// 環境変数：NOTION_TOKEN / DB_SCHEDULE / DB_HISTORY / ANTHROPIC_API_KEY、NEWS_SINCE（任意）、DRY_RUN=1
const fs = require("fs");
const { Client } = require("@notionhq/client");
const mod = require("@anthropic-ai/sdk");
const Anthropic = mod.default || mod;

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_SCHEDULE = process.env.DB_SCHEDULE;
const DB_HISTORY  = process.env.DB_HISTORY;
const DRY_RUN     = process.env.DRY_RUN === "1";
const WINDOW_DAYS = 10;
const HISTORY_SINCE = "2026-09-01";          // スケジュール → ヒストリーの対象（それ以前は手で整備済み）
const STATE_FILE  = "state/official-news.json";
const BASE = "https://www.hinatazaka46.com";
const UA = { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" } };
const CATEGORIES = ["イベント", "リリース", "ミート＆グリート", "その他", "メディア"];

const todayJst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const strip = h => String(h || "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "")
  .replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "\n").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&ldquo;|&rdquo;/g, "\"").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const norm = s => String(s || "").normalize("NFKC").replace(/[\s「」『』"“”・@＠]/g, "").toLowerCase();
// かっこ書き（補足）を除いた名前。ヒストリーとの重複判定に使う（「緊急生配信（…）」の表記違いなど）
const base = s => norm(String(s || "").replace(/[（(][^）)]*[）)]/g, ""));

// ── ニュース一覧 ──
async function newsList(since) {
  const months = new Set();
  for (let d = new Date(since + "T00:00:00Z"); d <= new Date(todayJst() + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    months.add(d.toISOString().slice(0, 7).replace("-", ""));
  }
  months.add(todayJst().slice(0, 7).replace("-", ""));
  const out = [];
  for (const ym of months) {
    const html = await (await fetch(`${BASE}/s/official/news/list?ima=0000&dy=${ym}`, UA)).text();
    const re = /href="\/s\/official\/news\/detail\/([A-Z0-9]+)[^"]*"><time class="c-news__date">([^<]+)<\/time>\s*<div class="c-news__category[^"]*">([^<]+)<\/div>\s*<p class="c-news__text">([\s\S]*?)<\/p>/g;
    let m;
    while ((m = re.exec(html))) {
      const date = m[2].trim().replace(/\./g, "-");
      out.push({ id: m[1], date, category: m[3].trim(), title: strip(m[4]).replace(/\n/g, " "), url: `${BASE}/s/official/news/detail/${m[1]}?ima=0000` });
    }
  }
  return out.filter(n => n.date >= since).sort((a, b) => a.date.localeCompare(b.date));
}

async function newsBody(url) {
  const html = await (await fetch(url, UA)).text();
  const a = html.indexOf("c-article__title");
  let t = strip(html.slice(a < 0 ? 0 : a));
  const end = t.indexOf("NEWS一覧");
  if (end > 0) t = t.slice(0, end);
  return t.slice(0, 6000);
}

// ── Claude で予定を取り出す ──
const SCHEMA = {
  type: "object",
  properties: {
    is_new_schedule: { type: "boolean" },
    reason: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date:           { type: "string" },
          name:           { type: "string" },
          kind:           { type: "string", enum: ["ライブ", "イベント", "リリース", "ミーグリ", "メディア", "その他"] },
          already_listed: { type: "boolean" },
        },
        required: ["date", "name", "kind", "already_listed"],
        additionalProperties: false,
      },
    },
  },
  required: ["is_new_schedule", "reason", "items"],
  additionalProperties: false,
};

function prompt(n, body, existing) {
  return `日向坂46公式サイトのニュースです。佐藤優羽さん（日向坂46五期生）のファンサイトの「スケジュール」に載せる予定があるか判定し、あれば取り出してください。

## 載せるもの
- 新しく開催・発売・出演が決まったお知らせ：ライブ・ツアー・フェス出演・イベント・シングル等の発売・ミート＆グリート（オンライン／リアル）・サイン会など
- 日向坂46全体、または佐藤優羽さんが出演するもの。メディア出演は佐藤優羽さんが出るものだけ
## 載せないもの（is_new_schedule=false）
- チケットの発売・先行受付・トレード、注意事項、グッズ、購入特典、配信のお知らせの更新など、予定そのものではないもの
- 佐藤優羽さん以外のメンバーだけが出るもの（出演者が明記されていて佐藤優羽さんが含まれない）

## 取り出し方
- 日付ごとに1件（複数日の公演は日ごとに分ける）。date は YYYY-MM-DD
- 同じ日・同じ会場で行われる一連のもの（例：リアルミート＆グリートとリアルサイン会）は1件にまとめる
- 記事の主題でない予定（特典のお知らせの中に出てくる発売日など）も、既存のスケジュールに無ければ取り出してよい
- name は既存のスケジュールの書き方に合わせる。例：
  - 「ARENA Tour「ひなくり2026」@国立代々木競技場 第一体育館」（公演名@会場）
  - 「18thシングル『イチャイチャ虫』発売」
  - 「18thシングル『イチャイチャ虫』発売記念 オンラインミート＆グリート」
  - 「7回目のひな誕祭 購入者応募抽選スペシャルイベント メンバー生コメンタリー」
- 下の「既存のスケジュール」に同じ予定（表記が違っても同じ日の同じイベント）があれば already_listed=true
- reason に判断の理由を短く

## 既存のスケジュール（日付 名前）
${existing || "（なし）"}

## ニュース
カテゴリ：${n.category}
掲載日：${n.date}
${body}`;
}

async function extract(client, n, body, existing) {
  const res = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: prompt(n, body, existing) }],
  });
  if (res.stop_reason === "refusal") return null;
  return JSON.parse(res.content.filter(b => b.type === "text").map(b => b.text).join(""));
}

// ── Notion ──
async function queryAll(dbId, filter) {
  const out = [];
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100, ...(filter ? { filter } : {}) });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}
const title = p => (Object.values(p.properties).find(v => v.type === "title")?.title || []).map(t => t.plain_text).join("");
const dateOf = p => p.properties.Date?.date?.start?.slice(0, 10) || "";
const urlOf = p => p.properties.URL?.url || "";

function historyType(name) {
  if (/誕生日/.test(name)) return "誕生日";
  if (/ラジオ|文化放送|ニッポン放送|TBSラジオ|bayfm|J-WAVE|FM/i.test(name)) return "ラジオ";
  if (/月号|増刊|写真集|雑誌|グラビア|表紙/.test(name)) return "出版";
  if (/ミート＆グリート|ミーグリ|サイン会|握手|個別トーク|感謝祭|コメンタリー|イベント/.test(name)) return "イベント";
  if (/MUSIC VIDEO|MV|発売|リリース|先行配信/i.test(name)) return "リリース";
  if (/LIVE|ライブ|Tour|ツアー|ひな誕祭|ひなくり|フェス|万博|公演|ステージ/i.test(name)) return "ライブ";
  if (/YouTube|日向坂ちゃんねる/i.test(name)) return "YouTube";
  if (/配信|Lemino|ABEMA/i.test(name)) return "ネット配信";
  if (/放送|テレビ|TV|出演/.test(name)) return "地上波";
  return "その他";
}

async function main() {
  if (!process.env.NOTION_TOKEN || !DB_SCHEDULE) { console.log("NOTION_TOKEN / DB_SCHEDULE 未設定 → スキップ"); return; }
  let state;
  try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { state = { ids: [] }; }
  const seen = new Set(state.ids || []);
  const since = process.env.NEWS_SINCE || new Date(Date.now() + 9 * 3600e3 - WINDOW_DAYS * 86400e3).toISOString().slice(0, 10);

  const schedule = await queryAll(DB_SCHEDULE);
  const schedKeys = new Set(schedule.map(p => `${dateOf(p)} ${norm(title(p))}`));
  const schedUrls = new Set(schedule.map(urlOf).filter(Boolean));

  // ── 1) ニュース → スケジュール ──
  if (process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic();
    const news = (await newsList(since)).filter(n => CATEGORIES.includes(n.category) && !seen.has(n.id) && !schedUrls.has(n.url))
      .filter(n => n.category !== "メディア" || /佐藤優羽|五期生|日向坂46/.test(n.title));
    console.log(`公式ニュース：${since}以降・未処理 ${news.length}件${DRY_RUN ? " [DRY_RUN]" : ""}`);
    for (const n of news) {
      // 既存のスケジュール（この実行で足した分も含む）を Claude に見せて重複を判定させる
      const existing = schedule.filter(p => dateOf(p) >= since).map(p => `${dateOf(p)} ${title(p)}`).sort().join("\n");
      let r;
      try { r = await extract(client, n, await newsBody(n.url), existing); }
      catch (e) { console.error(`  ❌ ${n.id} ${e.message}`); continue; }      // 失敗したら次回また読む
      if (!r) { seen.add(n.id); continue; }
      const add = r.is_new_schedule ? r.items.filter(i => !i.already_listed && /^\d{4}-\d{2}-\d{2}$/.test(i.date)) : [];
      console.log(`  ${add.length ? "📅" : "・"} ${n.date} [${n.category}] ${n.title.slice(0, 50)} → ${add.length}件（${r.reason}）`);
      for (const it of add) {
        const key = `${it.date} ${norm(it.name)}`;
        if (schedKeys.has(key)) continue;
        console.log(`      + ${it.date} ${it.name}`);
        if (!DRY_RUN) {
          await notion.pages.create({ parent: { database_id: DB_SCHEDULE }, properties: {
            Name: { title: [{ text: { content: it.name.slice(0, 200) } }] },
            Date: { date: { start: it.date } },
            URL:  { url: n.url },
            Published: { checkbox: true },
          } });
        }
        schedKeys.add(key);
        schedule.push({ properties: { Name: { type: "title", title: [{ plain_text: it.name }] }, Date: { date: { start: it.date } }, URL: { url: n.url }, Published: { checkbox: true } } });
      }
      seen.add(n.id);
    }
  } else console.log("ANTHROPIC_API_KEY 未設定 → ニュースの読み取りはスキップ");

  // ── 2) スケジュール → ヒストリー（日付が過ぎたもの） ──
  if (DB_HISTORY) {
    const history = await queryAll(DB_HISTORY);
    const hist = history.map(p => ({ date: dateOf(p), name: base(title(p)), url: urlOf(p) }));
    const today = todayJst();
    const done = schedule.filter(p => p.properties.Published?.checkbox && dateOf(p) >= HISTORY_SINCE && dateOf(p) <= today);
    let added = 0;
    for (const p of done) {
      const d = dateOf(p), name = title(p), n = base(name), url = urlOf(p);
      // 同じ日に、名前が同じ・どちらかがもう一方を含む・URL が同じ記録があれば追加しない
      if (hist.some(h => h.date === d && (h.name === n || h.name.includes(n) || n.includes(h.name) || (url && h.url === url)))) continue;
      const [Y, M, D] = d.split("-");
      console.log(`  🗓 ヒストリーに追加: ${d} [${historyType(name)}] ${name}`);
      if (!DRY_RUN) {
        await notion.pages.create({ parent: { database_id: DB_HISTORY }, properties: {
          Name:  { title: [{ text: { content: name } }] },
          ...(url ? { URL: { url } } : {}),
          Date:  { date: { start: d } },
          Year:  { rich_text: [{ text: { content: String(+Y) } }] },
          Month: { rich_text: [{ text: { content: String(+M) } }] },
          Day:   { rich_text: [{ text: { content: String(+D) } }] },
          Type:  { multi_select: [{ name: historyType(name) }] },
          Published: { checkbox: true },
        } });
      }
      hist.push({ date: d, name: n, url });
      added++;
    }
    console.log(`スケジュール → ヒストリー：${added}件`);
  }

  if (!DRY_RUN) {
    fs.mkdirSync("state", { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ids: [...seen].slice(-1000) }));
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
