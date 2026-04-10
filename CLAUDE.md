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
- `update_media_thumbnails.js`：DB_YOUTUBE・DB_LEMINO・DB_YU_NEWSのYoutube/LeminoエントリにMediaサムネイルを追加。DB_TIKTOKのName未設定エントリにoEmbedキャプションを書き込む
- `_template.html`：全ページ共通のナビ・フッター・モーダルテンプレート（{{プレースホルダー}}で差し込み）。YouTube/TikTokのlite-embedクリックハンドラも含む
- `.github/workflows/deploy.yml`：GitHub Actionsで1時間ごとに自動ビルド・デプロイ（add_blog_posts → update_media_thumbnails → build → gh-pages）
- Notion API（@notionhq/client@2.2.15）を使用

## ビルド・デプロイ
```bash
# ローカル実行（PowerShell・環境変数が必要）
$env:NOTION_TOKEN="xxx"; $env:DB_BLOG="xxx"; node add_blog_posts.js
$env:NOTION_TOKEN="xxx"; $env:DB_TIKTOK="xxx"; node update_media_thumbnails.js
$env:NOTION_TOKEN="xxx"; $env:DB_YU_NEWS="xxx"; $env:DB_TIKTOK="xxx"; node reset_tiktok_yunews.js
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
- `yunews.html`：佐藤優羽さんNewsまとめ（DB_YU_NEWS全件・grid-3）
- `blog.html`：ブログまとめ
- `interview.html`：インタビュー・雑誌掲載集
- `x.html`：Xまとめ
- `tiktok.html`：TikTokギャラリー
- `youtube.html`：YouTubeまとめ
- `lemino.html`：Leminoまとめ

### 静的ページ（手動管理）
- `yu.html`：佐藤優羽さんについて（プロフィール・魅力・リンク集）
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
- DB_SCHEDULE：スケジュール（トップページサイドバーに表示）

## DBの共通プロパティ
- Name（タイトル）、Date（日付）、URL（URL）、Description（テキスト）、Published（チェックボックス）
- 一部DBに追加プロパティ：Status（セレクト）、Media（ファイル）、Platform（マルチセレクト）、Number（数値）
- DB_YOUTUBE：Channelプロパティ（Select or rich_text）でチャンネル別に分類表示
- DB_X：Tagプロパティ（Multi-select）でタグ別にセクション分け表示
- DB_SCHEDULE：Status（セレクト）で「募集中」→緑バッジ、その他→灰色バッジ。日付昇順で表示

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
3. 佐藤優羽さんNews：4列均一カードグリッド（`.yunews-grid`）、カード全体がリンク、「すべて見る」→yunews.html

**右（サイドバー）**：
1. スケジュール：DB_SCHEDULEを日付昇順で表示。過去日付はグレーアウト。URLありはリンク
2. YouTube動画：`https://www.youtube.com/watch?v=QXQUKkvSrCQ` で**固定**（lite-embed）
3. Xツイート：`https://x.com/ysatoseitan/status/2040992766583550402` で**固定**（oEmbed取得・遅延読み込み）
4. クイックリンク：生誕委員規約・当委員会について・入会の流れ

### lite-embed（YouTube・TikTok）
ページロード時にiframeを生成せず、サムネイル画像＋再生ボタンを表示してクリック時のみiframeに差し替える。
- **YouTube**：`.yt-lite[data-id]` → クリックで `youtube.com/embed/{id}?autoplay=1` に差し替え
- **TikTok**：`.tiktok-lite[data-id]` → クリックで `tiktok.com/embed/v2/{id}` に差し替え
- クリックハンドラは `_template.html` の末尾スクリプトに定義（全ページ共通）

### Twitter widgets.js の遅延読み込み
`IntersectionObserver` で最初の `.twitter-tweet` 要素が画面に近づいたときに `widgets.js` を動的ロード。
x.html とトップページサイドバーで適用。

### Xページ（buildX）
- `fetchTwitterOembed(url)`：ビルド時にoEmbed APIでツイート本文HTMLを取得
- タグ（`Tag`プロパティ）ごとにセクション分け、タグなしは末尾にまとめて表示
- `.x-embed-grid`：CSS gridで3列表示

### YouTubeページ（buildYoutube）
- `Channel`プロパティ（`getSelect` → `getText` フォールバック）でグループ化
- 表示順：日向坂ちゃんねる → 日向坂46 OFFICIAL YouTube CHANNEL → Lemino → その他

### syncToYuNews()
各DBのエントリをDB_YU_NEWSに自動集約。
- **重複防止**：`queryAllUrls()` でページネーション付き全件取得（Published問わず）
- **Description同期**：DB_YOUTUBE・DB_TIKTOKにDescriptionが設定されているエントリは、対応するDB_YU_NEWSレコードのDescriptionも上書き更新（ビルドのたびに実行）
- **TikTokサムネイル**：新規追加時にoEmbedから新鮮なURLを取得（保存済みURLは期限切れになるため）

### Leminoサムネイル（buildLemino）
- Notionに保存済みMediaがあればそれを使用、なければビルド時に `fetchLeminoThumbnail()` でog:imageを取得

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
- **DB_TIKTOK**：URLが設定された全エントリを対象にoEmbedからキャプション（title）を取得してNameに書き込む。最初の`#`以降を削除して保存
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
- `reset_tiktok_yunews.js`：DB_YU_NEWSのTikTokレコードをすべてアーカイブし、DB_TIKTOKから再追加するスクリプト。oEmbedから新鮮なサムネイルURLを取得して設定する

## 注意事項
- 佐藤優羽の読み方は「さとうゆう」。ローマ字表記はYu（芸名読み）を使う
- APIキー等の秘密情報はGitHub Secretsで管理、.envファイルはない
- GitHub Actionsのconcurrencyグループ（`group: deploy`）で同時実行を防止
- DB_YU_NEWSのMediaはバリデーションエラー時にMediaなしで再試行するフォールバックあり
- TikTokのoEmbedサムネイルURLは短時間で期限切れになる。DB_YU_NEWSへの同期時は毎回oEmbedから新鮮なURLを取得する
- 生成済みHTML（index.html等）はgh-pagesブランチにのみ存在。mainブランチにはない
- `index.html` と `top.html` は同一内容（buildIndexで両方生成）

## 画像ファイル管理（images/）

### ディレクトリ構成
- `images/activities/`：活動報告用画像
- `images/committee/`：委員会News用画像
- `ogp.png`（ルート）：SNSシェア用OGP画像（1200×630px推奨）

### ファイル命名規則
**形式**：`YYYY-MM-DD_キーワード.拡張子`

```
2026-04-09_handshake.jpg
2026-04-09_birthday-board.jpg
2026-05-10_gift.png
```

**ルール**：
- 日付は `YYYY-MM-DD` 形式
- キーワードは英数字・ハイフンのみ（日本語・スペース・記号不可）
- 拡張子は小文字（`.jpg` / `.png` / `.webp`）
- 同一日付・同一キーワードは末尾に `-2` `-3` を付ける

### Notionへの設定方法
アップロード後のURLをNotionのMediaフィールドに**外部URL**として設定する：
```
https://ysatoseitan0910.github.io/yusato_seitan/images/activities/2026-04-09_handshake.jpg
```
※ Notionに直接アップロードした画像は約1時間で期限切れになるため、必ず外部URLで設定すること。

## 未着手タスク
- ~~OGP設定の追加~~（完了）
- OGP画像（ogp.png）の作成・アップロード
- yu.html の強化
- ベストコンテンツの厳選セクション
