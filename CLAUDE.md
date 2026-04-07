# 佐藤優羽生誕祭実行委員会 ファンサイト

## サイト概要
日向坂46五期生・佐藤優羽（さとうゆう）さんのファン委員会サイト。
GitHub Pagesで公開。NotionのDBからデータを取得して自動更新する仕組み。

## 技術構成
- `build.js`：NotionのDBからデータを取得してHTMLを自動生成
- `_template.html`：全ページ共通のナビゲーションテンプレート
- `.github/workflows/deploy.yml`：GitHub Actionsで1時間ごとに自動ビルド・デプロイ
- Notion API（@notionhq/client@2.2.15）を使用

## ページ構成

### 自動生成ページ（build.jsが生成）
- `index.html` / `top.html`：トップ（Yu News + 活動報告 + 委員会News）
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
- 一部DBに追加プロパティ：Status（セレクト）、Media（ファイル）、Platform（マルチセレクト）

## 直近のタスク
- _template.htmlのナビにabout.html / terms.html / join.htmlのリンクを追加
- ナビゲーションのハンバーガーメニュー化（スマホ対応）
- Newsカードにサムネイル画像表示
- OGP設定の追加

## 注意事項
- 佐藤優羽の読み方は「さとうゆう」。ローマ字表記はYu（芸名読み）を使う
- APIキー等の秘密情報はGitHub Secretsで管理、.envファイルはない