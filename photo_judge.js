// 他メンバーブログの写真が「普段の写真」か「公式の画像（ポスター・グッズ等）」かを Claude に判定してもらう。
// sync_member_blog_bsky.js から使う。ANTHROPIC_API_KEY が無いときは判定しない（null を返す）。
//
//   candid   … 自撮り・オフショット・ミーグリや楽屋の写真など、メンバーが撮った・撮られた普段の写真
//   official … ポスター、キービジュアル、グッズ・商品、カフェのメニュー、告知画像、テレビや配信の画面、
//              雑誌・CD ジャケットなど、公式に作られた画像やその写真
//   unsure   … どちらとも言えない
//
// 費用の目安：画像1枚あたり約1,500入力トークン。記事あたり数枚なので月に数十〜百円程度。
const mod = require("@anthropic-ai/sdk");
const Anthropic = mod.default || mod;

const MODEL = "claude-opus-5-5";

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index:  { type: "integer" },
          kind:   { type: "string", enum: ["candid", "official", "unsure"] },
          reason: { type: "string" },
        },
        required: ["index", "kind", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

const PROMPT = `アイドルグループ「日向坂46」の公式ブログに載った画像を判定してください。
各画像が次のどれにあたるか、画像ごとに答えてください。

- candid：メンバー本人が撮った・撮ってもらった普段の写真（自撮り、オフショット、楽屋・ミーグリ・ライブ裏での写真、メンバー同士の写真など）
- official：公式に作られた画像や、それを写した写真（ポスター、キービジュアル、グッズや商品の写真、カフェのメニュー、告知用の画像、テレビ・配信の画面、雑誌の誌面、CD ジャケットなど）。文字やロゴ・価格・デザインされたレイアウトが入っているものは official の可能性が高い
- unsure：どちらとも判断できない

reason には判断の理由を日本語で短く書いてください。`;

// images: [{ data: Buffer, type: "image/jpeg" }]。戻り値は画像と同じ順の [{ kind, reason }] か null
async function judgePhotos(images) {
  if (!process.env.ANTHROPIC_API_KEY || !images.length) return null;
  const client = new Anthropic();
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `画像 ${i}` });
    content.push({ type: "image", source: { type: "base64", media_type: img.type || "image/jpeg", data: img.data.toString("base64") } });
  });
  content.push({ type: "text", text: PROMPT });

  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                      // 安全判定で断られたときは別モデルで自動的にやり直す
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  const out = images.map(() => ({ kind: "unsure", reason: "判定なし" }));
  for (const r of JSON.parse(text).results || []) if (out[r.index]) out[r.index] = { kind: r.kind, reason: r.reason };
  return out;
}

module.exports = { judgePhotos };
