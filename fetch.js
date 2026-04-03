import { Client } from "@notionhq/client";
import { readFileSync, writeFileSync } from "fs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function getPosts() {
  const response = await notion.databases.query({
    database_id: process.env.DATABASE_ID,
    sorts: [{ property: "Date", direction: "descending" }],
  });
  return response.results;
}

function buildCard(post) {
  const url = post.properties.URL?.url ?? "";
  const name = post.properties.Name?.title?.[0]?.plain_text ?? "無題";
  const platform = post.properties.Platform?.select?.name?.toLowerCase() ?? "x";
  const date = post.properties.Date?.date?.start ?? "";

  const icon = platform === "tiktok"
    ? `<div class="platform-icon tiktok">♪</div> TikTok`
    : `<div class="platform-icon x">𝕏</div> X (Twitter)`;

  const embed = url
    ? `<div class="embed-wrap">
        <iframe src="${url}" width="100%" height="400" frameborder="0"
          allowfullscreen loading="lazy"></iframe>
       </div>`
    : `<div class="embed-wrap"><div class="embed-placeholder"><span>URLなし</span></div></div>`;

  return `
  <div class="card" data-platform="${platform}">
    <div class="card-header">
      <div class="platform-badge ${platform}">${icon}</div>
      <span class="card-date">${date}</span>
    </div>
    ${embed}
    <div class="card-footer">
      <p class="card-title">${name}</p>
      <a href="${url}" class="card-link" target="_blank">投稿を見る →</a>
    </div>
  </div>`;
}

async function run() {
  const posts = await getPosts();
  const cards = posts.map(buildCard).join("\n");

  let html = readFileSync("index.html", "utf-8");
  html = html.replace(
    /<!-- GALLERY_START -->[\s\S]*?<!-- GALLERY_END -->/,
    `<!-- GALLERY_START -->\n${cards}\n<!-- GALLERY_END -->`
  );

  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  html = html.replace(
    /最終更新：[^<]*/,
    `最終更新：${now}`
  );

  writeFileSync("index.html", html, "utf-8");
  console.log(`✅ ${posts.length}件の投稿を反映しました`);
}

run().catch(console.error);