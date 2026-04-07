# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# 佐藤優羽生誕祭実行委員会 ファンサイト

## サイト概要
日向坂46五期生・佐藤優羽（さとうゆう）さんのファン委員会サイト。
GitHub Pagesで公開。NotionのDBからデータを取得して静的HTMLを自動生成・デプロイする仕組み。

## 技術構成
- `build.js`：NotionのDBからデータを取得してHTMLを自動生成するメインスクリプト
- `add_blog_posts.js`：hinatazaka46.comのブログ一覧ページをスクレイピングしてDB_BLOGに新規記事を自動追加
- `update_blog_thumbnails.js`：DB_BLOGのMediaが未設定のエントリにサムネイル画像を追加
- `update_media_thumbnails.js`：DB_YOUTUBE・DB_LEMINO・DB_YU_NEWSのYoutube/LeminoエントリにMediaサムネイルを追加
- `_template.html`：全ページ共通のナビ・フッター・モーダルテンプレート（{{プレースホルダー}}で差し込み）
- `.github/workflows/deploy.yml`：GitHub Actionsで1時間ごとに自動ビルド・デプロイ（add_blog_posts → update_media_thumbnails → build → gh-pages）
- Notion API（@notionhq/client@2.2.15）を使用

## ビルド・デプロイ
```bash
# ローカル実行（環境変数が必要）
NOTION_TOKEN=xxx DB_BLOG=xxx node add_blog_posts.js
NOTION_TOKEN=xxx DB_BLOG=xxx ... node build.js

# GitHub Actions手動実行
"/c/Program Files/GitHub CLI/gh.exe" workflow run deploy.yml --repo ysatoseitan0910/yusato_seitan
```

## ページ構成

### 自動生成ページ（build.jsが生成）
- `index.html` / `top.html`：トップ（Yu News + 委員会News + 活動報告）
- `committee.html`：委員会News
- `activities.html`：活動報告
- `blog.html`：ブログまとめ
- `interview.html`：インタビュー集
- `x.html`：Xまとめ
- `tiktok.html`：TikTokギャラリー
- `youtube.html`：YouTubeまとめ
- `lemino.html`：Leminoまとめ
- `web.html`：その他Webまとめ

### 静的ページ（手動管理）
- `about.html`：当委員会について
- `terms.html`：生誕委員規約
- `join.html`：ご参加希望の方へ

## Notion DB一覧
- DB_COMMITTEE_NEWS：生誕委員会News
- DB_YU_NEWS：佐藤優羽さんNews（他DBから自動集約）
- DB_ACTIVITIES：活動報告
- DB_BLOG：佐藤優羽さんBlog
- DB_INTERVIEW：インタビュー集
- DB_TIKTOK：TikTokまとめ
- DB_X：Xまとめ
- DB_YOUTUBE：YouTubeまとめ
- DB_LEMINO：Leminoまとめ
- DB_WEB：その他Webまとめ

## DBの共通プロパティ
- Name（タイトル）、Date（日付）、URL（URL）、Description（テキスト）、Published（チェックボックス）
- 一部DBに追加プロパティ：Status（セレクト）、Media（ファイル）、Platform（マルチセレクト）、Number（数値）

## build.js の主要な仕組み

### ヘルパー関数
- `getText(page, key)`：Notionのrich_text/titleを**全セグメント結合**して返す（ハイパーリンクがあっても途切れない）
- `getMedia(page)`：Mediaプロパティの外部URL or ファイルURLを返す
- `escAttr(s)`：HTML属性用エスケープ（&, ", <, >）
- `actModalAttrs(p)`：活動報告・委員会Newsカードのモーダル用data属性を生成

### カード表示パターン
- `newsCard(page)`：Yu Newsカード。Mediaあり時は画像上部・本文下部のレイアウト（news-card--img）
- `mediaCard` パターン：活動報告・委員会Newsで使用。Media画像 + 3行Descriptionプレビュー + モーダル対応
- Descriptionのプレビュー表示：`desc.split("\n").slice(0,3).join("<br>")`（3行まで）
- トップページレイアウト：`grid-template-columns:1fr 1fr`（Yu Newsと委員会News+活動報告が等幅）

### syncToYuNews()
各DBのエントリをDB_YU_NEWSに自動集約する。Mediaのコピー、TikTok/Blog用Descriptionの自動生成も行う。

### TikTokサムネイル
oEmbed API（`https://www.tiktok.com/oembed?url=...`）をビルド時に並列取得。期限切れ問題を避けるためNotionには保存しない。

### モーダル（_template.html）
活動報告・委員会NewsカードをクリックするとモーダルでDescriptionを全文表示。
- XSS対策：textContent / createTextNode で描画
- ESCキー・オーバーレイクリックで閉じる
- `[data-act-modal]` 属性を持つカードにイベントデリゲーションで対応

## update_media_thumbnails.js の仕組み
- **DB_YOUTUBE**：全エントリのMediaが未設定のものに動画IDからYouTubeサムネイルを追加
- **DB_LEMINO**：全エントリのMediaが未設定のものにog:imageからサムネイルを追加
- **DB_YU_NEWS**：Platform=Youtube/LeminoでMediaが未設定のものに同様に追加
- YouTube動画ID抽出：`youtube.com/watch?v=ID` or `youtu.be/ID` → `img.youtube.com/vi/{ID}/maxresdefault.jpg`
- Platformの照合は**大文字小文字を区別しない**（DB_YU_NEWSでは `"Youtube"` という表記が使われている）

## add_blog_posts.js の仕組み
- スクレイピング対象：`https://www.hinatazaka46.com/s/official/diary/member/list?ima=0000&ct=42`
- 抽出クラス：`c-blog-article__title`、`c-blog-article__date`
- DB_BLOGのURLと照合して重複チェック、新規記事のみ追加
- Numberプロパティ：既存DBの最大値+1から連番で付与
- サムネイル正規表現：`cdn.hinatazaka46.com/files/.../diary|moblog/....(jpg|jpeg|png|webp)`
- Descriptionに告知文を自動生成（`buildDescription()`）

## 注意事項
- 佐藤優羽の読み方は「さとうゆう」。ローマ字表記はYu（芸名読み）を使う
- APIキー等の秘密情報はGitHub Secretsで管理、.envファイルはない
- GitHub Actionsのconcurrencyグループ（`group: deploy`）で同時実行を防止
- DB_YU_NEWSのMediaはバリデーションエラー時にMediaなしで再試行するフォールバックあり

## 未着手タスク
- ナビゲーションのハンバーガーメニュー化（スマホ対応）
- OGP設定の追加
