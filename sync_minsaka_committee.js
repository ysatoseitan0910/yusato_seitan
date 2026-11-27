// minsaka で参加者募集中の主催企画を、Notion の委員会News（DB_COMMITTEE_NEWS）に登録する。
// トップページの「生誕委員会からのお知らせ」と committee.html に出る（build.js が読む）。
//   募集中の企画で、同じ URL の登録が無い → 公開で登録（Status=募集中・締め切り・企画概要・画像）
//   Status が「募集中」のまま募集が終わった → Status=募集終了・Published を外す（お知らせから消える）
// 登録済みのもの（Published を問わず URL で照合）は作り直さないので、Notion での手直しは上書きしない。
// 企画一覧が読めなかったときは何もしない（読めないだけで「募集終了」にしてしまわないため）。
//
// 環境変数：NOTION_TOKEN、DB_COMMITTEE_NEWS、DRY_RUN=1（書き込まない）
const { Client } = require("@notionhq/client");
const { ORGANIZER_URL, parseOrganizedEvents, parseUnitPrice } = require("./minsaka");

const notion  = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID   = process.env.DB_COMMITTEE_NEWS;
const DRY_RUN = process.env.DRY_RUN === "1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const get = async url => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`minsaka ${res.status} ${url}`);
  return res.text();
};
const eventId = url => (String(url || "").match(/mina\/event\/(?:news\/)?([0-9a-f]{16,})/) || [])[1] || "";
// 日付は JST で扱う（GitHub Actions は UTC）
const jstDay = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);
const ymd = s => { const m = String(s || "").match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : ""; };
const days = d => Math.round(Date.parse(d + "T00:00:00Z") / 86400e3);

// 企画ページから「企画概要」の文章と画像（og:image）を取る
function parseDetail(html) {
  const img = (html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) || [])[1] || "";
  const text = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<br\s*\/?>/g, "\n").replace(/<\/p>/g, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/[ \t]+/g, " ");
  const i = text.indexOf("企画概要");
  let overview = "";
  if (i >= 0) {
    const rest = text.slice(i + 4);
    const end = rest.search(/SNSでシェア/);
    overview = rest.slice(0, end >= 0 ? end : 600).split("\n").map(s => s.trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  return { img, overview };
}

async function allPages() {
  const out = [];
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: DB_ID, start_cursor: cursor, page_size: 100 });
    out.push(...r.results);
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function main() {
  if (!process.env.NOTION_TOKEN || !DB_ID) { console.log("NOTION_TOKEN / DB_COMMITTEE_NEWS 未設定 → スキップ"); return; }
  const events = parseOrganizedEvents(await get(ORGANIZER_URL));
  if (!events.length) throw new Error("企画が1件も読み取れない（ページの構造が変わった可能性）");
  const byId = new Map(events.map(e => [e.id, e]));
  const pages = await allPages();
  const have = new Map(pages.map(p => [eventId(p.properties.URL && p.properties.URL.url), p]).filter(([id]) => id));
  console.log(`minsaka：企画${events.length}件（募集中${events.filter(e => e.open).length}件）/ 委員会News ${pages.length}件${DRY_RUN ? " [DRY_RUN]" : ""}`);

  // 募集中で未登録のものを登録
  for (const ev of events.filter(e => e.open)) {
    if (have.has(ev.id)) { console.log(`  ・登録済み: ${ev.title}`); continue; }
    let detail = { img: "", overview: "" }, price = "";
    try { const h = await get(ev.url); detail = parseDetail(h); price = parseUnitPrice(h); } catch (e) { console.log(`  ⚠ 企画ページを読めませんでした: ${e.message}`); }
    const deadline = jstDay(ev.remainingDays);          // 「残り N 日」から求めた締め切り日
    const desc = ["企画概要", detail.overview, price ? `1口 ${price}` : "", `参加はこちらから\n${ev.url}`].filter(Boolean).join("\n\n").slice(0, 1900);
    console.log(`  ✅ 登録: ${ev.title}（締め切り ${deadline}）`);
    if (DRY_RUN) { console.log(desc.replace(/^/gm, "    | "), "\n    画像:", detail.img); continue; }
    const props = {
      Name:        { title: [{ text: { content: ev.title.slice(0, 200) } }] },
      URL:         { url: ev.url },
      Status:      { multi_select: [{ name: "募集中" }] },
      "締め切り":  { date: { start: deadline } },
      Description: { rich_text: [{ text: { content: desc } }] },
      // 並び順（小さいほど上）。締め切りが近いものを上に、手で登録したお知らせ（1〜）よりも上に出す
      Priority:    { number: days(deadline) - 100000 },
      Published:   { checkbox: true },
    };
    const date = ymd(ev.date);
    if (date) props.Date = { date: { start: date } };   // 開催日（これまでの手入力と同じ）
    if (detail.img) props.Media = { files: [{ name: "image", type: "external", external: { url: detail.img } }] };
    await notion.pages.create({ parent: { database_id: DB_ID }, properties: props });
  }

  // 「募集中」のまま募集が終わったものを閉じる
  for (const [id, p] of have) {
    const ev = byId.get(id);
    const status = (p.properties.Status && p.properties.Status.multi_select || []).map(o => o.name);
    if (!ev || ev.open || !status.includes("募集中")) continue;
    console.log(`  🔚 募集終了: ${ev.title}`);
    if (DRY_RUN) continue;
    await notion.pages.update({ page_id: p.id, properties: {
      Status: { multi_select: [...status.filter(s => s !== "募集中").map(name => ({ name })), { name: "募集終了" }] },
      Published: { checkbox: false },
    } });
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
