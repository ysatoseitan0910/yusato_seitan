// Lemino で配信が始まった回を検出して DB_LEMINO に登録する。
//
// Lemino の番組ページ（クールごとの「グループ」）は Next.js の __NEXT_DATA__ に
//   childrenContents … そのクールの各回（title / availability_start / synopsis_info）
//   parentContents   … 同じ番組の他のクール（過去・未来）
// を持っていて、認証なしで読める。起点のグループから同じ番組の他クールを辿るので、
// クールが変わっても設定を書き換えずに済む（起点ページ自体の配信期限までは）。
//
// 出演者は「日向坂46」としか載っていないので、佐藤優羽さんの出演回だけを選ぶことはできない。
//   日向坂で会いましょう           … 全回を公開で登録（従来どおり全回登録している）
//   まだまだ！日向坂で会いましょう … あらすじに佐藤・優羽があれば公開、なければ下書き（Published=false）。
//                                   従来は一部の回だけ登録していたため、出演の判断を残す
//
// Date は配信開始日（JST）。月曜未明の配信は weekly さとうゆ側で前日（日曜）扱いに補正される。
// サムネイル（media）は直後の update_media_thumbnails.js が og:image から入れる。
// 年表（DB_HISTORY）と Yu News へは build.js の同期が公開分を自動で取り込む。
//
// 通常は直近 WINDOW_DAYS 日に配信が始まった回だけを見る（下書きを削除したときに復活させないため）。
// 過去分は LEMINO_SINCE=YYYY-MM-DD で一度だけ流す。
//
// 環境変数：NOTION_TOKEN / DB_LEMINO（必須）、LEMINO_SINCE（任意）、DRY_RUN=1（書き込まない）
const { Client } = require("@notionhq/client");

const PROGRAMS = [
  { name: "日向坂で会いましょう",           seed: "crid://plala.iptvf.jp/group/b10540a", publish: () => true },
  { name: "まだまだ！日向坂で会いましょう", seed: "crid://plala.iptvf.jp/group/b105418", publish: ep => /佐藤|優羽/.test(synopsis(ep)) },
];
const WINDOW_DAYS = 14;
const DRY_RUN = process.env.DRY_RUN === "1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID  = process.env.DB_LEMINO;

const b64      = crid => Buffer.from(crid).toString("base64");
const pageUrl  = crid => `https://lemino.docomo.ne.jp/contents/${b64(crid)}`;
const jstDate  = iso => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const synopsis = ep => (ep.synopsis_info && ep.synopsis_info.synopsis) || "";
const subtitle = ep => (synopsis(ep).match(/^【[^】]*】/) || [""])[0];
const epNumber = ep => (String(ep.title).match(/#\s*(\d+)/) || [])[1];

// 既存の URL は contents/<base64> と /?crid=<base64> の2形式があるので、crid に戻して比べる
function cridOf(url) {
  const m = String(url || "").match(/(?:contents\/|crid=)([A-Za-z0-9+/=%]+)/);
  if (!m) return null;
  try { return Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf-8"); } catch { return null; }
}

async function fetchGroup(crid) {
  const res = await fetch(pageUrl(crid), { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Lemino ${res.status} ${crid}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`__NEXT_DATA__ が見つからない ${crid}`);
  const items = JSON.parse(m[1]).props.pageProps.items || {};
  return { children: items.childrenContents || [], siblings: items.parentContents || [] };
}

async function episodesOf(program, since, now) {
  const seed = await fetchGroup(program.seed);
  // 起点と同じ番組の他クールのうち、配信が始まっていて since の前のクールまでを対象にする
  const groups = seed.siblings
    .filter(g => String(g.title).startsWith(program.name + "（") && g.availability_start <= now)
    .filter(g => g.availability_end >= since)
    .map(g => g.crid);
  if (!groups.includes(program.seed)) groups.push(program.seed);
  const eps = [];
  for (const crid of new Set(groups)) {
    const g = crid === program.seed ? seed : await fetchGroup(crid);
    eps.push(...g.children.filter(e => e.crid && e.crid.includes("/vod/")));
  }
  return eps.filter(e => e.availability_start && e.availability_start <= now && e.availability_start >= since);
}

async function existing() {
  const crids = new Set(), keys = new Set();
  let cursor;
  do {
    const r = await notion.databases.query({ database_id: DB_ID, start_cursor: cursor, page_size: 100 });
    for (const p of r.results) {
      const c = cridOf(p.properties.URL && p.properties.URL.url); if (c) crids.add(c);
      const prog = p.properties.Program && p.properties.Program.select && p.properties.Program.select.name;
      const num  = ((p.properties.Number && p.properties.Number.rich_text) || []).map(s => s.plain_text).join("").replace(/\D/g, "");
      if (prog && num) keys.add(`${prog}#${num}`);
    }
    cursor = r.has_more ? r.next_cursor : undefined;
  } while (cursor);
  return { crids, keys };
}

async function main() {
  if (!process.env.NOTION_TOKEN || !DB_ID) { console.log("NOTION_TOKEN / DB_LEMINO 未設定 → スキップ"); return; }
  const now   = new Date(Date.now() + 9 * 3600e3).toISOString().replace("Z", "+09:00");   // Lemino の日時表記（+09:00）に揃える
  const since = process.env.LEMINO_SINCE
    ? process.env.LEMINO_SINCE + "T00:00:00.000+09:00"
    : new Date(Date.now() + 9 * 3600e3 - WINDOW_DAYS * 86400e3).toISOString().replace("Z", "+09:00");
  const have = await existing();
  console.log(`Lemino 同期（配信開始 ${since.slice(0, 10)} 以降）/ 登録済み ${have.crids.size}件${DRY_RUN ? " [DRY_RUN]" : ""}`);

  for (const program of PROGRAMS) {
    let eps;
    try { eps = await episodesOf(program, since, now); }
    catch (e) { console.error(`  ❌ ${program.name}: ${e.message}`); continue; }
    for (const ep of eps.sort((a, b) => a.availability_start.localeCompare(b.availability_start))) {
      const num = epNumber(ep);
      const name = `${program.name} #${num} ${subtitle(ep)}`.trim();
      if (have.crids.has(ep.crid) || have.keys.has(`${program.name}#${num}`)) { console.log(`  ・登録済み: ${name}`); continue; }
      const publish = program.publish(ep);
      console.log(`  ${publish ? "✅ 公開で登録" : "📝 下書きで登録（出演を確認）"}: ${jstDate(ep.availability_start)} ${name}`);
      if (DRY_RUN) continue;
      const props = {
        Name:      { title: [{ text: { content: name } }] },
        Title:     { rich_text: [{ text: { content: subtitle(ep) } }] },
        Program:   { select: { name: program.name } },
        Number:    { rich_text: [{ text: { content: `#${num}` } }] },
        Date:      { date: { start: jstDate(ep.availability_start) } },
        URL:       { url: pageUrl(ep.crid) },
        Published: { checkbox: publish },
      };
      if (ep.availability_end) props["配信終了予定"] = { date: { start: jstDate(ep.availability_end) } };
      await notion.pages.create({ parent: { database_id: DB_ID }, properties: props });
      have.crids.add(ep.crid); have.keys.add(`${program.name}#${num}`);
    }
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
