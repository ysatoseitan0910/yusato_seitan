// Discord の各スレッドへ過去分をまとめて送る（手動ワークフロー discord-backfill.yml から実行）。
//   blogdraft：直近 N 件のブログの告知下書き → ブログ告知用
//   blogphoto：直近 N 件のブログの写真（タイトル・URL付き） → ブログ写真
//   flower   ：minsaka で募集中の企画の告知文案 → 祝花
// 他メンバーブログ・お誕生日は、それぞれのスクリプトを環境変数つきで実行する（ワークフロー側）。
// 使い方：node discord_backfill.js blogdraft 3 / blogphoto 10 / flower
const { sendBlogDraft, sendBlogPhotos, sendDiscord, codeBlock, THREADS } = require("./discord");
const { ORGANIZER_URL, parseOrganizedEvents, parseUnitPrice, parseIntro, DRAFTS } = require("./minsaka");

const UA = { headers: { "User-Agent": "Mozilla/5.0" } };
const wait = ms => new Promise(r => setTimeout(r, ms));

// サイトのブログまとめ（新しい順）からタイトル・日付・URL を取る
async function recentBlogs(n) {
  const html = await (await fetch("https://satoyu.info/blog.html", UA)).text();
  const out = [];
  const re = /<p class="media-title"[^>]*>([\s\S]*?)<\/p>[\s\S]*?<span class="media-date">([^<]*)<\/span>\s*<a href="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    out.push({ title: m[1].replace(/&amp;/g, "&").trim(), date: m[2].trim().replace(/\./g, "-"), url: m[3].replace(/&amp;/g, "&") });
  }
  return out.reverse();                                   // 古い順に送る
}

async function main() {
  if (!process.env.DISCORD_WEBHOOK_URL) throw new Error("DISCORD_WEBHOOK_URL が未設定です");
  const [task, nArg] = process.argv.slice(2);
  const n = +(nArg || 3);
  if (task === "blogdraft") {
    for (const a of await recentBlogs(n)) { await sendBlogDraft(a); console.log(`✅ 下書き: ${a.date} ${a.title}`); await wait(1200); }
  } else if (task === "blogphoto") {
    for (const a of await recentBlogs(n)) { const k = await sendBlogPhotos(a); console.log(`✅ 写真${k}枚: ${a.date} ${a.title}`); await wait(1500); }
  } else if (task === "flower") {
    const events = parseOrganizedEvents(await (await fetch(ORGANIZER_URL, UA)).text()).filter(e => e.open);
    for (const ev of events) {
      const h = await (await fetch(ev.url, UA)).text();
      ev.price = parseUnitPrice(h); ev.intro = parseIntro(h);
      await sendDiscord(`🌸 **minsaka：${DRAFTS.start.label}の下書き**（残り${ev.remainingDays}日・現在${ev.participants}人）\n${codeBlock(DRAFTS.start.text(ev))}`, [], THREADS.flower);
      console.log(`✅ 祝花: ${ev.title}`); await wait(1200);
    }
  } else throw new Error("task は blogdraft / blogphoto / flower");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
