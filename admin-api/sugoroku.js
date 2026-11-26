// さとうゆすごろく（sugoroku.html）のサーバー側。ルールとマスの文面はこのファイルだけで管理する。
//
// ランキングの不正を防ぐため、ゲームの進行はすべてサーバーが行う（ブラウザは結果を動かして見せるだけ）。
// ・状態は署名つきトークン（HMAC）でブラウザに持たせる → サーバーに保存しないので再起動しても続けられる
// ・サイコロの目は「ゲームID・手番・誰か」から決まる → 古いトークンを送り直しても同じ目しか出ない（振り直し不可）
// ・ランキングはゴールしたトークンでだけ登録でき、同じゲームは1回しか登録できない
//
// ルール：あなた vs コンピューター。交互にサイコロを振り、止まったマスの指示に従う（指示で移動した先の指示は無視）。
//   ゴールはぴったりでなくてよい。先にゴールした方の勝ち。コンピューターが先にゴールしても、あなたはゴールまで続けられる。
//   ランキングは「あなたがサイコロを振った回数」が少ない順（5/1 の偶数・奇数を決めるサイコロは数えない）。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// effect：+n＝nマス進む／-n＝nマス戻る／{rest:n}＝n回休み／"start"＝ふりだしに戻る／"parity"＝偶数なら無事・奇数ならふりだし
const SQUARES = [
  null,
  // ── 前半（board1）──
  { date: "2025年3月10日", title: "日向坂ちゃんねる「日向坂46 五期生 ティザームービー」", text: "日向坂人生のスタート。楽しむぞ！" },
  { date: "2025年4月5日・6日", title: "「6回目のひな誕祭」at 横浜スタジアム（2days）", text: "初お披露目で大緊張。1回休み。", effect: { rest: 1 } },
  { date: "2025年4月21日", title: "日向坂で会いましょう「行くぞ!!五期生 go HAPPY プロフィール紹介」", text: "薙刀を披露で褒められる。1マス進む。", effect: 1 },
  { date: "2025年4月28日", title: "東京ニュース通信社「B.L.T.」2025年6月号" },
  { date: "2025年5月15日", title: "「ジャーマンアイリス」Music Video" },
  { date: "2025年5月27日", title: "五期生「おもてなし会」at 国立代々木競技場第一体育館", text: "初ライブで熱演し、疲れが。2マス戻る。", effect: -2 },
  { date: "2025年5月28日", title: "BRAND NEW LIVE 2025「OVER THE RAINBOW」（2days）" },
  { date: "2025年6月13日", title: "日向坂ちゃんねる「日向坂46 五期生・佐藤優羽【リレー生配信8人目】」" },
  { date: "2025年7月25日", title: "日向坂ちゃんねる「【ミッションに挑戦】福岡のこと、もっと知りたいっちゃん！」", text: "福岡を猛アピールして疲れが。1回休み。", effect: { rest: 1 } },
  { date: "2025年7月15日", title: "佐藤優羽個人PV『麻雀 in Yu Mind』公開", text: "麻雀にハマって徹夜。1回休み。", effect: { rest: 1 } },
  { date: "2025年8月15日", title: "日向坂で会いましょう「五期生 運動能力チェック祭！」", text: "腕立て伏せが1回もできず噂状態に。1回休み。", effect: { rest: 1 } },
  { date: "2025年8月15日", title: "日向坂46『空飛ぶ車』MUSIC VIDEO 公開" },
  { date: "2025年9月10日", title: "佐藤優羽 19歳のお誕生日", text: "加入後初めての誕生日を盛大にお祝い。2マス進む。", effect: 2 },
  { date: "2025年9・10・11月", title: "ARENA TOUR 2025「MONSTER GROOVE」" },
  { date: "2025年10月1日", title: "五期生メンバー個人ブログ開始！", text: "ブログに書きたいことがありすぎる！悩む。1回休み。", effect: { rest: 1 } },
  { date: "2025年10月19日", title: "UNI'S ON AIR に五期生が登場！" },
  { date: "2025年10月19日", title: "リアルミート＆グリートでアスカのコスプレ", text: "コスプレイヤーとしての血が騒いで衣装を探し続ける。1マス戻る。", effect: -1 },
  { date: "2025年10月20日", title: "日向坂ちゃんねる「もぐもぐASMR【エンジェルボイス】」", text: "ASMRで睡魔が襲う。1回休み。", effect: { rest: 1 } },
  { date: "2025年10月21日", title: "加藤史帆さんから「エンジェルボイス」認定", text: "天使としての才能開花。2マス進む。", effect: 2 },
  { date: "2025年10月23日", title: "BRODY 12月号 発売 メディア（BRODY）賞", text: "世間に認められた瞬間。1マス進む。", effect: 1 },
  { date: "2025年10月26日", title: "日向坂で会いましょう【五期生の素顔を知ろう！抜き打ち家族アンケート】", text: "どんぐりダンスで大混乱。1回休み。", effect: { rest: 1 } },
  { date: "2025年10月31日", title: "BUBUKA 2025年12月号 発売" },
  { date: "2025年10月", title: "ツアーでたこ焼きに大ハマリ", text: "たこ焼き食べすぎちゃった。1マス戻る。", effect: -1 },
  { date: "2025年11月1日", title: "五期生が日向坂46メッセージを開始", text: "メッセージが大好評。2マス進む。", effect: 2 },
  { date: "2025年11月16日", title: "日向坂になりましょう－五期生成長バラエティ－【人情あふれる街ブラロケに挑戦しよう！】" },
  { date: "2025年11月17日", title: "最終オーディションから1年" },
  { date: "2025年11月", title: "新参者", text: "A/Bセトリで疲れる。1回休み。", effect: { rest: 1 } },
  { date: "2025年12月", title: "16thシングル「クリフハンガー」で五期生が選抜・ひなた坂に分かれる", text: "選抜に入れない悔しさ。2マス戻る。", effect: -2 },
  { date: "2026年1月12日", title: "日向坂になりましょう－五期生成長バラエティ－【お正月なのでバラエティ対決で盛り上がろう！】", text: "即興大喜利。会場が笑ったら3マス進む。", effect: 3 },
  { date: "2026年1月15日", title: "日向坂46『君と生きる』MUSIC VIDEO" },
  { date: "2026年1月25日", title: "LAWSON 50th Anniversary presents Special LIVE ～櫻坂46 / 日向坂46～", text: "櫻坂さんのライブの凄さに驚愕。1マス進む。", effect: 1 },
  { date: "2026年1月26日", title: "日向坂46『好きになるクレッシェンド』MUSIC VIDEO", text: "ゆうちゃんの大コール。1マス進む。", effect: 1 },
  { date: "2026年1月26日", title: "松田好花卒業セレモニーで「このちゃんの天使」になる", text: "天使としての活動が身を結ぶ。3マス進む。", effect: 3 },
  { date: "2026年2月9日", title: "日向坂で会いましょう「アイドル番組を忘れるな！ドキドキ妄想告白シチュエーション」", text: "SENAさんとイチャイチャ。1マス進む。", effect: 1 },
  { date: "2026年2月17日・18日", title: "16th Single ひなた坂46 LIVE" },
  { date: "2026年2月22日", title: "猫の国から自転車で「にゃとうゆ」がやってきた", text: "さとうゆがにゃとうゆに。可愛すぎて2回休み。", effect: { rest: 2 } },
  { date: "2026年3月10日", title: "「一年目、輝きを目に焼き付けた日々。」日向坂46加入1周年。", text: "1年の思い出を報告 → 1マス進む。", effect: 1 },
  { date: "2026年3月29日", title: "日向坂で会いましょう【まもなく加入1年！五期生殻破り道場！】", text: "どこでもドアーが間違った場所に。4マス戻る。", effect: -4 },
  { date: "2026年3月", title: "初めてのあだ名タオル「さとうゆ」" },
  { date: "2026年4月4日", title: "7回目のひな誕祭初日", text: "デコ出しが好評。1マス進む。", effect: 1 },
  // ── 後半（board2）──
  { date: "2026年4月8日", title: "ブログ『新しいことが始まる時の期待はどの感情なのか？』", text: "選抜に入れない悔しさ。2マス戻る。", effect: -2 },
  { date: "2026年5月1日", title: "日向坂46 佐藤優羽『ああゆう こうゆう さとうゆう』", text: "サイコロを振り偶数なら無罪。奇数なら有罪（スタートに戻る）。", effect: "parity" },
  { date: "2026年5月1日", title: "ブログ「気になってしまう、どうしても。」", text: "デスクが壊れる。1マス戻る。", effect: -1 },
  { date: "2026年5月4日", title: "日向坂になりましょう－五期生成長バラエティ－【#22 私たちもボイトレで歌唱力を強化しましょう！】" },
  { date: "2026年5月15日", title: "日向坂46『Empty』MUSIC VIDEO" },
  { date: "2026年5月17日", title: "ひなこい後援イベント", text: "たこ焼きを焼こうとするも、野次を飛ばされる。1回休み。", effect: { rest: 1 } },
  { date: "2026年5月18日", title: "「B.L.T.」2026年7月号" },
  { date: "2026年5月18日", title: "日向坂46『円周率』MUSIC VIDEO", text: "5期生曲センター。魅力を最大限に表現。4マス進む。", effect: 4 },
  { date: "2026年5月24日", title: "ながおか米百俵フェス ～花火と食と音楽と～ 2026", text: "お米が美味しすぎて食べすぎた。1回休み。", effect: { rest: 1 } },
  { date: "2026年5月1日", title: "17thミート＆グリートを初めて欠席", text: "体調管理の難しさを実感。1回休み。", effect: { rest: 1 } },
  { date: "2026年6月8日", title: "日向坂で会いましょう「日向坂46 最新相関図！＆軍団再編総選挙！」", text: "524FABULOUS最強☆柱軍団の特攻隊長に。2マス進む。", effect: 2 },
  { date: "2026年6月16日・17日", title: "17th Single ひなた坂46 LIVE（2days）" },
  { date: "2026年6月23日", title: "『BRODY』8月号" },
  { date: "2026年6月28日", title: "テレ東音楽祭2026初夏 日向坂五期生テレビ初パフォーマンス" },
  { date: "2026年6月30日", title: "「円周率」MUSIC VIDEO が100万回再生", text: "円周率が大好評。1マス進む。", effect: 1 },
  { date: "2026年7月5日", title: "ミーグリで毎部髪型を変える", text: "髪型変更で大混乱。3マス戻る。", effect: -3 },
  { date: "2026年7月12日", title: "日向坂で会いましょう【ライバル多すぎ問題 なんでもランキング】", text: "こさかなのハートを掴む。2マス進む。", effect: 2 },
  { date: "2026年7月16日・17日", title: "五期生LIVE at ぴあアリーナMM", text: "5期生ライブを無事にやり遂げる。1マス進む。", effect: 1 },
  { date: "2026年8月9日", title: "18thシングルで表題曲選抜メンバーに選ばれる", text: "努力が実を結び初選抜。3マス進む。", effect: 3 },
  { date: "2026年8月12日", title: "ブログ「記念日は大切にするタイプ。」", text: "ブログ更新100回目。1マス進む。", effect: 1 },
  { date: "2026年8月15日", title: "YouTube「優羽がいた夏」（彼女役で出演）", text: "カイくんをみっちゃんと呼び間違える。3マス戻る。", effect: -3 },
  { date: "2026年8月16日", title: "ブログ「どっちが先に言う？」", text: "ツラミが美味しすぎてお腹いっぱいに。1回休み。", effect: { rest: 1 } },
  { date: "2026年9月1日", title: "「イチャイチャ虫」MV 公開", text: "初選抜曲が大好評。1マス進む。", effect: 1 },
  { date: "2026年9月5日・6日", title: "ひなたフェス", text: "中止の知らせが届いて、青ざめる。ふりだしに戻る。", effect: "start" },
  { date: "2026年9月10日", title: "佐藤優羽 20歳のお誕生日", text: "自分の行動に責任が生まれることを自覚。1マス進む。", effect: 1 },
  { date: "2026年9月20日", title: "『IDOL RUNWAY COLLECTION 2026 AUTUMN/WINTER Supported by TGC』", text: "初ランウェイで大緊張。ふりだしに戻る。", effect: "start" },
  { date: "2026年9月30日", title: "初選抜となるシングルが発売される", text: "イチャイチャしすぎて疲れた。1回休み。", effect: { rest: 1 } },
  { date: "ゴール", title: "ゴール！", text: "これからも日向坂46の佐藤優羽をよろしくお願いします！" },
];
const GOAL = SQUARES.length - 1;   // 68

// マスに関連するリンク（ヒストリー DB の登録から、日付と内容が合うものを選んだ。2026-11-26）。
// 種類はブラウザ側で URL から判定してボタンの文言を変える（YouTube／Lemino／ブログ／公式サイト など）。
// 同じ種類が並ぶときは { u: URL, label: "前半" } のように補足を付ける
const Y = id => `https://www.youtube.com/watch?v=${id}`;
const L = c => `https://lemino.docomo.ne.jp/contents/${c}`;
const BLOG = id => `https://www.hinatazaka46.com/s/official/diary/detail/${id}?ima=0000&cd=member`;
const PAGE = p => `https://www.hinatazaka46.com/s/official/page/${p}`;
const LINKS = {
  1: [Y("509d3942xJs")],
  2: [PAGE("6th-anniversary")],
  4: ["https://zasshi.tv/products/51649/"],
  5: [Y("F-16wnHQLLw")],
  6: [PAGE("5th_omotenashi")],
  7: [PAGE("over_the_rainbow")],
  8: [Y("aLwWR9C1cus")],
  9: [Y("j1qLcPOrEPw")],
  10: [Y("aqDMzy2w7TU")],
  11: [{ u: L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWI4bzNsNDY="), label: "前半" }, { u: L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWI4bzNsdTE="), label: "後半" }],
  12: [Y("YyGPXrzvfYk")],
  14: [PAGE("tour2025")],
  15: [BLOG(65925)],
  16: [BLOG(66205)],
  18: [Y("s83NHIJ3D4c")],
  20: ["https://www.byakuya-shobo.co.jp/book/b10152629.html"],
  21: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWV0cXZocGM=")],
  22: ["https://www.byakuya-shobo.co.jp/book/b10153204.html"],
  25: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWV1czEzdXo=")],
  26: [BLOG(66754)],
  27: [PAGE("shinzanmono2025")],
  28: [PAGE("16th_single?ima=0000")],
  29: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWltamtkY28=")],
  30: [Y("2WEOnuwvoXE")],
  31: ["https://l-tike.com/concert/lawson50th_260125/"],
  32: [Y("MlNNxI0MNDI")],
  33: [PAGE("km_graduation_ceremony")],
  34: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWltaHM3M28=")],
  35: [PAGE("16thSG_hiraganalive")],
  37: [BLOG(68296)],
  38: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbWltaHNjMDY=")],
  40: [PAGE("7th-anniversary?ima=0000"), BLOG(68826)],
  41: [BLOG(68875)],
  43: [BLOG(69127)],
  44: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbW04ajdvNDA=")],
  45: [Y("SileUBDdAqU")],
  47: ["https://zasshi.tv/products/58779/"],
  48: [Y("5lBX4kt4eUI"), BLOG(69373)],
  49: ["https://www.hinatazaka46.com/s/official/media/detail/11681?ima=0000"],
  51: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL3ZvZC8wMDAwMDAwMDAwXzAwbW04aHM1dW0=")],
  52: [PAGE("17thSG_hiraganalive?ima=0000")],
  53: ["https://www.byakuya-shobo.co.jp/book/b10171452.html"],
  54: ["https://www.tv-tokyo.co.jp/plus/entertainment/entry/202606/19451.html"],
  55: [Y("5lBX4kt4eUI")],
  57: [L("Y3JpZDovL3BsYWxhLmlwdHZmLmpwL2dyb3VwL2IxMDRlZGM=")],
  58: [PAGE("5th_generation_live")],
  59: [PAGE("18th_single?ima=0000")],
  60: [BLOG(70555)],
  61: [Y("UC1D0U0s8tw")],
  62: [BLOG(70609)],
  63: [PAGE("18th_single?ima=0000")],
  64: [Y("OAM2ulVoa4Y")],
  65: [BLOG(70958)],
  67: [PAGE("18th_single?ima=0000")],
};
const START = 1;

const SECRET = crypto.createHash("sha256").update("satoyu-sugoroku:" + (process.env.ADMIN_PASSWORD || "")).digest();
const b64u = b => Buffer.from(b).toString("base64url");
const sign = s => crypto.createHmac("sha256", SECRET).update(s).digest("base64url");
function encode(st) { const body = b64u(JSON.stringify(st)); return body + "." + sign(body); }
function decode(tok) {
  if (typeof tok !== "string" || tok.length > 2000) return null;
  const [body, mac] = tok.split(".");
  if (!body || !mac) return null;
  const a = Buffer.from(sign(body)), b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
}
// サイコロ：ゲームID・手番・誰・何個目 から決まる 1〜6
function die(st, who, k) {
  const h = crypto.createHmac("sha256", SECRET).update(`${st.g}:${st.t}:${who}:${k}`).digest();
  return (h.readUInt32BE(0) % 6) + 1;
}

// 1人分の手番。events に動きを積む
function play(st, who, ev) {
  const P = who === "you" ? "p" : "c", R = who === "you" ? "pr" : "cr";
  if (st[P] >= GOAL) return;
  if (st[R] > 0) { st[R]--; ev.push({ who, type: "rest", left: st[R] }); return; }
  const d = die(st, who, 0);
  if (who === "you") st.r++;
  const from = st[P];
  st[P] = Math.min(GOAL, from + d);
  ev.push({ who, type: "roll", dice: d, from, to: st[P] });
  if (st[P] >= GOAL) { reachGoal(st, who, ev); return; }
  const e = SQUARES[st[P]].effect;
  if (e == null) return;
  const at = st[P];
  if (typeof e === "number") {
    st[P] = Math.max(START, Math.min(GOAL, at + e));
    ev.push({ who, type: "effect", kind: e > 0 ? "forward" : "back", n: Math.abs(e), from: at, to: st[P] });
    if (st[P] >= GOAL) reachGoal(st, who, ev);
  } else if (e === "start") {
    st[P] = START;
    ev.push({ who, type: "effect", kind: "start", from: at, to: START });
  } else if (e === "parity") {
    const d2 = die(st, who, 1);
    const ok = d2 % 2 === 0;
    if (!ok) st[P] = START;
    ev.push({ who, type: "effect", kind: "parity", dice: d2, ok, from: at, to: st[P] });
  } else if (e.rest) {
    st[R] += e.rest;
    ev.push({ who, type: "effect", kind: "rest", n: e.rest, from: at, to: at });
  }
}
function reachGoal(st, who, ev) {
  if (!st.w) st.w = who;
  ev.push({ who, type: "goal", winner: st.w === who });
}

// ── ランキング（Basic 認証のかかった uploads/cards 配下に置く。公開は API 経由のみ） ──
const RANK_FILE = process.env.SUGOROKU_RANK_FILE || "/var/www/satoyu/uploads/cards/sugoroku/ranking.json";
function loadRanking() { try { return JSON.parse(fs.readFileSync(RANK_FILE, "utf8")); } catch { return { list: [], games: [] }; } }
function saveRanking(r) {
  fs.mkdirSync(path.dirname(RANK_FILE), { recursive: true });
  fs.writeFileSync(RANK_FILE + ".tmp", JSON.stringify(r));
  fs.renameSync(RANK_FILE + ".tmp", RANK_FILE);
}
const sorted = list => list.slice().sort((a, b) => a.rolls - b.rolls || a.at.localeCompare(b.at));
const publicRow = (x, i) => ({ rank: i + 1, name: x.name, rolls: x.rolls, won: x.won, date: x.at.slice(0, 10) });

// ── Lemino の配信状況 ──
// Lemino は配信期間（1〜2年）が過ぎると、番組ページの __NEXT_DATA__ から番組情報（items.item）が消える。
// 番組情報が無い／配信終了日を過ぎている回を「非公開」とし、リンクは残したまま（現在非公開）と表示する。
// 6時間ごとに確かめ直す。取得に失敗した回は「非公開」にしない（一時的な通信エラーで誤表示しないため）
const LEMINO_TTL = 6 * 3600e3;
let leminoCache = { at: 0, closed: new Set(), pending: null };
async function leminoClosed() {
  if (Date.now() - leminoCache.at < LEMINO_TTL) return leminoCache.closed;
  if (leminoCache.pending) return leminoCache.pending;
  const urls = [...new Set(Object.values(LINKS).flat().map(x => typeof x === "string" ? x : x.u).filter(u => /lemino\.docomo/.test(u)))];
  leminoCache.pending = (async () => {
    const closed = new Set();
    await Promise.all(urls.map(async u => {
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 10000);
        const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0" }, signal: ctl.signal });
        clearTimeout(tm);
        if (r.status === 404) { closed.add(u); return; }   // 配信が終わった回はページ自体が 404 になる（2026-11-26 確認）
        if (!r.ok) return;
        const m = (await r.text()).match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!m) return;
        const item = ((JSON.parse(m[1]).props.pageProps || {}).items || {}).item;
        if (!item || (item.availability_end && new Date(item.availability_end) < new Date())) closed.add(u);
      } catch { /* 失敗した回は非公開扱いにしない */ }
    }));
    leminoCache = { at: Date.now(), closed, pending: null };
    return closed;
  })();
  return leminoCache.pending;
}

// IP ごとの簡単な回数制限
const rate = new Map();
function limited(ip, key, max, windowMs) {
  const k = key + ":" + ip, now = Date.now();
  const arr = (rate.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); rate.set(k, arr);
  if (rate.size > 5000) rate.clear();
  return arr.length > max;
}

function register(app, auth) {
  app.get("/sugoroku/board", async (req, res) => {
    let closed = new Set();
    try { closed = await leminoClosed(); } catch (e) { console.error("lemino check:", e.message); }
    // リンクは { u, label?, closed? } に揃えて返す。closed＝Lemino で配信が終わっている（ブラウザ側で「（現在非公開）」と付ける）
    const norm = x => (typeof x === "string" ? { u: x } : { ...x });
    res.json({ goal: GOAL, squares: SQUARES.map((s, i) => s && {
      date: s.date, title: s.title, text: s.text || "",
      links: (LINKS[i] || []).map(norm).map(l => closed.has(l.u) ? { ...l, closed: true } : l),
    }) });
  });

  app.post("/sugoroku/start", (req, res) => {
    if (limited(req.ip, "start", 120, 3600e3)) return res.status(429).json({ error: "しばらく時間をおいてからお試しください" });
    const st = { g: crypto.randomBytes(9).toString("base64url"), t: 0, p: START, c: START, pr: 0, cr: 0, r: 0, w: null, s: new Date().toISOString() };
    res.json({ token: encode(st), state: view(st) });
  });

  app.post("/sugoroku/turn", (req, res) => {
    if (limited(req.ip, "turn", 3000, 3600e3)) return res.status(429).json({ error: "しばらく時間をおいてからお試しください" });
    const st = decode(req.body && req.body.token);
    if (!st) return res.status(400).json({ error: "ゲームの情報が正しくありません。最初からやり直してください" });
    if (st.p >= GOAL) return res.status(400).json({ error: "ゴール済みです" });
    const ev = [];
    st.t++;
    play(st, "you", ev);
    // あなたが先にゴールしたらそこで終わり（コンピューターは動かない）
    if (st.w !== "you") play(st, "cpu", ev);
    res.json({ token: encode(st), state: view(st), events: ev });
  });

  app.post("/sugoroku/finish", (req, res) => {
    if (limited(req.ip, "finish", 20, 3600e3)) return res.status(429).json({ error: "しばらく時間をおいてからお試しください" });
    const { token, name } = req.body || {};
    const st = decode(token);
    if (!st || st.p < GOAL) return res.status(400).json({ error: "ゴールしたゲームだけ登録できます" });
    if (typeof name !== "string") return res.status(400).json({ error: "名前を入力してください" });
    const nm = name.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 12);
    if (!nm) return res.status(400).json({ error: "名前を入力してください" });
    const r = loadRanking();
    if (r.games.includes(st.g)) return res.status(409).json({ error: "このゲームは登録済みです" });
    const row = { name: nm, rolls: st.r, won: st.w === "you", at: new Date().toISOString(), g: st.g };
    r.list.push(row);
    r.list = sorted(r.list).slice(0, 500);
    r.games = [...r.games, st.g].slice(-5000);
    try { saveRanking(r); } catch (e) { console.error(e.message); return res.status(500).json({ error: "保存できませんでした" }); }
    const rank = r.list.findIndex(x => x.g === st.g) + 1;
    res.json({ ok: true, rank: rank || null });
  });

  // 管理用：不適切な名前を消す（管理ページから）
  app.get("/sugoroku/admin/ranking", auth, (req, res) => {
    res.json({ list: sorted(loadRanking().list).map((x, i) => ({ ...publicRow(x, i), id: x.g })) });
  });
  app.delete("/sugoroku/admin/ranking/:id", auth, (req, res) => {
    const r = loadRanking();
    const n = r.list.length;
    r.list = r.list.filter(x => x.g !== req.params.id);
    if (r.list.length === n) return res.status(404).json({ error: "見つかりません" });
    saveRanking(r);
    res.json({ ok: true });
  });

  app.get("/sugoroku/ranking", (req, res) => {
    res.json({ list: sorted(loadRanking().list).slice(0, 50).map(publicRow) });
  });
}

// ブラウザに返す状態（サイコロの決め方に関わるゲームIDは返さない）
function view(st) { return { you: st.p, cpu: st.c, youRest: st.pr, cpuRest: st.cr, rolls: st.r, winner: st.w, done: st.p >= GOAL }; }

module.exports = { register, SQUARES, GOAL };
