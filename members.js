// 日向坂46 現役メンバー（佐藤優羽さんを除く）の誕生日とサイリウムカラー。
// お誕生日のお祝いポストの下書き（notify_birthday.js）で使う。
// ＼💚Happy Birthday!!💜／ のハートはサイリウムカラー（左×右）に合わせる。
//
// 出典（2026-11-25 確認）
//   名前・誕生日：日向坂46公式サイトのメンバーページ
//   五期生のカラー：公式ニュース「五期生のサイリウムカラーが決定！」
//   二〜四期生のカラー：sakamichi-db.com「日向坂46 コール名・サイリウムカラー一覧」
// 卒業・加入があったら、ここを直す。
const MEMBERS = [
  // 二期生
  { name: "金村美玖",   birthday: "2002-09-10", gen: 2, colors: ["パステルブルー", "イエロー"] },
  { name: "小坂菜緒",   birthday: "2002-09-07", gen: 2, colors: ["ホワイト", "バイオレット"] },
  // 三期生
  { name: "上村ひなの", birthday: "2004-04-12", gen: 3, colors: ["エメラルドグリーン", "レッド"] },
  { name: "髙橋未来虹", birthday: "2003-09-27", gen: 3, colors: ["グリーン", "パープル"] },
  { name: "森本茉莉",   birthday: "2004-02-23", gen: 3, colors: ["オレンジ", "ブルー"] },
  // 四期生
  { name: "石塚瑶季",   birthday: "2004-08-06", gen: 4, colors: ["サクラピンク", "オレンジ"] },
  { name: "小西夏菜実", birthday: "2004-10-03", gen: 4, colors: ["パープル", "ブルー"] },
  { name: "清水理央",   birthday: "2005-01-15", gen: 4, colors: ["パステルブルー", "ピンク"] },
  { name: "正源司陽子", birthday: "2007-02-14", gen: 4, colors: ["オレンジ", "レッド"] },
  { name: "竹内希来里", birthday: "2006-02-20", gen: 4, colors: ["イエロー", "レッド"] },
  { name: "平尾帆夏",   birthday: "2003-07-31", gen: 4, colors: ["パステルブルー", "オレンジ"] },
  { name: "平岡海月",   birthday: "2002-04-09", gen: 4, colors: ["ブルー", "イエロー"] },
  { name: "藤嶌果歩",   birthday: "2006-08-07", gen: 4, colors: ["サクラピンク", "ブルー"] },
  { name: "宮地すみれ", birthday: "2005-12-31", gen: 4, colors: ["バイオレット", "レッド"] },
  // 2026-10-25 から変更（旧：エメラルドグリーン×ホワイト）。本人ブログ diary/detail/71493 で 💚🩷 と表記
  { name: "山下葉留花", birthday: "2003-05-20", gen: 4, colors: ["エメラルドグリーン", "サクラピンク"] },
  { name: "渡辺莉奈",   birthday: "2009-02-07", gen: 4, colors: ["ブルー", "ホワイト"] },
  // 五期生（佐藤優羽さんの同期）
  { name: "大田美月",   birthday: "2006-12-07", gen: 5, colors: ["サクラピンク", "ピンク"] },
  { name: "大野愛実",   birthday: "2007-05-05", gen: 5, colors: ["レッド", "レッド"] },
  { name: "片山紗希",   birthday: "2006-12-26", gen: 5, colors: ["パステルブルー", "パステルブルー"] },
  { name: "蔵盛妃那乃", birthday: "2006-01-23", gen: 5, colors: ["サクラピンク", "レッド"] },
  { name: "坂井新奈",   birthday: "2009-03-14", gen: 5, colors: ["ホワイト", "ホワイト"] },
  { name: "下田衣珠季", birthday: "2006-12-26", gen: 5, colors: ["パステルブルー", "エメラルドグリーン"] },
  { name: "高井俐香",   birthday: "2007-08-01", gen: 5, colors: ["パープル", "イエロー"] },
  { name: "鶴崎仁香",   birthday: "2004-03-27", gen: 5, colors: ["イエロー", "オレンジ"] },
  { name: "松尾桜",     birthday: "2005-06-08", gen: 5, colors: ["サクラピンク", "ホワイト"] },
];

// サイリウムカラー → ハートの絵文字
const HEART = {
  "サクラピンク": "🩷", "ピンク": "🩷", "レッド": "❤️", "オレンジ": "🧡", "イエロー": "💛",
  "グリーン": "💚", "エメラルドグリーン": "💚", "パステルブルー": "🩵", "ブルー": "💙",
  "パープル": "💜", "バイオレット": "💜", "ホワイト": "🤍",
};

// お祝いポストの下書き（参考：髙橋未来虹さん・小西夏菜実さんの投稿）。
// 先輩には「先輩」、同期（五期生）には「さん」。真ん中のひとことは人が書く
function birthdayDraft(m, year) {
  const [, mm, dd] = m.birthday.split("-").map(Number);
  const [l, r] = m.colors.map(c => HEART[c] || "💚");
  return [
    `＼${l}Happy Birthday!!${r}／`, "",
    `本日、${mm}月${dd}日は、`,
    `#${m.name} ${m.gen < 5 ? "先輩" : "さん"}のお誕生日！！`,
    "おめでとうございます🎉", "",
    "（ひとことメッセージ）",
    "素敵な1年となりますように✨", "",
    `#${m.name}生誕祭${year}`,
    "#日向坂46",
  ].join("\n");
}

// JST の今日から見た次の誕生日（{ date: "YYYY-MM-DD", year, days }）
function nextBirthday(m, now = new Date()) {
  const jst = new Date(now.getTime() + 9 * 3600e3);
  const today = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
  const [, mm, dd] = m.birthday.split("-").map(Number);
  let year = jst.getUTCFullYear();
  if (Date.UTC(year, mm - 1, dd) < today) year++;
  const t = Date.UTC(year, mm - 1, dd);
  return { date: new Date(t).toISOString().slice(0, 10), year, days: Math.round((t - today) / 86400e3) };
}

module.exports = { MEMBERS, HEART, birthdayDraft, nextBirthday };
