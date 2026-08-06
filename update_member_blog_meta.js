// 他メンバーブログDB（DB_MEMBER_BLOG）のメタ情報を自動補完するスクリプト
// URLだけ登録されたエントリの Name（タイトル）/ Date（日付）/ Member（メンバー名）を
// 日向坂46公式の記事ページから取得して、未設定のプロパティだけ埋める（既存値は上書きしない）
//
// 実行方法:
//   $env:NOTION_TOKEN="xxx"; $env:DB_MEMBER_BLOG="xxx"; node update_member_blog_meta.js
//   （抽出結果だけ確認したいときは $env:DRY_RUN="1" を付ける）

const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_MEMBER_BLOG = process.env.DB_MEMBER_BLOG;
const DRY_RUN = process.env.DRY_RUN === "1";
const HEADERS = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };

function decodeEntities(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// 名前の比較用に「空白除去＋NFC正規化」した見出しを作る（髙/嶌 等の表記ゆれ対策）
function nameKey(s) {
  return (s || "").normalize("NFC").replace(/[\s　]/g, "");
}

// 記事ページHTMLから タイトル / 日付 / メンバー名 を抽出
function extractMeta(html) {
  const titleM = html.match(/class="c-blog-article__title"[^>]*>\s*([\s\S]*?)\s*<\/div>/);
  const title = titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, "").trim()) : null;

  const dateM = html.match(/class="c-blog-article__date"[^>]*>\s*(?:<time>)?\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/);
  const date = dateM ? `${dateM[1]}-${String(dateM[2]).padStart(2, "0")}-${String(dateM[3]).padStart(2, "0")}` : null;

  // <title>「片山 紗希公式ブログ | …」→ 片山 紗希 → 空白除去
  const memM = html.match(/<title[^>]*>\s*([^|<\n]{1,20}?)\s*(?:公式ブログ|のブログ)/);
  const member = memM ? decodeEntities(memM[1]).replace(/[\s　]/g, "") : null;

  return { title, date, member };
}

async function fetchMeta(url) {
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return extractMeta(await res.text());
  } catch (e) {
    console.error(`  取得失敗 (${url}): ${e.message}`);
    return null;
  }
}

async function queryAll(dbId) {
  const results = [];
  let cursor;
  do {
    const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100 });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return results;
}

const isEmptyTitle  = p => !(p.properties["Name"]?.title?.length);
const isEmptyDate   = p => !(p.properties["Date"]?.date?.start);
const isEmptyMember = p => !(p.properties["Member"]?.multi_select?.length);

async function main() {
  if (!DB_MEMBER_BLOG) { console.error("DB_MEMBER_BLOG が未設定です"); process.exit(1); }

  // 既存の Member 選択肢を取得（表記ゆれを既存名に寄せてダブり防止）
  let memberOptions = [];
  try {
    const db = await notion.databases.retrieve({ database_id: DB_MEMBER_BLOG });
    memberOptions = (db.properties["Member"]?.multi_select?.options || []).map(o => o.name);
  } catch (e) { console.error(`  スキーマ取得失敗: ${e.message}`); }
  const optionByKey = new Map(memberOptions.map(n => [nameKey(n), n]));

  console.log("📋 他メンバーブログDBを取得中...");
  const pages = await queryAll(DB_MEMBER_BLOG);
  const targets = pages.filter(p => {
    const hasUrl = !!(p.properties["URL"]?.url);
    return hasUrl && (isEmptyTitle(p) || isEmptyDate(p) || isEmptyMember(p));
  });
  console.log(`  ${pages.length}件中、補完対象: ${targets.length}件${DRY_RUN ? "（DRY_RUN）" : ""}\n`);

  let success = 0, skip = 0, fail = 0;

  for (const page of targets) {
    const url = page.properties["URL"].url;
    const meta = await fetchMeta(url);
    if (!meta) { skip++; continue; }

    const props = {};
    if (isEmptyTitle(page)  && meta.title)  props.Name = { title: [{ text: { content: meta.title } }] };
    if (isEmptyDate(page)   && meta.date)   props.Date = { date: { start: meta.date } };
    if (isEmptyMember(page) && meta.member) {
      const name = optionByKey.get(nameKey(meta.member)) || meta.member; // 既存表記に寄せる
      props.Member = { multi_select: [{ name }] };
    }

    if (Object.keys(props).length === 0) { console.log(`  ⏭️  抽出できず: ${url}`); skip++; continue; }

    const filled = Object.keys(props).map(k => k === "Name" ? `Name=${meta.title}` : k === "Date" ? `Date=${meta.date}` : `Member=${props.Member.multi_select[0].name}`).join(" / ");
    if (DRY_RUN) { console.log(`  📝 ${url}\n       ${filled}`); success++; continue; }

    try {
      await notion.pages.update({ page_id: page.id, properties: props });
      console.log(`  ✅ ${filled}`);
      success++;
    } catch (e) {
      console.log(`  ❌ Notion更新失敗 (${url}): ${e.message}`);
      fail++;
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n完了: 補完 ${success}件 / スキップ ${skip}件 / 失敗 ${fail}件`);
}

// エラー時は必ず異常終了する。exit 0 のままだとデプロイが「成功」と誤判定され、
// 直後の rsync --delete が生成されなかったHTMLを本番から削除してしまう（過去に403障害）
main().catch(e => { console.error(e); process.exit(1); });
