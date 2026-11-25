// Discord 通知の「送った記録」（state/*.json）を VPS へ書き戻す前に、VPS 側の最新とまとめる。
// deploy.yml と discord-backfill.yml が同時に動いたとき、後から書いた方が先の記録を消さないようにするため。
//   ids / sent（配列）     … 両方を合わせる
//   minsaka-state.json    … deploy.yml だけが更新するので、手元のものをそのまま使う
// 使い方：node merge_state.js <VPSから取ってきたディレクトリ> <手元の state ディレクトリ>
const fs = require("fs");
const path = require("path");
const [remoteDir, localDir] = process.argv.slice(2);

for (const f of fs.existsSync(localDir) ? fs.readdirSync(localDir) : []) {
  const lp = path.join(localDir, f), rp = path.join(remoteDir, f);
  if (!f.endsWith(".json") || !fs.existsSync(rp)) continue;
  try {
    const l = JSON.parse(fs.readFileSync(lp, "utf8")), r = JSON.parse(fs.readFileSync(rp, "utf8"));
    for (const key of ["ids", "sent"]) {
      if (Array.isArray(l[key]) && Array.isArray(r[key])) l[key] = [...new Set([...r[key], ...l[key]])];
    }
    fs.writeFileSync(lp, JSON.stringify(l));
  } catch (e) { console.error(`merge skip ${f}: ${e.message}`); }
}
