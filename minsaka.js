// minsaka（ミンサカ）の主催企画の読み取りと、X 告知の下書きの文面。
// Node（notify_minsaka.js）とブラウザ（admin.html）の両方から使うので、文面はここだけで管理する。
// 文面を変えるときはこのファイルを直す。
(function (root) {
  const ORGANIZER_URL = "https://www.sakaseru.jp/mina/user/organized-events/244297";
  const EVENT_URL = id => `https://www.sakaseru.jp/mina/event/${id}`;

  const strip = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  // 主催企画一覧ページ（サーバー側で描画済みの HTML）から企画を取り出す
  function parseOrganizedEvents(html) {
    const out = [];
    const re = /<li>\s*<a href="\/mina\/event\/([0-9a-f]+)"[\s\S]*?<\/a>\s*<\/li>/g;
    let m;
    while ((m = re.exec(html))) {
      const li = m[0];
      const pick = r => { const x = li.match(r); return x ? strip(x[1]) : ""; };
      const limit = pick(/<p class="limit">([\s\S]*?)<\/p>/);
      let remainingDays = null;
      const d = limit.match(/残り\s*(\d+)\s*日/);
      if (d) remainingDays = +d[1];
      else if (/残り/.test(limit)) remainingDays = 0;          // 「残り ◯ 時間」など最終日
      const people = pick(/<!--参加人数 -->\s*<p>([\s\S]*?)<\/p>/);
      out.push({
        id: m[1],
        url: EVENT_URL(m[1]),
        title: pick(/<h3>([\s\S]*?)<\/h3>/),
        date: pick(/<p class="date">[\s\S]*?<\/span>([\s\S]*?)<\/p>/).replace(/^-$/, ""),
        place: pick(/<p class="place">[\s\S]*?<\/span>([\s\S]*?)<\/p>/),
        status: pick(/<p class="fukidashi">([\s\S]*?)<\/p>/),
        participants: +(people.match(/\d+/) || [0])[0],
        remainingDays,
        open: remainingDays != null,
      });
    }
    return out;
  }

  // 企画ページから1口の金額（例「1,500円」）を取る
  function parseUnitPrice(html) {
    const m = strip(html).match(/([\d,]+円)\s*\/?\s*口/);
    return m ? m[1] : "";
  }

  const head = ev => `『${ev.title}』`;
  const when = ev => [ev.date && `📅 ${ev.date}`, ev.place && `📍 ${ev.place}`].filter(Boolean).join("\n");

  const DRAFTS = {
    start: {
      label: "募集開始",
      text: ev => [
        "＼💐参加者大募集💐／", "",
        head(ev), "",
        when(ev), "",
        "#佐藤優羽 さんへのお祝いを一緒に贈りませんか？✨", "",
        ev.url, "",
        (ev.price ? `1口${ev.price}から！\n` : "") + "ご参加者のお名前はパネルに連名で記載させていただきます☀️", "",
        "#日向坂46",
      ].join("\n"),
    },
    remind: {
      label: "締め切りリマインド",
      text: ev => [
        ev.remainingDays === 0 ? "＼💐募集は本日まで！💐／" : `＼💐募集終了まであと${ev.remainingDays}日！💐／`, "",
        head(ev), "",
        `現在${ev.participants}名の方にご参加いただいています🙌`,
        "まだまだご参加お待ちしています✨", "",
        ev.url, "",
        "#佐藤優羽 #日向坂46",
      ].join("\n"),
    },
    thanks: {
      label: "募集終了・お礼",
      text: ev => [
        "＼💐ご参加ありがとうございました💐／", "",
        head(ev), "",
        `${ev.participants}名の皆さまにご参加いただき、募集を終了しました✨`,
        "お届けの様子はあらためてお知らせします☀️", "",
        ev.url, "",
        "#佐藤優羽 #日向坂46",
      ].join("\n"),
    },
  };

  const api = { ORGANIZER_URL, EVENT_URL, parseOrganizedEvents, parseUnitPrice, DRAFTS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Minsaka = api;
})(this);
