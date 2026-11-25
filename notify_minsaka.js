// minsaka の主催企画を見て、X 告知の下書きを Discord に送る（投稿は人が行う）。
//   新しい企画が募集中で現れた      → 募集開始の下書き
//   残り日数が REMIND_DAYS を切った → 締め切りリマインドの下書き（各しきい値で1回だけ）
//   募集中 → 募集終了 になった      → 募集終了・お礼の下書き
// あわせて minsaka.json（企画の一覧）を書き出し、管理ページの下書き画面が読む。
//
// 何を送ったかは minsaka-state.json に残す。GitHub Actions の実行環境は毎回消えるので、
// deploy.yml が VPS（/root/satoyu-state/）から取ってきて、終わったら書き戻す。
// state が無い初回は、今ある企画を「既知」として記録するだけで何も送らない（過去分を一斉に送らないため）。
// Webhook が未設定の間も state は進める（設定した瞬間に溜まった古い通知が届かないように）。
//
// 環境変数：DISCORD_WEBHOOK_URL（任意）、DRY_RUN=1（送信も state 更新もしない）
const fs = require("fs");
const { ORGANIZER_URL, parseOrganizedEvents, parseUnitPrice, DRAFTS } = require("./minsaka");
const { sendDiscord, codeBlock } = require("./discord");

const STATE_FILE = "minsaka-state.json";
const REMIND_DAYS = [7, 3, 1];
const DRY_RUN = process.env.DRY_RUN === "1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const get = async url => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`minsaka ${res.status} ${url}`);
  return res.text();
};

async function main() {
  const events = parseOrganizedEvents(await get(ORGANIZER_URL));
  if (!events.length) throw new Error("企画が1件も読み取れない（ページの構造が変わった可能性）");
  for (const ev of events.filter(e => e.open)) {
    try { ev.price = parseUnitPrice(await get(ev.url)); } catch { ev.price = ""; }
  }
  fs.writeFileSync("minsaka.json", JSON.stringify({ updated: new Date().toISOString(), events }, null, 1));

  const hasState = fs.existsSync(STATE_FILE);
  const state = hasState ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : { events: {} };
  const webhook = !!process.env.DISCORD_WEBHOOK_URL;
  console.log(`minsaka：企画${events.length}件（募集中${events.filter(e => e.open).length}件）/ state ${hasState ? "あり" : "なし（初回）"} / Discord ${webhook ? "送信あり" : "未設定"}${DRY_RUN ? " [DRY_RUN]" : ""}`);

  for (const ev of events) {
    const s = state.events[ev.id];
    const passed = REMIND_DAYS.filter(d => ev.open && ev.remainingDays <= d);   // もう過ぎたしきい値
    let kind = null;
    if (!s) kind = hasState && ev.open ? "start" : null;
    else if (s.open && !ev.open) kind = "thanks";
    else if (ev.open && passed.some(d => !(s.reminded || []).includes(d))) kind = "remind";

    if (kind) {
      const text = DRAFTS[kind].text(ev);
      console.log(`  📨 ${DRAFTS[kind].label}: ${ev.title}`);
      if (DRY_RUN) { console.log(text.replace(/^/gm, "    | ")); continue; }
      if (webhook) {
        try { await sendDiscord(`🌸 **minsaka：${DRAFTS[kind].label}の下書き**\n${codeBlock(text)}`); }
        catch (e) { console.error(`  ❌ ${e.message}`); continue; }   // 失敗したら state を進めず、次の実行で再送
      }
    }
    // 開始の通知を出した直後にリマインドが重ならないよう、過ぎたしきい値は送ったことにする
    state.events[ev.id] = { title: ev.title, open: ev.open, reminded: [...new Set([...((s && s.reminded) || []), ...passed])] };
  }
  if (!DRY_RUN) fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
