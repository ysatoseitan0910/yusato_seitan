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
# ローカル実行（PowerShell・環境変数が必要）
$env:NOTION_TOKEN="xxx"; $env:DB_BLOG="xxx"; node add_blog_posts.js
$env:NOTION_TOKEN="xxx"; $env:DB_YU_NEWS="xxx"; node build.js

# GitHub Actions手動実行
"/c/Program Files/GitHub CLI/gh.exe" workflow run deploy.yml --repo ysatoseitan0910/yusato_seitan
```

**注意**: ローカル環境はWindows/PowerShell。環境変数は `$env:KEY="value"` で設定する（Unix構文は使えない）。

## ページ構成

### 自動生成ページ（build.jsが生成）
- `index.html` / `top.html`：トップページ
- `committee.html`：委員会News
- `activities.html`：活動報告
- `blog.html`：ブログまとめ
- `interview.html`：インタビュー・雑誌掲載集
- `x.html`：Xまとめ
- `tiktok.html`：TikTokギャラリー
- `youtube.html`：YouTubeまとめ
- `lemino.html`：Leminoまとめ
- `web.html`：その他Webまとめ

### 静的ページ（手動管理）
- `about.html`：当委員会について
- `terms.html`：生誕委員規約
- `join.html`：ご参加希望の方へ

**注意**: 静的ページは `_template.html` を使用せず独立したCSSを持つ。ナビリンクや共通スタイルは手動で同期が必要。

## Notion DB一覧
- DB_COMMITTEE_NEWS：生誕委員会News
- DB_YU_NEWS：佐藤優羽さんNews（他DBから自動集約）
- DB_ACTIVITIES：活動報告
- DB_BLOG：佐藤優羽さんBlog
- DB_INTERVIEW：インタビュー・雑誌掲載集
- DB_TIKTOK：TikTokまとめ
- DB_X：Xまとめ
- DB_YOUTUBE：YouTubeまとめ（Channelプロパティあり）
- DB_LEMINO：Leminoまとめ
- DB_WEB：その他Webまとめ

## DBの共通プロパティ
- Name（タイトル）、Date（日付）、URL（URL）、Description（テキスト）、Published（チェックボックス）
- 一部DBに追加プロパティ：Status（セレクト）、Media（ファイル）、Platform（マルチセレクト）、Number（数値）
- DB_YOUTUBE：Channelプロパティ（Select or rich_text）でチャンネル別に分類表示
- DB_X：Tagプロパティ（Multi-select）でタグ別にセクション分け表示

## build.js の主要な仕組み

### ヘルパー関数
- `getText(page, key)`：Notionのrich_text/titleを**全セグメント結合**して返す
- `getSelect(page, key)`：Select or Multi-select の最初の値を返す
- `getTags(page, key)`：Multi-select / Select の全値を配列で返す（X投稿のタグ取得に使用）
- `getMedia(page)`：Mediaプロパティの外部URL or ファイルURLを返す
- `escAttr(s)`：HTML属性用エスケープ（&, ", <, >）
- `actModalAttrs(p)`：活動報告・委員会Newsカードのモーダル用data属性を生成
- `queryAllUrls(dbId)`：DBの全URL一覧をページネーション付きで取得（syncToYuNews専用）

### トップページレイアウト（buildIndex）
2カラム構成：`grid-template-columns: minmax(0,1fr) 300px`

**左（メインコンテンツ）**：
1. 生誕委員会News：全件をリスト行で表示（クリックでモーダル）
2. 活動報告：4列サムネイルグリッド（`.act-thumb-grid`）
3. 佐藤優羽さんNews：4列均一カードグリッド（`.yunews-grid`）、カード全体がリンク

**右（サイドバー）**：
- YouTube動画：`https://www.youtube.com/watch?v=QXQUKkvSrCQ` で**固定**
- Xツイート：`https://x.com/ysatoseitan/status/2040992766583550402` で**固定**（oEmbed取得）
- クイックリンク：生誕委員規約・当委員会について・入会の流れ

### Xページ（buildX）
- `fetchTwitterOembed(url)`：ビルド時にoEmbed APIでツイート本文HTMLを取得
- タグ（`Tag`プロパティ）ごとにセクション分け、タグなしは末尾にまとめて表示
- `.x-embed-grid`：CSS gridで3列表示

### YouTubeページ（buildYoutube）
- `Channel`プロパティ（`getSelect` → `getText` フォールバック）でグループ化
- 表示順：日向坂ちゃんねる → 日向坂46 OFFICIAL YouTube CHANNEL → Lemino → その他

### syncToYuNews()
各DBのエントリをDB_YU_NEWSに自動集約。
- **重複防止**：`queryAllUrls()` でページネーション付き全件取得（Published問わず）。旧実装（`queryDB` 100件上限）では100件超で重複が発生していた。

### Leminoサムネイル（buildLemino）
- Notionに保存済みMediaがあればそれを使用、なければビルド時に `fetchLeminoThumbnail()` でog:imageを取得
- TikTokと同じ方式（ビルド時取得・Notionには保存しない）

### TikTokサムネイル
oEmbed API（`https://www.tiktok.com/oembed?url=...`）をビルド時に並列取得。期限切れ問題を避けるためNotionには保存しない。

### モーダル（_template.html）
活動報告・委員会NewsのクリックでDescriptionを全文表示。
- XSS対策：textContent / createTextNode で描画
- ESCキー・オーバーレイクリックで閉じる
- `[data-act-modal]` 属性を持つカードにイベントデリゲーションで対応
- **委員会Newsリスト行はDescriptionが空でもモーダル属性を付与**（actModalAttrsを使わず直接生成）

## update_media_thumbnails.js の仕組み
- **DB_YOUTUBE**：全エントリのMediaが未設定のものに動画IDからYouTubeサムネイルを追加
- **DB_LEMINO**：全エントリのMediaが未設定のものにog:imageからサムネイルを追加
- **DB_YU_NEWS**：Platform=Youtube/LeminoでMediaが未設定のものに同様に追加
- YouTube動画ID抽出：`youtube.com/watch?v=ID` or `youtu.be/ID` → `img.youtube.com/vi/{ID}/maxresdefault.jpg`
- Platformの照合は**大文字小文字を区別しない**

## add_blog_posts.js の仕組み
- スクレイピング対象：`https://www.hinatazaka46.com/s/official/diary/member/list?ima=0000&ct=42`
- 抽出クラス：`c-blog-article__title`、`c-blog-article__date`
- DB_BLOGのURLと照合して重複チェック、新規記事のみ追加
- Numberプロパティ：既存DBの最大値+1から連番で付与
- サムネイル正規表現：`cdn.hinatazaka46.com/files/.../diary|moblog/....(jpg|jpeg|png|webp)`
- Descriptionに告知文を自動生成（`buildDescription()`）

## ユーティリティスクリプト
- `restore_tiktok.js`：DB_TIKTOKのレコードを誤削除した際にgh-pagesのHTML内容から復元するスクリプト
- `deduplicate_yu_news.js`：DB_YU_NEWSの重複レコードを削除するスクリプト（同URLの中で最古を保持、残りをアーカイブ）

## 注意事項
- 佐藤優羽の読み方は「さとうゆう」。ローマ字表記はYu（芸名読み）を使う
- APIキー等の秘密情報はGitHub Secretsで管理、.envファイルはない
- GitHub Actionsのconcurrencyグループ（`group: deploy`）で同時実行を防止
- DB_YU_NEWSのMediaはバリデーションエラー時にMediaなしで再試行するフォールバックあり
- 生成済みHTML（index.html等）はgh-pagesブランチにのみ存在。mainブランチにはない
- `index.html` と `top.html` は同一内容（buildIndexで両方生成）

## 未着手タスク
- OGP設定の追加
