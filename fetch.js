const { Client } = require("@notionhq/client");
const fs = require("fs");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function getPosts() {
  const response = await notion.databases.query({
    database_id: process.env.DATABASE_ID,
    filter: {
      property: "URL",
      url: { contains: "tiktok.com" }
    },
    sorts: [{ property: "Date", direction: "descending" }],
  });
  return response.results;
}

function buildCard(post) {
  const url = post.properties.URL?.url ?? "";
  const name = post.properties.Name?.title?.[0]?.plain_text ?? "無題";
  const date = post.properties.Date?.date?.start ?? "";
  const videoId = url.split("/video/")[1]?.split("?")[0] ?? "";

  return `
  <div class="card">
    <div class="card-header">
      <div class="platform-badge">
        <div class="platform-icon">♪</div>
        TikTok
      </div>
      <span class="card-date">${date}</span>
    </div>
    <div class="embed-wrap">
      <blockquote
        class="tiktok-embed"
        cite="${url}"
        data-video-id="${videoId}">
        <section></section>
      </blockquote>
    </div>
    <div class="card-footer">
      <p class="card-title">${name}</p>
      <a href="${url}" class="card-link" target="_blank" rel="noopener">動画を見る →</a>
    </div>
  </div>`;
}

async function run() {
  console.log("Notionからデータ取得中...");
  const posts = await getPosts();
  console.log(`取得件数: ${posts.length}件`);
// 日付の新しい順にソート（Date未入力は末尾へ）
  posts.sort((a, b) => {
    const da = a.properties.Date?.date?.start ?? "";
    const db = b.properties.Date?.date?.start ?? "";
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  });
  const cards = posts.map(buildCard).join("\n");

  let html = fs.readFileSync("index.html", "utf-8");

  html = html.replace(
    /<!-- GALLERY_START -->[\s\S]*?<!-- GALLERY_END -->/,
    `<!-- GALLERY_START -->\n${cards}\n<!-- GALLERY_END -->`
  );

  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  html = html.replace("<!-- LAST_UPDATED -->", now);

  fs.writeFileSync("index.html", html, "utf-8");
  console.log(`✅ ${posts.length}件のTikTok投稿を反映しました`);
}

run().catch(console.error);
