const express = require("express");
const { Client } = require("@notionhq/client");

const app = express();
app.use(express.json());

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DB = {
  quiz:       process.env.DB_QUIZ,
  committee:  process.env.DB_COMMITTEE_NEWS,
  activities: process.env.DB_ACTIVITIES,
  x:          process.env.DB_X,
  tiktok:     process.env.DB_TIKTOK,
  youtube:    process.env.DB_YOUTUBE,
  lemino:     process.env.DB_LEMINO,
  messages:   process.env.DB_MESSAGES, // メッセージカードDB（別途Notionで作成・共有が必要）
};

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin === "https://satoyu.info" || origin === "https://www.satoyu.info") {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// 認証ミドルウェア
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!ADMIN_PASSWORD || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "認証エラー" });
  }
  next();
}

function t(content) {
  return content ? [{ text: { content: String(content) } }] : [];
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

// Lemino
app.post("/add/lemino", auth, async (req, res) => {
  const { name, date, url, description } = req.body;
  if (!name) return res.status(400).json({ error: "タイトルは必須です" });
  try {
    const props = { Name: { title: t(name) }, Published: { checkbox: true } };
    if (date) props.Date = { date: { start: date } };
    if (url)  props.URL  = { url };
    if (description) props.Description = { rich_text: t(description) };
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
    }));
    res.json({ items, total: items.length });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── メッセージカード（公開エンドポイント・認証不要） ──
app.post("/messages", async (req, res) => {
  const { message, name, font, size, color } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: "メッセージは必須です" });
  if (!name    || !name.trim())    return res.status(400).json({ error: "お名前は必須です" });
  if (message.trim().length > 200) return res.status(400).json({ error: "メッセージは200文字以内です" });
  if (name.trim().length > 30)     return res.status(400).json({ error: "お名前は30文字以内です" });
  if (!DB.messages) return res.status(503).json({ error: "メッセージDBが未設定です（DB_MESSAGES環境変数を設定してください）" });

  try {
    await notion.pages.create({
      parent: { database_id: DB.messages },
      properties: {
        Name:      { title: t(name.trim()) },
        Message:   { rich_text: t(message.trim()) },
        Font:      { multi_select: [{ name: font || "Klee One" }] },
        Size:      { multi_select: [{ name: size || "medium" }] },
        Color:     { rich_text: t(color || "#1a1a1a") },
        Date:      { date: { start: new Date().toISOString().slice(0, 10) } },
        Published: { checkbox: false },
      },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: e.message });
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

app.listen(3001, () => console.log("satoyu admin API running on :3001"));
