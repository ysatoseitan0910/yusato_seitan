const express = require("express");
const { Client } = require("@notionhq/client");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const app = express();
app.set('trust proxy', 1); // nginx の背後で実際のクライアントIPを取得
app.use(express.json({ limit: "5mb" }));

const UPLOADS_DIR = "/var/www/satoyu/uploads/cards";

// ── IPレート制限（メッセージ送信：1時間に3回まで） ──
const msgRateMap = new Map();
const MSG_RATE_LIMIT  = 3;
const MSG_RATE_WINDOW = 60 * 60 * 1000;

function checkMsgRateLimit(ip) {
  const now = Date.now();
  const rec = msgRateMap.get(ip);
  if (!rec || now > rec.resetAt) {
    msgRateMap.set(ip, { count: 1, resetAt: now + MSG_RATE_WINDOW });
    return true;
  }
  if (rec.count >= MSG_RATE_LIMIT) return false;
  rec.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of msgRateMap) if (now > v.resetAt) msgRateMap.delete(k);
}, MSG_RATE_WINDOW);

// ── IPレート制限（カード送信：1時間に5回まで） ──
const cardRateMap = new Map();
const CARD_RATE_LIMIT = 10;

function checkCardRateLimit(ip) {
  const now = Date.now();
  const rec = cardRateMap.get(ip);
  if (!rec || now > rec.resetAt) {
    cardRateMap.set(ip, { count: 1, resetAt: now + MSG_RATE_WINDOW });
    return true;
  }
  if (rec.count >= CARD_RATE_LIMIT) return false;
  rec.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cardRateMap) if (now > v.resetAt) cardRateMap.delete(k);
}, MSG_RATE_WINDOW);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  quiz:       process.env.DB_QUIZ,
  committee:  process.env.DB_COMMITTEE_NEWS,
  activities: process.env.DB_ACTIVITIES,
  x:          process.env.DB_X,
  tiktok:     process.env.DB_TIKTOK,
  instagram:  process.env.DB_INSTAGRAM,
  youtube:    process.env.DB_YOUTUBE,
  lemino:     process.env.DB_LEMINO,
  messages:   process.env.DB_MESSAGES,
  cards:      process.env.DB_CARDS,
  memberblog: process.env.DB_MEMBER_BLOG,
  history:    process.env.DB_HISTORY,
  topnews:    process.env.DB_TOP_NEWS,
};

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === "https://satoyu.info" || origin === "https://www.satoyu.info") {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// 公開エンドポイントで受け取る選択値の許可リスト（未認証入力をそのままNotionに入れない）
const ALLOWED_FONTS = ["Zen Maru Gothic", "Noto Sans JP", "Yomogi", "Caveat"];
const ALLOWED_SIZES = ["small", "medium", "large"];
function pickAllowed(value, allowed, fallback) {
  const v = String(value || "").replace(/['"]/g, "").split(",")[0].trim();
  return allowed.includes(v) ? v : fallback;
}

// 認証ミドルウェア
// ADMIN_PASSWORD への総当たりを抑止するため、IP単位で失敗回数を制限する。
// 管理画面のログインは「/add/quiz に空ボディを投げて401か否か」で判定しており、
// 副作用のない判定オラクルが公開されているため、無制限だと試行し放題だった。
const authFailMap = new Map();
const AUTH_MAX_FAILS = 10;              // この回数を超えたら
const AUTH_LOCK_MS   = 10 * 60 * 1000;  // 10分ロックする

function authFailState(ip) {
  const now = Date.now();
  for (const [k, v] of authFailMap) if (now > v.resetAt) authFailMap.delete(k);
  return authFailMap.get(ip);
}

function auth(req, res, next) {
  const ip = req.ip;
  const st = authFailState(ip);
  if (st && st.count >= AUTH_MAX_FAILS) {
    return res.status(429).json({ error: "試行回数が多すぎます。しばらく時間をおいてください。" });
  }
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
  // タイミング差を減らすため長さを揃えてから定数時間比較する
  let ok = false;
  if (ADMIN_PASSWORD) {
    const a = Buffer.from(String(token));
    const b = Buffer.from(String(ADMIN_PASSWORD));
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!ok) {
    const now = Date.now();
    const cur = st || { count: 0, resetAt: now + AUTH_LOCK_MS };
    cur.count++; cur.resetAt = now + AUTH_LOCK_MS;
    authFailMap.set(ip, cur);
    return res.status(401).json({ error: "認証エラー" });
  }
  authFailMap.delete(ip);   // 成功したら失敗カウントを消す
  next();
}

function t(content) {
  return content ? [{ text: { content: String(content) } }] : [];
}

// base64がPNGとして妥当かを検証し、問題なければBufferを返す（不正ならnull）
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function isValidPng(base64) {
  if (typeof base64 !== "string" || base64.length === 0) return null;
  let buf;
  try { buf = Buffer.from(base64, "base64"); } catch { return null; }
  if (buf.length < 8 || buf.length > MAX_IMAGE_BYTES) return null;
  return buf.subarray(0, 8).equals(PNG_MAGIC) ? buf : null;
}

// クイズ
app.post("/add/quiz", auth, async (req, res) => {
  const { q, optionA, optionB, optionC, optionD, answer, explanation, sourceUrl, sourceTitle } = req.body;
  if (!q) return res.status(400).json({ error: "問題文は必須です" });
  try {
    await notion.pages.create({
      parent: { database_id: DB.quiz },
      properties: {
        Name:        { title: t(q) },
        OptionA:     { rich_text: t(optionA) },
        OptionB:     { rich_text: t(optionB) },
        OptionC:     { rich_text: t(optionC) },
        OptionD:     { rich_text: t(optionD) },
        Answer:      { select: { name: answer || "A" } },
        Explanation: { rich_text: t(explanation) },
        SourceUrl:   { url: sourceUrl || null },
        SourceTitle: { rich_text: t(sourceTitle) },
        Published:   { checkbox: true },
      },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// 委員会News
app.post("/add/committee", auth, async (req, res) => {
  const { name, date, url, status, deadline, description, mediaUrl } = req.body;
  if (!name) return res.status(400).json({ error: "タイトルは必須です" });
  try {
    const props = { Name: { title: t(name) }, Published: { checkbox: true } };
    if (date)     props.Date        = { date: { start: date } };
    if (url)      props.URL         = { url };
    if (status)   props.Status      = { select: { name: status } };
    if (deadline) props["締め切り"] = { date: { start: deadline } };
    if (description) props.Description = { rich_text: t(description) };
    if (mediaUrl) props.Media = { files: [{ name: "image", type: "external", external: { url: mediaUrl } }] };
    await notion.pages.create({ parent: { database_id: DB.committee }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// 活動報告
app.post("/add/activities", auth, async (req, res) => {
  const { name, date, url, status, description, mediaUrl } = req.body;
  if (!name) return res.status(400).json({ error: "タイトルは必須です" });
  try {
    const props = { Name: { title: t(name) }, Published: { checkbox: true } };
    if (date)     props.Date   = { date: { start: date } };
    if (url)      props.URL    = { url };
    if (status)   props.Status = { select: { name: status } };
    if (description) props.Description = { rich_text: t(description) };
    if (mediaUrl) props.Media = { files: [{ name: "image", type: "external", external: { url: mediaUrl } }] };
    await notion.pages.create({ parent: { database_id: DB.activities }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// X
app.post("/add/x", auth, async (req, res) => {
  const { name, date, url, tags } = req.body;
  if (!name) return res.status(400).json({ error: "タイトルは必須です" });
  try {
    const props = { Name: { title: t(name) }, Published: { checkbox: true } };
    if (date) props.Date = { date: { start: date } };
    if (url)  props.URL  = { url };
    if (tags) {
      const tagList = tags.split(",").map(s => s.trim()).filter(Boolean);
      if (tagList.length) props.Tag = { multi_select: tagList.map(n => ({ name: n })) };
    }
    await notion.pages.create({ parent: { database_id: DB.x }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// TikTok
app.post("/add/tiktok", auth, async (req, res) => {
  const { name, date, url } = req.body;
  if (!url) return res.status(400).json({ error: "URLは必須です" });
  try {
    const props = { Name: { title: t(name || url) }, Published: { checkbox: true } };
    if (date) props.Date = { date: { start: date } };
    props.URL = { url };
    await notion.pages.create({ parent: { database_id: DB.tiktok }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// Instagram
app.post("/add/instagram", auth, async (req, res) => {
  const { name, date, url, account } = req.body;
  if (!url) return res.status(400).json({ error: "URLは必須です" });
  try {
    const props = { Name: { title: t(name || url) }, Published: { checkbox: true } };
    if (date)    props.Date    = { date: { start: date } };
    props.URL = { url };
    if (account) props.Account = { select: { name: account } };
    await notion.pages.create({ parent: { database_id: DB.instagram }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// YouTube
app.post("/add/youtube", auth, async (req, res) => {
  const { name, date, url, channel } = req.body;
  if (!name) return res.status(400).json({ error: "タイトルは必須です" });
  try {
    const props = { Name: { title: t(name) }, Published: { checkbox: true } };
    if (date)    props.Date    = { date: { start: date } };
    if (url)     props.URL     = { url };
    if (channel) props.Channel = { select: { name: channel } };
    await notion.pages.create({ parent: { database_id: DB.youtube }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// 他メンバーブログ
app.post("/add/memberblog", auth, async (req, res) => {
  const { name, date, url, members, description } = req.body;
  // URLだけあれば登録可。タイトル/日付/メンバーは未入力ならビルド時に自動補完される
  if (!url) return res.status(400).json({ error: "URLは必須です（タイトル・日付・メンバーは自動補完されます）" });
  try {
    const props = { Published: { checkbox: true }, URL: { url } };
    if (name) props.Name = { title: t(name) };
    if (date) props.Date = { date: { start: date } };
    if (members) {
      const memberList = members.split(",").map(s => s.trim()).filter(Boolean);
      if (memberList.length) props.Member = { multi_select: memberList.map(n => ({ name: n })) };
    }
    if (description) props.Description = { rich_text: t(description) };
    await notion.pages.create({ parent: { database_id: DB.memberblog }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// Lemino
app.post("/add/lemino", auth, async (req, res) => {
  const { name, date, url, description, program, expiryDate } = req.body;
  if (!name) return res.status(400).json({ error: "タイトルは必須です" });
  try {
    const props = { Name: { title: t(name) }, Published: { checkbox: true } };
    if (date)        props.Date        = { date: { start: date } };
    if (url)         props.URL         = { url };
    if (description) props.Description = { rich_text: t(description) };
    if (program)     props.Program     = { select: { name: program } };
    if (expiryDate)  props["配信終了予定"] = { date: { start: expiryDate } };
    await notion.pages.create({ parent: { database_id: DB.lemino }, properties: props });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// プロパティを表示用文字列に変換
function formatProperty(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':         return prop.title.map(s => s.plain_text).join('') || null;
    case 'rich_text':     return prop.rich_text.map(s => s.plain_text).join('') || null;
    case 'number':        return prop.number;
    case 'select':        return prop.select?.name || null;
    case 'multi_select':  return prop.multi_select.map(s => s.name).join(', ') || null;
    case 'date':          return prop.date ? (prop.date.end ? `${prop.date.start} → ${prop.date.end}` : prop.date.start) : null;
    case 'checkbox':      return prop.checkbox;
    case 'url':           return prop.url;
    case 'email':         return prop.email;
    case 'phone_number':  return prop.phone_number;
    case 'files':         return prop.files.map(f => f.external?.url || f.file?.url || '').filter(Boolean).join('\n') || null;
    case 'created_time':  return prop.created_time;
    case 'last_edited_time': return prop.last_edited_time;
    default:              return null;
  }
}

// レコード詳細取得
app.get("/get/:db/:pageId", auth, async (req, res) => {
  const { db: dbKey, pageId } = req.params;
  if (!DB[dbKey]) return res.status(404).json({ error: "不明なDB" });
  try {
    const page = await notion.pages.retrieve({ page_id: pageId });
    const properties = {};
    for (const [key, prop] of Object.entries(page.properties)) {
      properties[key] = { type: prop.type, value: formatProperty(prop) };
    }
    res.json({
      id: page.id,
      created_time: page.created_time,
      last_edited_time: page.last_edited_time,
      archived: page.archived,
      properties,
    });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// レコード削除（アーカイブ）
app.delete("/delete/:db/:pageId", auth, async (req, res) => {
  const { db: dbKey, pageId } = req.params;
  if (!DB[dbKey]) return res.status(404).json({ error: "不明なDB" });
  try {
    await notion.pages.update({ page_id: pageId, archived: true });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// レコード非公開化（Published = false）
app.patch("/unpublish/:db/:pageId", auth, async (req, res) => {
  const { db: dbKey, pageId } = req.params;
  if (!DB[dbKey]) return res.status(404).json({ error: "不明なDB" });
  try {
    await notion.pages.update({ page_id: pageId, properties: { Published: { checkbox: false } } });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// DBスキーマ取得（select / multi_select のオプション一覧）
app.get("/schema/:db", auth, async (req, res) => {
  const { db: dbKey } = req.params;
  const dbId = DB[dbKey];
  if (!dbId) return res.status(404).json({ error: "不明なDB" });
  try {
    const db = await notion.databases.retrieve({ database_id: dbId });
    const schema = {};
    for (const [key, prop] of Object.entries(db.properties)) {
      if (prop.type === "select") {
        schema[key] = { type: "select", options: (prop.select?.options || []).map(o => o.name) };
      } else if (prop.type === "multi_select") {
        schema[key] = { type: "multi_select", options: (prop.multi_select?.options || []).map(o => o.name) };
      }
    }
    res.json(schema);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// ヘルスチェック
app.get("/health", (req, res) => res.json({ ok: true }));

// テキスト取得ヘルパー
function getText(prop) {
  if (!prop) return "";
  if (prop.title)     return prop.title.map(s => s.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map(s => s.plain_text).join("");
  return "";
}

// 一覧取得
app.get("/list/:db", auth, async (req, res) => {
  const dbKey = req.params.db;
  const dbId = DB[dbKey];
  if (!dbId) return res.status(404).json({ error: "不明なDB: " + dbKey });
  try {
    const results = [];
    let cursor;
    do {
      const r = await notion.databases.query({
        database_id: dbId,
        start_cursor: cursor,
        page_size: 100,
        sorts: [{ timestamp: "created_time", direction: "descending" }],
      });
      results.push(...r.results);
      cursor = r.has_more ? r.next_cursor : null;
    } while (cursor);

    const items = results.map(p => ({
      id: p.id,
      name: getText(p.properties.Name),
      date: p.properties.Date?.date?.start || null,
      url: p.properties.URL?.url || null,
      published: p.properties.Published?.checkbox ?? null,
      body: p.properties.Body ? getText(p.properties.Body) : null,
    }));
    res.json({ items, total: items.length });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── メッセージカード（公開エンドポイント・認証不要） ──
app.post("/messages", async (req, res) => {
  const { message, name, xid, font, size, color, _hp } = req.body;

  // ハニーポットチェック（ボットは隠しフィールドを埋める）
  if (_hp) return res.status(400).json({ error: "送信に失敗しました" });

  // IPレート制限
  if (!checkMsgRateLimit(req.ip)) {
    return res.status(429).json({ error: "送信が多すぎます。しばらく時間をおいてから再度お試しください。" });
  }

  // 型チェックを必ず先に行う。文字列以外（数値・オブジェクト等）が来ると
  // .trim() が TypeError になり、try の外なので unhandled rejection でプロセスが落ちる
  if (typeof message !== "string" || !message.trim()) return res.status(400).json({ error: "メッセージは必須です" });
  if (typeof name    !== "string" || !name.trim())    return res.status(400).json({ error: "お名前は必須です" });
  if (message.trim().length > 200) return res.status(400).json({ error: "メッセージは200文字以内です" });
  if (name.trim().length > 30)     return res.status(400).json({ error: "お名前は30文字以内です" });
  if (!DB.messages) return res.status(503).json({ error: "メッセージDBが未設定です（DB_MESSAGES環境変数を設定してください）" });

  try {
    await notion.pages.create({
      parent: { database_id: DB.messages },
      properties: {
        Name:      { title: t(name.trim()) },
        Message:   { rich_text: t(message.trim()) },
        // 未認証で送られる値なので許可リストに丸める。
        // 以前は任意文字列がそのまま multi_select のオプション名になり、
        // Notion が未知の値を自動追加するためDBのセレクト定義を無限に汚染できた
        Font:      { multi_select: [{ name: pickAllowed(font, ALLOWED_FONTS, "Zen Maru Gothic") }] },
        Size:      { multi_select: [{ name: pickAllowed(size, ALLOWED_SIZES, "medium") }] },
        Color:     { rich_text: t(/^#[0-9a-fA-F]{3,8}$/.test(String(color || "")) ? color : "#1a1a1a") },
        X:         { rich_text: t(String(xid || "").slice(0, 100)) },
        Date:      { date: { start: new Date().toISOString().slice(0, 10) } },
        Published: { checkbox: false },
      },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    // 未認証エンドポイントなのでNotionの内部エラー文（DB IDやプロパティ名を含む）は返さない
    res.status(500).json({ error: "送信に失敗しました。時間をおいて再度お試しください。" });
  }
});

// ── プロフィールカード（公開エンドポイント・認証不要） ──
app.post("/cards", async (req, res) => {
  const { _hp, template, fanName, handle, birthYear, birthMD, gender, mbti,
          ohishamaHistory, song, nickname, selfIntro, otherOshi,
          bestLive1, bestLive2, bestLive3, bestVar1, bestVar2, bestVar3,
          oshiName, oshiReason, oshiLike, oshiLikeFree, oshiLove,
          // 推しぷろふぃーる（2026-07 リニューアル）
          wroteDate, favMV, favHinaai, yuCallName, kikkake, favPair,
          best1, best2, best3, freeNote, illusts,
          imageBase64 } = req.body;

  if (_hp) return res.status(400).json({ error: "送信に失敗しました" });
  if (!checkCardRateLimit(req.ip)) {
    return res.status(429).json({ error: "送信が多すぎます。しばらく時間をおいてから再度お試しください。" });
  }
  // 文字列以外が来ると .trim() が TypeError → try の外なのでプロセスが落ちる
  if (typeof fanName !== "string" || !fanName.trim()) return res.status(400).json({ error: "ファン名は必須です" });
  if (!DB.cards) return res.status(503).json({ error: "カードDBが未設定です（DB_CARDS環境変数を設定してください）" });

  try {
    // カード画像をVPSに保存
    let cardImageUrl = null;
    if (imageBase64) {
      try {
        // 未認証で保存されるファイルなので、本当にPNGかを検証してから書く。
        // 以前は任意のバイト列が .png として公開ディレクトリに置けたため、
        // 自ドメインを任意ファイルのホスティングに使われる恐れがあった
        const buf = isValidPng(imageBase64);
        if (!buf) {
          console.warn("画像を拒否: PNGではない、またはサイズ超過");
        } else {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          const filename = `${crypto.randomUUID()}.png`;
          const filepath = path.join(UPLOADS_DIR, filename);
          fs.writeFileSync(filepath, buf);
          cardImageUrl = `https://satoyu.info/uploads/cards/${filename}`;
        }
      } catch (imgErr) {
        console.error("画像保存エラー:", imgErr.message);
      }
    }

    const props = {
      Name:     { title: t(fanName.trim()) },
      Date:     { date: { start: new Date().toISOString().slice(0, 10) } },
      Published:{ checkbox: false },
    };
    if (handle)          props.Handle          = { rich_text: t(handle) };
    if (birthYear)       props.BirthYear       = { rich_text: t(birthYear) };
    if (birthMD)         props.BirthMD         = { rich_text: t(birthMD) };
    if (gender)          props.Gender          = { rich_text: t(gender) };
    if (mbti)            props.MBTI            = { rich_text: t(mbti) };
    if (ohishamaHistory) props.OhisamaHistory = { rich_text: t(ohishamaHistory) };
    if (song)            props.Song            = { rich_text: t(song) };
    if (nickname)        props.Nickname        = { rich_text: t(nickname) };
    if (selfIntro)       props.SelfIntro       = { rich_text: t(selfIntro) };
    if (otherOshi)       props.OtherOshi       = { rich_text: t(otherOshi) };
    if (bestLive1)       props.BestLive1       = { rich_text: t(bestLive1) };
    if (bestLive2)       props.BestLive2       = { rich_text: t(bestLive2) };
    if (bestLive3)       props.BestLive3       = { rich_text: t(bestLive3) };
    if (bestVar1)        props.BestVar1        = { rich_text: t(bestVar1) };
    if (bestVar2)        props.BestVar2        = { rich_text: t(bestVar2) };
    if (bestVar3)        props.BestVar3        = { rich_text: t(bestVar3) };
    if (oshiName)        props.OshiName        = { rich_text: t(oshiName) };
    if (oshiReason)      props.OshiReason      = { rich_text: t(oshiReason) };
    if (oshiLike)        props.OshiLike        = { rich_text: t(oshiLike) };
    if (oshiLikeFree)    props.OshiLikeFree    = { rich_text: t(oshiLikeFree) };
    if (oshiLove)        props.OshiLove        = { rich_text: t(oshiLove) };
    if (template)        props.Template        = { rich_text: t(template) };
    // 推しぷろふぃーる（新カード）
    if (wroteDate)       props.WroteDate       = { rich_text: t(wroteDate) };
    if (favMV)           props.FavMV           = { rich_text: t(favMV) };
    if (favHinaai)       props.FavHinaai       = { rich_text: t(favHinaai) };
    if (yuCallName)      props.YuCallName      = { rich_text: t(yuCallName) };
    if (kikkake)         props.Kikkake         = { rich_text: t(kikkake) };
    if (favPair)         props.FavPair         = { rich_text: t(favPair) };
    if (best1)           props.Best1           = { rich_text: t(best1) };
    if (best2)           props.Best2           = { rich_text: t(best2) };
    if (best3)           props.Best3           = { rich_text: t(best3) };
    if (freeNote)        props.FreeNote        = { rich_text: t(freeNote) };
    if (illusts)         props.Illusts         = { rich_text: t(illusts) };
    if (cardImageUrl)    props.CardImage       = { url: cardImageUrl };

    // 同一X IDの既存レコードをアーカイブ（最新のみ保持）
    if (handle && handle.trim()) {
      const existing = await notion.databases.query({
        database_id: DB.cards,
        filter: { property: "Handle", rich_text: { equals: handle.trim() } },
      });
      for (const page of existing.results) {
        await notion.pages.update({ page_id: page.id, archived: true });
      }
    }

    await notion.pages.create({ parent: { database_id: DB.cards }, properties: props });
    res.json({ ok: true, cardImageUrl });
  } catch (e) {
    console.error(e.message);
    // 未認証エンドポイントなのでNotionの内部エラー文（DB IDやプロパティ名を含む）は返さない
    res.status(500).json({ error: "送信に失敗しました。時間をおいて再度お試しください。" });
  }
});

// ── メッセージ一覧取得（管理者のみ） ──
app.get("/messages", auth, async (req, res) => {
  if (!DB.messages) return res.status(503).json({ error: "DB_MESSAGESが未設定です" });
  try {
    const results = [];
    let cursor;
    do {
      const resp = await notion.databases.query({
        database_id: DB.messages,
        sorts: [{ timestamp: "created_time", direction: "descending" }],
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const page of resp.results) {
        results.push({
          id:        page.id,
          name:      page.properties.Name?.title?.[0]?.plain_text || "",
          message:   page.properties.Message?.rich_text?.[0]?.plain_text || "",
          font:      page.properties.Font?.multi_select?.[0]?.name || "",
          size:      page.properties.Size?.multi_select?.[0]?.name || "",
          color:     page.properties.Color?.rich_text?.[0]?.plain_text || "",
          date:      page.properties.Date?.date?.start || "",
          published: page.properties.Published?.checkbox || false,
        });
      }
      cursor = resp.has_more ? resp.next_cursor : null;
    } while (cursor);
    res.json(results);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── 「今週のさとうゆ」週次まとめ生成 ──
function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
// 指定日を含む週の月曜〜日曜を返す（日付文字列演算・タイムゾーン非依存）
function weekRange(dateStr) {
  const d = new Date((dateStr || jstToday()) + "T00:00:00Z");
  const dow = d.getUTCDay();                 // 0=日 .. 6=土
  const offMon = dow === 0 ? -6 : 1 - dow;   // その週の月曜まで
  const mon = new Date(d); mon.setUTCDate(d.getUTCDate() + offMon);
  const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = x => x.toISOString().slice(0, 10);
  return { start: fmt(mon), end: fmt(sun) };
}
function mdShort(dateStr) {
  if (!dateStr) return "";
  const p = dateStr.slice(0, 10).split("-");
  return `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function isMonday(dateStr) {
  return new Date(dateStr + "T00:00:00Z").getUTCDay() === 1;
}
// 「日向坂で会いましょう」「まだまだ！日向坂で会いましょう」は日曜の深夜放送のため、
// カレンダー上が月曜のものは前日（日曜）に放送されたものとして扱う
function effectiveDate(name, dateStr) {
  if (!dateStr) return "";
  if (name && name.includes("日向坂で会いましょう") && isMonday(dateStr)) return addDays(dateStr, -1);
  return dateStr;
}
function plainText(prop) {
  if (!prop) return "";
  if (prop.title)     return prop.title.map(s => s.plain_text).join("");
  if (prop.rich_text) return prop.rich_text.map(s => s.plain_text).join("");
  return "";
}
function multiNames(prop) {
  return prop && prop.multi_select ? prop.multi_select.map(o => o.name) : [];
}
function truncate(s, n) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
async function queryByDate(dbId, start, end) {
  const results = [];
  let cursor;
  do {
    const r = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      filter: { and: [
        { property: "Date", date: { on_or_after: start } },
        { property: "Date", date: { on_or_before: end } },
      ] },
      sorts: [{ property: "Date", direction: "ascending" }],
    });
    results.push(...r.results);
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return results;
}
// rich_text は1オブジェクト2000文字上限のため分割
function richChunks(str) {
  const out = [];
  let s = String(str || "");
  while (s.length > 1900) { out.push({ text: { content: s.slice(0, 1900) } }); s = s.slice(1900); }
  if (s.length) out.push({ text: { content: s } });
  return out.length ? out : [{ text: { content: "" } }];
}

app.post("/generate/weekly", auth, async (req, res) => {
  if (!DB.history || !DB.topnews) {
    return res.status(503).json({ error: "DB_HISTORY / DB_TOP_NEWS が未設定です" });
  }
  try {
    const { start, end } = weekRange(req.body && req.body.date);
    // 年表は翌月曜まで拾う（日曜深夜放送の「日向坂で会いましょう」系が月曜日付で入るため）
    const [histRaw, tt, mb] = await Promise.all([
      queryByDate(DB.history, start, addDays(end, 1)),
      DB.tiktok     ? queryByDate(DB.tiktok, start, end)     : Promise.resolve([]),
      DB.memberblog ? queryByDate(DB.memberblog, start, end) : Promise.resolve([]),
    ]);

    // 実効日付（日曜深夜放送の補正）を付けて、この週に入るものだけに絞る
    const histItems = histRaw
      .map(p => ({ p, d: effectiveDate(plainText(p.properties.Name), p.properties.Date?.date?.start) }))
      .filter(x => x.d && x.d >= start && x.d <= end)
      .sort((a, b) => a.d.localeCompare(b.d));

    const urlOf = p => (p.properties.URL && p.properties.URL.url) ? "\n" + p.properties.URL.url : "";
    // 年表：本人ブログ（Type=ブログ）は「できごと」から分けて「ブログ」に
    const isBlogType = x => multiNames(x.p.properties.Type).some(name => name.includes("ブログ"));
    const histEvents = histItems.filter(x => !isBlogType(x));
    const histBlogs  = histItems.filter(isBlogType);

    const eventLines = histEvents.map(({ p, d }) => {
      const nm = plainText(p.properties.Name).replace(/\s+/g, " ").trim();
      const types = multiNames(p.properties.Type);
      const tag = types.length ? `[${types.join("/")}] ` : "";
      return `・${mdShort(d)} ${tag}${nm}`.trim() + urlOf(p);
    });
    const blogLines = histBlogs.map(({ p, d }) => {
      const nm = plainText(p.properties.Name).replace(/\s+/g, " ").trim();
      return `・${mdShort(d)} ${nm}`.trim() + urlOf(p);
    });
    const ttLines = tt.map(p =>
      `・${mdShort(p.properties.Date?.date?.start)} ${truncate(plainText(p.properties.Name), 34)}`.trim() + urlOf(p));
    const mbLines = mb.map(p => {
      const members = multiNames(p.properties.Member).join("・");
      const nm = truncate(plainText(p.properties.Name), 30);
      return `・${mdShort(p.properties.Date?.date?.start)} ${members ? members + " " : ""}「${nm}」`.trim() + urlOf(p);
    });

    const sec = [];
    if (eventLines.length) sec.push(`▼できごと（${eventLines.length}件）\n` + eventLines.join("\n"));
    if (blogLines.length)  sec.push(`▼ブログ（${blogLines.length}件）\n` + blogLines.join("\n"));
    if (ttLines.length)    sec.push(`▼TikTok（${ttLines.length}本）\n` + ttLines.join("\n"));
    if (mbLines.length)    sec.push(`▼他メンバーブログ登場（${mbLines.length}件）\n` + mbLines.join("\n"));

    const rangeLabel = `${mdShort(start)}〜${mdShort(end)}`;
    const title = `今週のさとうゆ（${rangeLabel}）`;
    const body =
      `📅今週のさとうゆ（${rangeLabel}）\n\n` +
      (sec.length ? sec.join("\n\n") : "今週は大きな更新はありませんでした。");

    // 同名の既存レコードをアーカイブ（重複防止）
    const existing = await notion.databases.query({
      database_id: DB.topnews,
      filter: { property: "Name", title: { equals: title } },
    });
    for (const pg of existing.results) {
      await notion.pages.update({ page_id: pg.id, archived: true });
    }

    const page = await notion.pages.create({
      parent: { database_id: DB.topnews },
      properties: {
        Name:      { title: t(title) },
        Body:      { rich_text: richChunks(body) },
        Date:      { date: { start: end } },
        URL:       { url: `https://satoyu.info/weekly.html#w-${end}` },
        Published: { checkbox: true },
      },
    });

    res.json({
      ok: true, pageId: page.id, title, body, start, end, range: rangeLabel,
      counts: { events: eventLines.length, tiktok: ttLines.length, memberblog: mbLines.length },
    });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// 今週のさとうゆ 本文（Body）を更新
app.patch("/topnews/:pageId/body", auth, async (req, res) => {
  const { pageId } = req.params;
  const { body } = req.body || {};
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: { Body: { rich_text: richChunks(body || "") } },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// 今週のさとうゆ OGP画像を保存（毎週作り変え）
const OGP_DIR = "/var/www/satoyu/ogp";
app.post("/ogp/weekly", auth, async (req, res) => {
  const { imageBase64 } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "画像がありません" });
  const pngBuf = isValidPng(imageBase64);
  if (!pngBuf) return res.status(400).json({ error: "PNG画像として不正です（または5MB超）" });
  try {
    fs.mkdirSync(OGP_DIR, { recursive: true });
    fs.writeFileSync(path.join(OGP_DIR, "weekly.png"), pngBuf);
    res.json({ ok: true, url: "https://satoyu.info/ogp/weekly.png" });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log("satoyu admin API running on :3001"));
