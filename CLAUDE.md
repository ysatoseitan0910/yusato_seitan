# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# さとうゆほーむ（佐藤優羽生誕祭実行委員会 運営）

## サイト概要
日向坂46五期生・佐藤優羽（さとうゆう）さんのファンポータルサイト。運営：佐藤優羽生誕祭実行委員会。
**公開URL**: https://satoyu.info
ConoHa VPS上で公開。NotionのDBからデータを取得して静的HTMLを自動生成・rsyncでVPSにデプロイする仕組み。

## 技術構成
- `build.js`：NotionのDBからデータを取得してHTMLを自動生成するメインスクリプト
- `add_blog_posts.js`：hinatazaka46.comのブログ一覧ページをスクレイピングしてDB_BLOGに新規記事を自動追加
- `update_blog_thumbnails.js`：DB_BLOGのMediaが未設定のエントリにサムネイル画像を追加
- `update_media_thumbnails.js`：DB_YOUTUBE・DB_LEMINO・DB_YU_NEWSのYoutube/LeminoエントリにMediaサムネイルを追加。DB_TIKTOKのName未設定エントリにoEmbedキャプションを書き込む
- `_template.html`：全ページ共通のナビ・フッター・モーダルテンプレート（{{プレースホルダー}}で差し込み）。YouTube/TikTokのlite-embedクリックハンドラも含む
- `.github/workflows/deploy.yml`：GitHub Actionsで30分ごとに自動ビルド・デプロイ（add_blog_posts → update_blog_thumbnails → update_media_thumbnails → build → rsync to VPS）
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
- `member-blog.html`：他メンバーブログまとめ（DB_MEMBER_BLOG）。メンバー名バッジ＋フィルター付き
- `interview.html`：インタビュー・雑誌掲載集
- `x.html`：Xまとめ
- `tiktok.html`：TikTokギャラリー
- `instagram.html`：Instagramまとめ（blockquote＋embed.js・アカウント別ラベル・もっと見る）
- `youtube.html`：YouTubeまとめ
- `lemino.html`：Leminoまとめ

### 静的ページ（手動管理）
- `yu.html`：佐藤優羽さんについて（プロフィール・魅力・リンク集）。OGP/descriptionメタタグあり
- `about.html`：当委員会について
- `terms.html`：生誕委員規約
- `join.html`：ご参加希望の方へ
- `quiz.html`：さとうゆクイズ（`quiz_questions.json` から10問中5問をランダム出題。4択・解説・参考URLつき）
- `card.html`：プロフィールカードジェネレーター（Canvas描画・PNG保存）。テンプレート4種
- `admin.html`：管理ページ（パスワード認証。Notionへのレコード追加・一覧・削除）

**注意**: 静的ページは `_template.html` を使用せず独立したCSSを持つ。ナビリンクや共通スタイルは手動で同期が必要。
- 全ナビに共通リンク：トップ / ブログ / 他メンバーブログ / YouTube / TikTok / Lemino / **クイズ** / Xまとめ / 佐藤優羽さんについて / 委員会について

## Notion DB一覧
- DB_COMMITTEE_NEWS：生誕委員会News
- DB_YU_NEWS：佐藤優羽さんNews（他DBから自動集約）
- DB_ACTIVITIES：活動報告
- DB_BLOG：佐藤優羽さんBlog
- DB_MEMBER_BLOG：他メンバーブログ（佐藤優羽さんが登場するブログ）。ID: `33e28fd03f5380f6a868d3d1aa3f7755`。Memberプロパティ（multi_select）にブログ執筆メンバー名
- DB_INTERVIEW：インタビュー・雑誌掲載集
- DB_TIKTOK：TikTokまとめ
- DB_INSTAGRAM：Instagramまとめ（Name・Date・URL・Account〈select〉・Published）。embed.jsで埋め込むため公開投稿URLのみ。oEmbed非対応（トークン必須）なのでサムネ・キャプション自動取得はしない
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
- `getMemberNames(page)`：Memberプロパティからメンバー名配列を返す。multi_select → select → rich_textの順で対応
- `getMedia(page)`：Mediaプロパティの外部URL or ファイルURLを返す
- `escAttr(s)`：HTML属性用エスケープ（&, ", <, >）
- `actModalAttrs(p)`：活動報告・委員会Newsカードのモーダル用data属性を生成
- `queryAllUrls(dbId)`：DBの全URL一覧をページネーション付きで取得（syncToYuNews専用）
- `queryDB(dbId, sorts)`：ページネーション対応（100件上限なし）でPublished=trueのみ返す

### トップページレイアウト（buildIndex）
2カラム構成：`grid-template-columns: minmax(0,1fr) 300px`

**左（メインコンテンツ）**：
1. 生誕委員会News：全件をリスト行で表示（クリックでモーダル）
2. 活動報告：4列サムネイルグリッド（`.act-thumb-grid`）
3. 佐藤優羽さんNews：4列均一カードグリッド（`.yunews-grid`）、カード全体がリンク、「すべて見る」→yunews.html

**右（サイドバー）**：
1. スケジュール：DB_SCHEDULEを日付昇順で表示。過去日付はグレーアウト。URLありはリンク
2. YouTube動画：`https://www.youtube.com/watch?v=QXQUKkvSrCQ` で**固定**（lite-embed）
3. Xツイート：`https://x.com/ysatoseitan/status/2083432538823860368` で**固定**（oEmbed取得・遅延読み込み）。差し替えは `build.js` の `buildIndex` 内 `fetchTwitterOembed(...)` のURLを変更する
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

### 他メンバーブログ（buildMemberBlog）
- DB_MEMBER_BLOGを日付降順で全件取得
- `getMemberNames(page)` でメンバー名を取得し、カードに緑バッヂ表示
- `data-members` 属性にカンマ区切りでメンバー名を格納し、クライアントサイドJSでフィルタリング
- メンバーフィルターボタンは表示件数1件以上のメンバーのみ自動生成

### モーダル（_template.html）
活動報告・委員会NewsのクリックでDescriptionを全文表示。
- XSS対策：textContent / createTextNode で描画
- ESCキー・オーバーレイクリックで閉じる
- `[data-act-modal]` 属性を持つカードにイベントデリゲーションで対応
- **委員会Newsリスト行はDescriptionが空でもモーダル属性を付与**（actModalAttrsを使わず直接生成）

## card.html（推しぷろふぃーる）

Canvas（2D）でブラウザ内描画し、PNG形式でダウンロードできるファンカードジェネレーター。
**2026-07-15に「推しぷろふぃーる」（背景画像方式）へ全面刷新**。旧版は `card_old.html` に退避（noindex）。
**詳細は `推しぷろふぃーる_作業メモ.md` を参照**（座標・フォーム項目・Notion連携・VPS設定）。

- 公開状態：**準備中オーバーレイあり**。`?preview=1` を付けたときだけ中身が見える
- テンプレートは1種類のみ：`oshiprofile`（背景 `images/satoyu_osi_profile3.png` / 724×1022px）
- 旧テンプレート（notebook / profilebook 等）の描画関数はコードに残るが `TEMPLATES` には載せていない

### 描画の仕組み
- **背景画像＋文字オーバーレイ**：`drawOshiProfile()` が背景を描き、座標指定で入力文字を重ねる
- **2パスレンダリング**：`measureOnly=true` で高さ計測 → `canvas.height` 確定 → 本描画
- **高解像度ダウンロード**：2×スケールの一時canvasを使用、PNG形式で保存
- **自動サイズ調整**：各欄とも入力文字数に応じてフォントを縮小／拡大し、枠内に収める
- **手動改行**：`wrapText` が `"\n"` を行区切りとして扱う（雲・ベスト3・自由記述は textarea）
- **位置指示用グリッド**：`OSHI_SHOW_GRID = true` で座標グリッドを描画（通常は false）
- **ディスパッチ**：`DRAW_FNS = { id: drawFn }` マップで `tpl.id` をキーに関数を選択

### 入力フィールド
アイコン画像 / かいた日 / なまえ / X ID / 推し（固定「佐藤優羽」）/ 他推し /
じこしょうかい（誕生年・誕生月日・性別・呼ばれ方・MBTI・おひさま歴・自由記述）/
雲①〜⑥ / すきなところ ベスト3 / 自由記述こーなー / イラスト選択（最大3点）

### OGP画像（images/ogp-card.png・2026-08-10 作成）
card.html 専用のOGP。**空のプロフィールカード**を1200×630に組んだもの。作り方：
1. ローカルHTTPで card.html を配信し（`python -m http.server` / `file://` だと背景が
   `/images/...` の絶対パスで読めない）、headless Chrome で `preview-canvas.toDataURL()` を取得
2. その画像を左に置いたOGP用HTMLを作り、`--window-size=1200,630 --screenshot` で撮る
差し替えるときは**ファイル名かクエリを変える**。Xは画像URL単位でキャッシュするため、同名で
上書きしても古い画像が出続ける。

### Xに投稿するボタン（2026-08-10 修正）
PCで投稿画面が開かない不具合が2つ同時にあった。**この2点は触らないこと**。
- **`window.open` は `await` より前・クリックと同じタスクで呼ぶ**。await をはさむと user activation が切れ、
  ポップアップとしてブロックされて何も起きない。`setTimeout` に逃がすのも同じ理由で不可だった
  （旧コードは `setTimeout(() => window.open(...), 600)` で必ずブロックされていた）
- **PCで `navigator.share` を使わない**。PCの共有シートはOSのもので、Xの投稿画面ではない。
  `isMobileDevice()` が true のときだけネイティブ共有（画像添付つき）を使う
- 空タブを `window.open("", "_blank")` で開いて `opener = null` にしてから `location.replace(xUrl)` する。
  `noopener` を features に渡すと戻り値が null になり、ブロックされたのか判別できなくなる

### 委員会への共有（Notion DB_CARDS）
「入力した情報を委員会に共有する」にチェック → `POST /admin-api/cards` → Notion登録＋カード画像をVPSに保存。
- カード画像：`/var/www/satoyu/uploads/cards/<uuid>.png`（Basic認証・ユーザー名 `satoyu`）
- 他推しの有無で `yuzai.png` / `muzai.png` のスタンプが自動で切り替わる

## update_media_thumbnails.js の仕組み
- **DB_YOUTUBE**：全エントリのMediaが未設定のものに動画IDからYouTubeサムネイルを追加
- **DB_LEMINO**：全エントリのMediaが未設定のものにog:imageからサムネイルを追加
- **DB_YU_NEWS**：Platform=Youtube/LeminoでMediaが未設定のものに同様に追加
- **DB_TIKTOK**：URLが設定された全エントリを対象にoEmbedからキャプション（title）を取得してNameに書き込む。最初の`#`以降を削除して保存
- YouTube動画ID抽出：`youtube.com/watch?v=ID` or `youtu.be/ID` → `img.youtube.com/vi/{ID}/maxresdefault.jpg`
- Platformの照合は**大文字小文字を区別しない**

## update_blog_thumbnails.js の対象DB
- **DB_BLOG**：佐藤優羽さんBlog
- **DB_MEMBER_BLOG**：他メンバーブログ（`DB_MEMBER_BLOG` 環境変数で追加）
- 両DBを `processDB(dbId, label)` 関数で共通処理

## update_member_blog_meta.js の仕組み
- **DB_MEMBER_BLOG に URL だけ登録すると、Name（タイトル）/ Date（日付）/ Member（メンバー名）を自動補完**
- 日向坂46公式の記事ページ（`diary/detail/{id}`）から抽出：タイトル=`c-blog-article__title`／日付=`c-blog-article__date`内の`<time>YYYY.M.D`／メンバー名=`<title>`の「◯◯公式ブログ」（空白除去）
- **未設定のプロパティだけ埋める**（手動入力済みの値は上書きしない）
- メンバー名は既存の Member 選択肢に「空白除去＋NFC正規化」で寄せてダブり防止（髙/嶌 等の表記ゆれ対策）
- deploy.yml で add_blog_posts の後・update_blog_thumbnails の前に実行（補完→サムネ付与を同一実行で）
- `DRY_RUN=1` で書き込みせず抽出結果だけ確認可能
- 管理ページの「他メンバーブログ」フォームも **URLのみ必須**に変更（`/add/memberblog`）

## add_blog_posts.js の仕組み
- スクレイピング対象：`https://www.hinatazaka46.com/s/official/diary/member/list?ima=0000&ct=42`
- 抽出クラス：`c-blog-article__title`、`c-blog-article__date`
- DB_BLOGのURLと照合して重複チェック、新規記事のみ追加
- Numberプロパティ：既存DBの最大値+1から連番で付与
- サムネイル正規表現：`cdn.hinatazaka46.com/files/.../diary|moblog/....(jpg|jpeg|png|webp)`
- Descriptionに告知文を自動生成（`buildDescription()`）

## 管理ページ（admin.html + admin-api/）

### 構成
- `admin.html`：フロントエンド（パスワードログイン、DB別フォーム、一覧・削除）
- `admin-api/server.js`：Express APIサーバー（ポート3001）。Docker経由でVPS上で動作
- アクセス：`https://satoyu.info/admin-api/...`（nginxがプロキシ）

### 対応DB・登録できるプロパティ
| DB | プロパティ |
|---|---|
| quiz | 問題文、選択肢A〜D、正解、解説、参考URL・タイトル |
| committee | タイトル、日付、URL、ステータス、締め切り日、説明、画像URL |
| activities | タイトル、日付、URL、ステータス、説明、画像URL |
| x | タイトル、日付、URL、タグ（カンマ区切り） |
| tiktok | URL（必須）、日付、タイトル（任意・oEmbedで自動補完） |
| instagram | URL（必須）、日付、アカウント（任意・select）、タイトル（任意） |
| youtube | タイトル、日付、URL、チャンネル（select） |
| lemino | タイトル、日付、URL、説明 |

### 認証
- `ADMIN_PASSWORD` 環境変数と Bearer トークン照合
- セッションストレージにトークンを保持、リロードで再ログイン不要（タブを閉じるとクリア）

### GitHub Actionsデプロイ連携
- admin.html から GitHub Personal Access Token を登録してワークフローをトリガー可能
- ポーリングで実行状況をリアルタイム表示（6秒間隔、最大40回）

## ユーティリティスクリプト
- `restore_tiktok.js`：DB_TIKTOKのレコードを誤削除した際にgh-pagesのHTML内容から復元するスクリプト
- `deduplicate_yu_news.js`：DB_YU_NEWSの重複レコードを削除するスクリプト（同URLの中で最古を保持、残りをアーカイブ）
- `reset_tiktok_yunews.js`：DB_YU_NEWSのTikTokレコードをすべてアーカイブし、DB_TIKTOKから再追加するスクリプト。oEmbedから新鮮なサムネイルURLを取得して設定する

## VPS構成（satoyu.info）

### サーバー情報
- **VPS**: ConoHa（Ubuntu 24.04）、IP: `133.88.117.39`
- **ドメイン**: `satoyu.info`（Aレコード → `133.88.117.39`）
- **公開ディレクトリ**: `/var/www/satoyu/`
- **nginx**: newsmindアプリと同一VPS上のDockerコンテナ（`~/newsmind/nginx/nginx.conf`）

### デプロイの仕組み
GitHub Actions（deploy.yml）がビルド後にrsyncでVPSへ転送：
```
rsync -avz --delete [除外ファイル一覧] ./ root@133.88.117.39:/var/www/satoyu/
```

### 必要なGitHub Secrets（yusato_seitanリポジトリ）
| Secret名 | 内容 |
|---|---|
| `VPS_HOST` | `133.88.117.39` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | `/root/.ssh/github_actions_satoyu` の秘密鍵 |
| `DB_MEMBER_BLOG` | `33e28fd03f5380f6a868d3d1aa3f7755`（他メンバーブログDB） |

### nginx設定（~/newsmind/nginx/nginx.conf）
- `server_name satoyu.info www.satoyu.info` → `/var/www/satoyu` を静的配信（HTTPS）
- HTTP → HTTPS リダイレクトあり（Let's Encrypt / certbot 設定済み）
- `server_name _` + `default_server` → newsmindアプリへproxy（IP直アクセス用）
- SSL証明書：`/etc/letsencrypt/live/satoyu.info/` にマウント（Dockerコンテナ読み取り専用）
- webroot認証用：`/var/www/certbot` をDockerボリューム共有

### VPS操作メモ
```bash
ssh newsmind  # ローカルのSSH設定でエイリアス設定済み
cd ~/newsmind
docker compose up -d --force-recreate nginx  # nginx設定変更の反映
docker compose exec nginx nginx -t           # 設定の文法チェック
docker compose restart satoyu-admin          # admin-api/server.js を変更したとき
docker compose up -d --force-recreate satoyu-admin  # 環境変数を足したとき（restartでは読まれない）
```

### リポジトリ管理外だが必須のVPS設定（2026-07-15 追加）
`~/newsmind/` 配下。コンテナや設定を作り直すときは必ず入っているか確認する。
- **`nginx/nginx.conf`**：satoyu.info の `location /admin-api/` に `client_max_body_size 20m;`
  無いと既定1MBで、カード画像（base64が1MB超）のPOSTが413のHTMLで返り、フロントで
  `Unexpected token '<', "<html> <h"... is not valid JSON` になる（Express側は5MB）
- **`docker-compose.yml`**：`satoyu-admin` の volumes に `- /var/www/satoyu/uploads:/var/www/satoyu/uploads`
  無いとカード画像がコンテナ内部にしか書かれず、公開URLが404になる（コンテナ再作成で消失）
- **`nginx/nginx.conf` のCSP**（2026-07-19 追加・instagram.html用）：`script-src` に `https://www.instagram.com https://static.cdninstagram.com`、`frame-src` に `https://www.instagram.com` を追加。
  無いと Instagram の `embed.js` がCSPでブロックされ、埋め込みが表示されない（blockquoteのリンクだけ残る）

## CSS変数（全ページ共通）
`_template.html` および全静的ページで統一している変数名：
- `--emerald-dark: #1f7a52`（濃いエメラルド）
- `--emerald-light: #d4ecde`（薄いエメラルド）
- `--emerald: #3DAA78`、`--emerald-pale: #ecf7f0`

**注意**: 旧名 `--emerald-deep` / `--emerald-soft` は廃止。静的ページを新規作成・編集する際は上記の変数名を使うこと。

## モバイルレイアウト（トップページ）
スマホ縦表示では `display: contents` でサイドバーを解体し、`order` で並び順を制御。
- `.top-sidebar-links`（クイックリンク）には `width: 100%` が必要（flex stretch が自動で効かないため）

## セキュリティ上の要注意点（2026-08-07 全体点検で判明・対処済み）
- **rsync は `.git` を除外する**。除外し忘れて `/var/www/satoyu/.git` が配信され、`https://satoyu.info/.git/` から全ソースと履歴が取得できる状態だった。**`--exclude` を足しても既存分は消えない**ので、事故時は `rm -rf /var/www/satoyu/.git` が別途必要
- **未認証エンドポイント（`POST /messages` `/cards`）は型チェックを try の外でやらない**。文字列以外が来ると `.trim()` が TypeError になり、Express 4 は async の reject を拾わないため**プロセスごと落ちる**
- **画像アップロードは PNG マジックバイトとサイズを検証する**（`isValidPng`）。検証が無いと未認証で任意ファイルを自ドメインにホスティングされる
- **未認証入力を Notion の select / multi_select にそのまま渡さない**。Notion は未知の選択肢を自動作成するため、DBのセレクト定義を無限に汚染できる（`pickAllowed` で許可リスト化）
- **未認証エンドポイントで `e.message` をそのまま返さない**。Notion のエラー文には DB ID やプロパティ名が含まれる
- 管理API の `auth` は IP単位で失敗回数を制限し、`crypto.timingSafeEqual` で比較する

## フォント（中国語フォント混入の防止）
日本語サイトで字形が中国語フォントになる事故が2経路ある。**新規CSS・新規canvas描画では必ず両方守ること**。

### 1. フォント指定を素の `serif` / `sans-serif` / `cursive` で終わらせない
Windows では generic フォントに CJK 字形が無く、フォントリンクで中国語フォント（SimSun / Microsoft YaHei）に落ちる。
全ページの `:root` に定義済みの変数で受け止める：
```css
--jp: 'Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic','YuGothic','Meiryo','MS PGothic',sans-serif;
--jp-serif: 'Noto Serif JP','Hiragino Mincho ProN','Yu Mincho','MS PMincho',serif;
```
```css
font-family: 'Zen Maru Gothic', var(--jp);   /* ○ */
font-family: 'Zen Maru Gothic', serif;       /* × 中国語フォントに落ちる */
```
canvas 側（card.html）は `f(size, bold, family)` が `JP_FALLBACK` を自動で付けるので、`ctx.font` を直書きせず必ず `f()` を使う。

### 2. canvas は Google Fonts のサブセットが読まれない（2026-08-10 実測）
Google Fonts の日本語は `unicode-range` で百数十個に分割配信され、ブラウザは**DOMに現れた文字**のサブセットしか取得しない。
canvas にしか描かない文字はWebフォントが無いまま描画され、別フォントに落ちる。`々`（U+3005）が典型。

実測（headless Chrome）：
```
document.fonts.ready 完了後
  document.fonts.check("40px 'Zen Maru Gothic'", "々")  → false   ← 未取得
  document.fonts.load(...) 実行後                        → true
```
**`document.fonts.ready` を待つだけでは不十分**。card.html では `fillText`/`strokeText` をラップして描画文字を集め、
`syncGlyphs()` が `document.fonts.load(spec, 文字列)` でサブセットを取り寄せてから再描画する。
書き出し（download / shareToX / submitCard）は `await glyphsReady()` で取り寄せ完了を待つ（待たないと保存画像だけ字形が崩れる）。

## 日付の扱い
GitHub Actions は **UTC** で動くため、`new Date()` や `toISOString()` をそのまま使うと JST の 0〜9時に日付が1日ずれる。
**日付判定は必ず `todayJst()` を使う**（締切バッジ・スケジュールの過去判定・Lemino の配信終了判定で実際にずれていた）。

## デプロイの安全設計（2026-08-07 改修）
2026-08-06 に「ビルド失敗が成功扱いになり、`rsync --delete` が本番の全HTMLを削除して403」という障害が発生した。その再発防止として以下を入れている。**変更するときは必ず理由を理解してから**。

- **全スクリプトは失敗時に `process.exit(1)`**：`main().catch(console.error)` だと終了コード0になり、生成物が無いまま次のステップへ進んでしまう
- **rsync 直前の検証ステップ**（`Verify build output`）：必須HTML16件の存在と最低サイズを確認し、欠けていればデプロイを中止する
- **収集系ステップは `continue-on-error: true`、ビルドのみ致命的**：収集の一時失敗ではサイト更新を止めず、壊れた成果物は転送しない
- **GitHub Pages への公開は廃止**：satoyu.info はVPS(nginx)配信で、Pagesは独自ドメイン無しの重複ミラーだった。gh-pages への push が毎回 `pages build and deployment` を誘発してタイムアウトし、全デプロイが失敗表示になっていた

**所要時間**：改修により約10分26秒 → **約1分23秒**（別途動いていた失敗する Pages ビルド約10分も消滅）

## 注意事項
- **Notionのプロパティ名は大文字小文字を区別する**。mediaプロパティはDBにより名前が違う（`Media`=委員会News/活動報告/カード/他メンバーブログ、`media`=TikTok/YouTube/Lemino/メッセージ）。コードは固定名を使わず、スキーマから大小無視で解決する実装になっている（固定 "Media" にしていた頃は全書き込みが validation_error で失敗し、1実行あたり約3分半を浪費していた）
- 佐藤優羽の読み方は「さとうゆう」。ローマ字表記はYu（芸名読み）を使う
- APIキー等の秘密情報はGitHub Secretsで管理、.envファイルはない
- GitHub Actionsのconcurrencyグループ（`group: deploy`）で同時実行を防止
- DB_YU_NEWSのMediaはバリデーションエラー時にMediaなしで再試行するフォールバックあり
- TikTokのoEmbedサムネイルURLは短時間で期限切れになる。DB_YU_NEWSへの同期時は毎回oEmbedから新鮮なURLを取得する
- 生成済みHTML（index.html等）はVPSの `/var/www/satoyu/` に存在。mainブランチにはない
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
https://satoyu.info/images/activities/2026-04-09_handshake.jpg
```
※ Notionに直接アップロードした画像は約1時間で期限切れになるため、必ず外部URLで設定すること。

## 未着手タスク
- ~~OGP設定の追加~~（完了）
- ~~VPS移行（satoyu.info）~~（完了）
- ~~HTTPS設定（Let's Encrypt / certbot）~~（完了）
- ~~yu.html にOGP・descriptionメタタグ追加~~（完了）
- ~~全ページナビにクイズリンク追加~~（完了）
- ~~他メンバーブログページ（member-blog.html）追加~~（完了）
- ~~プロフィールカードジェネレーター（card.html）テンプレート拡充（案4〜6追加）~~（完了）
- ~~管理ページの委員会News・活動報告フォームにステータス・画像・締め切りフィールド追加~~（完了）
- OGP画像（ogp.png）の作成・アップロード
- ベストコンテンツの厳選セクション
- GitHub Secretsに `DB_MEMBER_BLOG` を追加（手動作業が必要）
