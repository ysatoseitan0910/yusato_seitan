// 他メンバーのお誕生日の3日前から、お祝いポストの下書きを Discord「他メンバーお誕生日」スレッドに送る。
// お祝いポストは誕生日の 0:00 に投稿しているので、前もって届くようにしている。各メンバー・各年1回だけ。
// 送った記録は state/birthday-sent.json（deploy.yml が VPS と行き来させる）。
//
// 使い方：
//   node notify_birthday.js                 … 通常（3日以内の誕生日を送る）
//   BIRTHDAY_WITHIN=95 node notify_birthday.js … 先の分までまとめて送る（送った分は通常実行で重複しない）
// 環境変数：DISCORD_WEBHOOK_URL、DRY_RUN=1
const fs = require("fs");
const { MEMBERS, birthdayDraft, nextBirthday } = require("./members");
const { sendDiscord, codeBlock, THREADS } = require("./discord");

const STATE_FILE = "state/birthday-sent.json";
const WITHIN = +(process.env.BIRTHDAY_WITHIN || 3);
const DRY_RUN = process.env.DRY_RUN === "1";

async function main() {
  let sent;
  try { sent = new Set(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).sent); } catch { sent = new Set(); }
  const webhook = !!process.env.DISCORD_WEBHOOK_URL;
  const due = MEMBERS.map(m => ({ m, nb: nextBirthday(m) }))
    .filter(x => x.nb.days <= WITHIN && !sent.has(`${x.m.name}-${x.nb.year}`))
    .sort((a, b) => a.nb.days - b.nb.days);
  console.log(`お誕生日：${WITHIN}日以内で未送信 ${due.length}件${DRY_RUN ? " [DRY_RUN]" : ""}`);

  for (const { m, nb } of due) {
    const [, mm, dd] = nb.date.split("-").map(Number);
    const draft = birthdayDraft(m, nb.year);
    const when = nb.days === 0 ? "本日" : `${nb.days}日後`;
    console.log(`  🎂 ${mm}/${dd} ${m.name}（${when}）`);
    if (DRY_RUN) { console.log(draft.replace(/^/gm, "    | ")); continue; }
    if (!webhook) continue;
    try {
      await sendDiscord(`🎂 **${mm}月${dd}日（${when}）${m.name}${m.gen < 5 ? "先輩" : "さん"}のお誕生日：お祝いポストの下書き**\n${codeBlock(draft)}`, [], THREADS.birthday);
      sent.add(`${m.name}-${nb.year}`);
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) { console.error(`  ❌ ${e.message}`); }
  }
  if (!DRY_RUN) {
    fs.mkdirSync("state", { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: [...sent].slice(-200) }));
  }
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
