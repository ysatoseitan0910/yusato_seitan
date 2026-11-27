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
- `quiz.html`：さとうゆクイズ（`quiz_questions.json`（Notion の DB_QUIZ から生成）の全問からランダムに10問を出題。4択・解説・参考URLつき）
- `card.html`：さとうゆ推しぷろふぃーる（Canvas描画・PNG保存）
- `admin.html`：管理ページ（パスワード認証。Notionへのレコード追加・一覧・削除）
- `serial_scanner.html`：**委員会の内部ツール**（シリアル番号をカメラで連続読み取り。2026-10-04 配置）。
  サイト内からリンクしない・sitemap に載せない・`<meta name="robots" content="noindex, nofollow">`。
  robots.txt には書かない（書くとパスが公開される）。学習データ（約660KB の JSON）を埋め込んでいるので
  ファイルが大きいが、外部送信は無く、読み取り結果は localStorage のみ。
  OCR 補助の Tesseract.js を CDN から読むため、**nginx にこのパス専用の CSP がある**（下記 nginx設定）

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
`tiktok_meta.js` の `fetchTikTokThumb()` で取る。期限切れ問題を避けるためNotionには保存しない。
- 2026-11 ごろから oEmbed が title / thumbnail_url を返さなくなったので、動画ページに埋め込まれた JSON（desc / cover）から取る
- **取れた URL は `state/tiktok-thumbs.json` に控える**（2026-11-27）。URL は署名付きで約2日有効。期限まで18時間を切ったものだけ、
  同時4件までで取り直し、失敗しても期限内なら控えを使う。毎回100件以上を一度に取りに行くと TikTok に弾かれ、
  その回のビルドでサムネイルがほぼ全滅していた（107件中2件）。`state/` は deploy.yml が VPS と行き来させる（`.gitignore` 済み）
- 画像そのものは保存しない（TikTok の URL を参照するだけ）

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

## card.html（さとうゆ推しぷろふぃーる）

Canvas（2D）でブラウザ内描画し、PNG形式でダウンロードできるファンカードジェネレーター。
**2026-07-15に「さとうゆ推しぷろふぃーる」（背景画像方式）へ全面刷新**。旧版は `card_old.html` に退避（noindex）。
**詳細は `推しぷろふぃーる_作業メモ.md` を参照**（座標・フォーム項目・Notion連携・VPS設定）。

- 公開状態：**一般公開済み**（2026-08-10 に準備中オーバーレイを削除）
- テンプレートは1種類のみ：`oshiprofile`（背景 `images/satoyu_osi_profile3.png` / 724×1022px）
- 旧テンプレート（notebook / profilebook 等）の描画関数はコードに残るが `TEMPLATES` には載せていない

### 名称の統一（2026-08-10）
機能名の表記は **「さとうゆ推しぷろふぃーる」** に統一済み（ナビ・title・OGP・h1・
テンプレート名・プライバシーポリシー・サイト情報）。「プロフィールカード作成」「推しぷろふぃーる」
「カード作成」は使わない。ただし**ハッシュタグだけは `#さとうゆ推しプロフィール`（カタカナ）**で、
すでに告知ポスト済みのため変更しない。ナビのグループ名「カード作成 ▾」はメッセージカードも
束ねる見出しなので据え置き。

### 描画の仕組み
- **背景画像＋文字オーバーレイ**：`drawOshiProfile()` が背景を描き、座標指定で入力文字を重ねる
- **2パスレンダリング**：`measureOnly=true` で高さ計測 → `canvas.height` 確定 → 本描画
- **高解像度ダウンロード**：2×スケールの一時canvasを使用、PNG形式で保存
- **自動サイズ調整**：各欄とも入力文字数に応じてフォントを縮小／拡大し、枠内に収める
- **手動改行**：`wrapText` が `"\n"` を行区切りとして扱う（雲・ベスト3・自由記述は textarea）
- **位置指示用グリッド**：`OSHI_SHOW_GRID = true` で座標グリッドを描画（通常は false）
- **ディスパッチ**：`DRAW_FNS = { id: drawFn }` マップで `tpl.id` をキーに関数を選択

### 入力フィールド
アイコン画像（写真アップロード or イラストから選択）/ かいた日 / なまえ / X ID / 推し（固定「佐藤優羽さん」）/ 他推し /
じこしょうかい（誕生年・誕生月日・性別・呼ばれ方・MBTI・おひさま歴・自由記述）/
雲①〜⑥ / すきなところ ベスト3 / 自由記述こーなー / イラスト選択（最大3点）

### アイコン画像（2026-08-10 追加）
- カードの写真枠（実測 x645〜975 / y175〜415）をタップすると、アイコン設定欄へスクロールする。
  `fieldZoneMap["__icon"]` に登録し、`scrollToField` で個別分岐（このセクションだけ `#fields-list` の外にある）
- 「イラストから選ぶ」でイラストをアイコンにできる。イラストは**透過PNGで縦長**なので、
  512角のcanvasに下地(#ecf7f0)を敷いて contain で配置してから data URL 化し、
  通常のアップロードと同じ `setIconFromDataUrl` に流す。
  cover にすると顔が切れ、下地が無いと丸窓から背景が透ける
- 「イラストを選ぶ」（カードに貼る3点）は**初期状態では未選択**。localStorageに選択を保存する

### レイアウトの実測値（2026-08-10 レビューで確定）
背景画像に文字を重ねる方式なので、座標は**背景画像を測って**決める。目分量で広げると破綻する。
- **雲メモの文字枠は幅160が上限**。雲はもこもこで左右端が細く、幅160なら高さ86〜90取れるが、
  幅170にすると高さ47まで落ちる。以前は幅205×高さ105だったため、2行になると1行目が雲の外に出ていた
- **ベスト3**：数字の中心 y=1125 / 1240 / 1353、仕切りの点線 y=1179 / 1298、枠内側下端 y=1414、
  枠内側右端 x=506。maxH はこれらまでの短いほう×2
- **自由記述**：見出し「こーなー」の下端 y=1122、雲の内側下端 y≒1395
- **なまえ欄**：内側 y200〜292・点線 y296。長い名前＋X IDは横並びにせず2行に分ける
  （横並びのままだと名前が「…」で切れて読めなくなる）
- 折り返しは `wrapText`。英数字の連なりを1かたまりとして扱い（「2026」→「20/26」を防ぐ）、
  行頭禁則は**繰り返し追い出す**（1文字だけ送ると「デュ|ー」→「デ|ュー」で解消しない）

### OGPのメタタグ（2026-08-10 判明）
**`twitter:title` / `twitter:description` が無いと、Xでカードが組み立てられず画像が出ない。**
`og:` だけでは不十分。実際に card.html はこの2つが欠けていて、Twitterbot がページも画像も
200 で取得できているのに（nginxログで確認済み）カードが表示されなかった。
表示できていた weekly.html は `twitter:title` / `twitter:description` を持っていた。
新規ページを作るときは以下をセットで書くこと。
```
og:type / og:site_name / og:title / og:description / og:url / og:image / og:locale
twitter:card=summary_large_image / twitter:title / twitter:description / twitter:image
```
**切り分け方**：`ssh newsmind` → `docker compose logs nginx | grep Twitterbot` で、
Xが実際に何を取りに来て何を返したかが分かる。200が返っていればサーバー側は無実で、
原因はメタタグかXのキャッシュ。

### OGP画像（images/ogp-card.png・2026-08-10 作成）
card.html 専用のOGP。**空のプロフィールカード**を1200×630に組んだもの。作り方：
1. ローカルHTTPで card.html を配信し（`python -m http.server` / `file://` だと背景が
   `/images/...` の絶対パスで読めない）、headless Chrome で `preview-canvas.toDataURL()` を取得
2. その画像を左に置いたOGP用HTMLを作り、`--window-size=1200,630 --screenshot` で撮る
差し替えるときは**ファイル名を変える**（クエリではなくファイル名）。Xは画像URL単位で
キャッシュするため同名で上書きしても古い画像が出続けるが、`?v=` を付けると
X側で画像が使われないことがあったので、クエリなしの新しいファイル名にすること。

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
- 他推しは「他推し１」「他推し２」の2欄。Notionへは分けずに「、」でつないで `OtherOshi` ひとつに入れる

### 推し行とスタンプ（2026-08-10 変更）
- 佐藤優羽さんの呼び名は**雲④「佐藤優羽さんの呼び方」の入力**を使う（未入力なら「佐藤優羽さん」）
- 他推しが両方とも空 → 「<呼び方>一推し！」
- 他推しに入力あり → 「<呼び方>、○○、△△」と「、」でつなぐ（「他推し」の見出しは出さない）
- スタンプは**他推しの入力件数**で切り替わる（`STAMP_BY_OTHER_OSHI`）：0件=`muzai` / 1件=`yuzai` / 2件=`cho_yuzai`
- `yuzai` / `muzai` / `cho_yuzai` は**スタンプ専用**（`STAMP_ONLY_ILLUSTS`）で、イラスト選択肢からは除外。
  入れると同じ絵がカード内に2つ出るため。選択肢（`PICKER_ILLUSTS`）は18種

## sugoroku.html（さとうゆすごろく・2026-11-26 追加）
ユーザーが描いた盤面2枚（2025/3〜2026/4・2026/4〜ゴール）で遊ぶ、あなた vs コンピューターのすごろく。
**入口（サイト内リンク）は未定のため noindex・sitemap 未掲載**（`build.js` の `buildSugoroku` で noindex を付けている）。
- **画面**：`sugoroku_body.html`（盤面・演出）を `buildSugoroku` が `_template.html` に差し込んで生成。
  マスの座標 `XY` は盤面を 2000×845 に縮めたときの雲の中心（1〜40＝前半 board1、41〜67＝後半 board2、68＝ゴール）。
  盤面は `images/sugoroku/board1.webp` / `board2.webp`（3200px・各約330KB）。元の PNG（7115px）は手元だけ（.gitignore）。
  コマは盤面の自転車の絵を切り出した `piece_you.webp` / `piece_cpu.webp`
- **ルール・マスの文面・サイコロ・ランキングはサーバー**（`admin-api/sugoroku.js`、`server.js` から `register(app, auth)`）。
  不正防止のため進行はすべてサーバー：状態は HMAC 署名トークン（鍵は ADMIN_PASSWORD 由来）でブラウザに持たせ、
  サイコロは「ゲームID・手番・誰・何個目」から決まる（古いトークンを送り直しても同じ目＝振り直し不可）。
  サーバーに状態を持たないので、デプロイのたびの satoyu-admin 再起動でもゲームは続く
- 止まったマスの指示で移動した先の指示は無視（連鎖しない）。ゴールは超えてもよい。5/1 の偶数・奇数判定のサイコロは回数に数えない
- **ランキング**：ゴールしたトークンでだけ登録（同じゲームは1回）。`/var/www/satoyu/uploads/cards/sugoroku/ranking.json`
  （Basic 認証のかかった場所。公開は API 経由のみ）。不適切な名前は `GET/DELETE /sugoroku/admin/ranking`（管理者認証）で消せる
- API：`GET /sugoroku/board`・`POST /sugoroku/start`・`POST /sugoroku/turn`・`POST /sugoroku/finish`・`GET /sugoroku/ranking`
- **マスのポップアップ**：自分のコマが止まると、日付・できごと・指示を大きく表示（閉じると指示が実行される）。
  盤面の雲をタップしても開ける（`.sg-hit` の透明ボタン）。盤面の文字が小さく読みにくいため（2026-11-26）
- **関連リンク**：`admin-api/sugoroku.js` の `LINKS`（マス番号 → URL）。ヒストリー DB から日付と内容が合うものを選んだ（54マス）。
  ボタンの文言は URL から自動（YouTube／Lemino／ブログ／公式サイト／掲載誌）。同じ種類が並ぶときは `{ u, label }` で補足
- **Lemino の配信終了**：`/sugoroku/board` が Lemino のリンク先を6時間ごとに確かめ、配信が終わった回（ページが 404、
  または番組情報が無い・配信終了日を過ぎた）に `closed` を付ける → ポップアップで「（現在非公開）」と表示（リンクは残す）。
  Lemino の配信期間は1〜2年なので、時間がたつと自動で増える。取得に失敗した回は非公開扱いにしない

## message.html（お誕生日メッセージカード）
背景画像に本文と名前を重ねてPNG保存／委員会へ送信するページ。card.html と同じ設計方針で作り直した。
- 公開状態：**一般公開済み**（2026-09-10 に準備中オーバーレイを削除。複数人の実機テスト後に公開）
- **描画サイズ**：プレビュー 1344px幅、書き出し 2688px幅（背景 `message_card_2026.webp` の等倍）。
  以前は背景PNGそのまま（5374×3248＝1,745万px）で描き、2倍書き出しが6,980万pxになって
  iOS Safari の canvas 上限を超えていた。元の PNG（1.4MB）はリポジトリに残しているが未使用
- **本文は自動縮小**：選んだサイズ（小/中/大）を上限に、`ZONES.msg.maxY`（From の名前行の上）に
  収まるまで `MIN_FS_RATIO` まで縮める。それでも入らなければ描画を打ち切り、入力欄の下に
  「あと◯文字」を赤字で出して保存・送信ボタンを無効にする。**200文字の上限はどのサイズでも
  そのままでは収まらない**（実測：小で188文字、中で124文字が From 線に重なっていた）
- **名前は幅 `ZONES.name.maxW` に収める**：縮小→それでも超えれば「…」で省略
- **折り返しは card.html の wrapText と同じ**（禁則処理＋英数字を1かたまり）
- **フォントは JS の `FONTS` 配列が唯一の定義**（ボタンは生成）。追加するときは
  ① `FONTS`、② `<head>` の Google Fonts、③ `admin-api/server.js` の `ALLOWED_FONTS`（先頭のフォント名で照合）の3か所。
  現在8種：Zen Maru Gothic / Yusei Magic / Zen Kurenaido / Yomogi / Hachi Maru Pop / Noto Sans JP / Shippori Mincho / Caveat（英字のみ）
- **サブセット取り寄せ**：入力欄は Zen Maru Gothic なので、別フォントを選ぶと描く文字のサブセットが
  未取得のまま別フォントに落ちる。`ensureGlyphs()` がフォントごとに描いた文字を集めて
  `document.fonts.load()` し、完了後に描き直す。保存は `_glyphPending` を待ってから
- **下書き（localStorage）は `satoyu_msg_draft_v2`**。復元値は `sanitizeState()` で許可リストに丸める。
  v1 には修正前の `var(--jp)` 入りフォント指定が残っていて、復元すると本文が描けなかった
- **送信は確認ダイアログを1段はさむ**。送信後も画面の内容は消さない（PNG保存し忘れ対策）。
  下書きだけ消して「送信済み」表示にし、内容を変えるまで再送信できない
- **PNG保存は iOS で Web Share にフォールバック**（`a.download` が効かないため。card.html と同じ）
- **サーバ側**：`Date` は `jstToday()`（UTC だと JST 0〜9時が前日になる）、レート制限は 10件/時/IP
  （3件だと同じWi-Fiの3人目が弾かれる）
- **OGP画像は `images/ogp-message.png`**（カードの見本入り・1200×630）。差し替えるときはファイル名を変える

### カード画像の保存（2026-09-10 追加）
送信時に書き出しと同じ 2688px のカードを **JPEG（品質0.9・約0.4MB）** で `imageBase64` に同梱する。
- サーバは `isValidImage()` で PNG/JPEG の魔法数とサイズ（5MB）を検証し、
  `/var/www/satoyu/uploads/cards/messages/<uuid>.jpg` に保存 → Notion の **`URL`（url型）** に登録。
  あわせて `media`（files）にも外部URLで入れておく（Notion 上でサムネイルが出る）。管理APIは `URL` を優先して読む
- **保存先を `/uploads/cards/` 配下にしているのは nginx の Basic 認証を流用するため**
  （`location /uploads/cards/` の前方一致）。nginx の変更は不要
- 画像が作れない・不正・保存失敗のときもメッセージ本文は登録する（`/cards` と同じ方針）。
  ブラウザ側も `buildImageBase64()` が失敗したら null を返してテキストだけ送る
- 送信成功時は `#done-box`（大きな緑のパネル）を出す。以前は小さな帯が出るだけで送れたか分かりにくかった
- 管理ページのメッセージ一覧に画像列（サムネイル→クリックで原寸）と CSV の画像URL列を追加

## トップページURLの一本化（2026-08-17）
トップは `/` `/index.html` `/top.html` の3URLで同じ内容に到達でき、検索エンジンに別ページとして
認識されていた。**正規URLは `https://satoyu.info/`** に統一済み。触るときは4点セットで守ること。
- `build.js`：`INDEX_PAGE_FILE`（= `index.html`）を目印に、canonical / og:url を `SITE_URL + "/"` にする。
  index.html と top.html は同じ `buildIndex` から出力されるので、top.html の canonical も `/` を指す
- `<title>`：テンプレートは `{{HEAD_TITLE}}`（完成形を差し込む）。トップだけ `INDEX_HEAD_TITLE` で
  **「さとうゆほーむ | 日向坂46五期生・佐藤優羽さん非公式ファンサイト」**。「トップ | さとうゆほーむ」だと
  検索キーワード（佐藤優羽・日向坂46）が1語も入らなかったため。og:title / twitter:title も同じ値になる
- **ナビのリンクは `/`**（ロゴ・「トップ」とも）。`index.html` / `top.html` を直接リンクしない。
  静的ページは `_template.html` を使わないので、新規ページを作るときは手で `/` にすること
- `sitemap.xml` のトップは `https://satoyu.info/`（末尾に index.html を付けない）

**`.htaccess` は効かない**。配信は Apache ではなく nginx（Docker）なので、301は
`~/newsmind/nginx/nginx.conf` に書く。`location = /` を `try_files /index.html =404;` で直接処理するのは、
そうしないと index ディレクティブが `/` を `/index.html` へ内部転送し、`location = /index.html` に
再マッチしてリダイレクトループ（rewrite or internal redirection cycle）になるため。

### ページタイトルの決め方（2026-08-17）
**タイトルには必ず「佐藤優羽」を入れる。**「ブログまとめ | さとうゆほーむ」のように機能名だけだと、
実際に検索される「佐藤優羽 ブログ」に1語も当たらない（description に入っていても代わりにならない）。
- `build.js` の `buildPage(tpl, "…"` の第2引数がタイトル。**ページ内の見出し（h1）は第3・第4引数で別物**なので、
  タイトルを変えても表示は変わらない
- SNSまとめ系（X/TikTok/Instagram/YouTube/Lemino）は「佐藤優羽さん登場の〜」で統一
- 日本語で検索される語を使う（`News` ではなく **ニュース**）
- 日本語の検索結果は約30文字で切れる。`| さとうゆほーむ` の9文字を含めて収める
- 規約・入会・サイト情報・プライバシー・さとうゆ推しぷろふぃーるは据え置き（検索需要が無い／機能名を統一済み）
- 静的ページは `<title>` / `og:title` / `twitter:title` の**3か所すべて**を揃える

### 構造化データ（JSON-LD・2026-08-17）
- `_template.html`：`WebSite`（サイト名・運営組織・対象人物）→ 自動生成ページ全体に入る
- `yu.html`：`Person`（読み・生年月日・出身地・所属・公式ページ）。同姓同名との取り違えを防ぐため
- **`image` に写真を入れない**。構造化データに入れるとGoogleが検索結果で使うため、公式写真では避ける
- `sameAs` は本人を指す公式ページのみ。本人名義のSNSアカウントは存在しない

### nginx.conf の反映手順（2026-08-17 実測）
VPSの `/root/newsmind` は **GitHubのクローン**で、newsmind の deploy.yml が push のたびに
VPS上で `set -e` 付きの `git pull origin main` を実行する。**VPSで直接ファイルを書き換えると
（scp含む）作業ツリーが汚れ、次の pull が "Your local changes would be overwritten" で失敗して
newsmind のデプロイごと落ちる**。必ず「ローカルでコミット → push → VPSで pull」の順で行う。
nginx.conf だけの変更なら、コミットメッセージに `[skip ci]` を付ければ newsmind 本体の
ビルド・マイグレーション・コンテナ入れ替えを走らせずに済む。

**`nginx -s reload` では反映されない。`docker compose up -d --force-recreate nginx` が必要。**
nginx.conf は `./nginx/nginx.conf:/etc/nginx/nginx.conf:ro` と**単一ファイルでbind mount**されており、
`git pull` はファイルを置き換える（inodeが変わる）ためコンテナ側が古いファイルを掴んだままになる。
`nginx -t` は古い内容を読んで成功するので、**テストが通ったのに301が効かない**という形で現れる。
確認は `docker compose exec -T nginx grep -c 'location = ' /etc/nginx/nginx.conf` のように
コンテナ内の実体を見ること。

**2026-09-02 更新：newsmind の deploy.yml がこの罠を自動で処理するようになった。**
入れ替え前に `docker compose run --rm --no-deps nginx nginx -t` で新しい nginx.conf を検査し
（誤りがあればデプロイが止まり旧設定で動き続ける）、`up -d` のあとに host とコンテナの
inode を比べて違えば `up -d --force-recreate --no-deps nginx` を実行する。
したがって **nginx.conf の変更に `[skip ci]` を付けてはいけない**（付けると検査も作り直しも
走らず、上の「テストが通ったのに効かない」状態になる）。普通に push すれば反映される。
手動の `docker compose up -d --force-recreate nginx` は非常時の手段として残る。

## 新着の自動検出（2026-11-25 追加）
更新が滞りがちだったため、手作業で拾っていたものを deploy.yml（30分ごと）で自動検出する。
どれも `continue-on-error`（失敗してもサイト更新は止めない）。rsync の除外にも入れてある。

### 他メンバーブログ：`sync_member_blog_bsky.js`
- Bluesky の **blogphotobot**（`blogphotobot.bsky.social`）を公開API（認証不要）で読む。
  日向坂46公式ブログの写真を投稿するボットで、**画像ごとの alt に写っている人がカンマ区切りで入る**
- 1/2・2/2 に分かれた投稿は記事ID（`diary/detail/<id>`）でまとめる。本人のブログは除外（DB_BLOG の担当）
- **集合写真の判定**：佐藤優羽さんが写る画像のうち**最少人数**で決める。
  4人以下＝公開で登録／5〜8人＝**下書き（Published=false）**で登録／9人以上＝集合写真として登録しない。
  タグはあるが alt で特定できないものも下書き。alt は長いと「…, 佐藤優」で切れるので前方一致で見る
- Name・Date は Bluesky から入れ、Member は空で登録 → 直後の `update_member_blog_meta.js` が公式ページから補完
- 通常は**直近3日分だけ**を見る（誤検出を Notion から消したときに復活させないため）。
  過去分は `BSKY_SINCE=YYYY-MM-DD` で一度だけ流す
- **下書きは Notion で確認して Published を入れる**。weekly さとうゆは公開分だけを載せる（`queryByDate(..., true)`）

### Lemino：`sync_lemino.js`
- 番組ページ（クールごとの「グループ」）の `__NEXT_DATA__` に、各回の `availability_start`（配信開始）・
  `synopsis_info`（先頭の【…】が副題）と、**同じ番組の他クール（parentContents）**が入っている。
  起点のグループから他クールを辿るので、**クールが変わっても設定不要**（起点ページの配信期限 2027年12月まで）
- 出演者は「日向坂46」としか無く、**佐藤優羽さんの出演回は判定できない**。
  日向坂で会いましょう＝全回公開／まだまだ！日向坂で会いましょう＝あらすじに佐藤・優羽があれば公開、無ければ下書き
  （従来「まだまだ！」は一部の回だけ登録していたため）
- Date は配信開始日（JST）。サムネイルは `update_media_thumbnails.js`、年表・Yu News へは build.js の同期が公開分を取り込む
- 通常は直近14日。過去分は `LEMINO_SINCE=YYYY-MM-DD`
- 「日向坂になりましょう」は対象外（起点を `PROGRAMS` に足せば同じ仕組みで拾える）

### X 告知の下書き（2026-11-25 追加・投稿は人が行う）
- **管理ページ**：「✍ ブログ告知の下書き」（blog.html から読む）／「💐 minsaka 告知の下書き」（minsaka.json から読む）。
  コピーか X の投稿画面（intent）を開くだけで、自動投稿はしない
- **Discord**：GitHub Secret `DISCORD_WEBHOOK_URL`（Webhook URL）があるときだけ送る。共通処理は `discord.js`
  - 新着ブログ：`add_blog_posts.js` が登録直後に下書き＋**記事の写真（委員会内の確認用）**を添付で送る。3日より古い記事は送らない
  - minsaka：`notify_minsaka.js` が主催企画一覧（`sakaseru.jp/mina/user/organized-events/244297`）を読み、
    募集開始／残り7・3・1日のリマインド／募集終了・お礼 を送る。文面は **`minsaka.js` だけ**で管理（管理ページと共用）
  - 他メンバーブログ：`sync_member_blog_bsky.js` が検出のたびに送る（執筆メンバー名・タイトル・日付・URL・佐藤優羽さんが写る写真）。
    5人以上の写真は「集合写真の可能性あり」を添える（9人以上はサイトには登録しないが Discord には送る）。
    執筆メンバー名は公式ブログの `<title>` から取る（Bluesky のハッシュタグは「ポカ」＝公式マスコット のような愛称のことがある）
  - **他メンバーブログの判定（2026-11-25 改定）**：①説明文で 20人以上・卒業メンバー入り → 公式ビジュアルとして登録しない、
    ②**Claude の画像判定**（`photo_judge.js`・`claude-opus-5-5`・Secret `ANTHROPIC_API_KEY`）で official（グッズ・メニュー・
    ポスター・告知画像・ライブ写真など）とされた写真を除外、③五期生が集まった写真は人数に関係なく公開、④残りは人数で判定。
    Claude が candid と言い切れない（unsure のみ）ときは下書き。判定は通知・登録するときだけ行う（費用を抑えるため）。
    9月以降の32件で、ユーザー指定の 71571（公開）・71493 / 71790（除外）どおりになることを確認済み
  - 管理ページ「🔎 他メンバーブログの確認」で公開・非公開をボタンで切り替えられる（API `/publish` `/unpublish`）
  - **カード画像は佐藤優羽さんが写っている写真**（2026-11-26〜）：登録時に `pickPhoto()`（公式の画像を除き、Claude の candid 優先・
    少人数順）で選び、**同じ位置の公式ブログの写真 URL（`cdn.hinatazaka46.com`）**を `Media` に入れる。
    Bluesky の写真は「『タイトル』 1/2」の番号順に並べ直すと公式ブログ本文の写真と1枚ずつ対応する（縦横比で全数一致を確認）。
    枚数が合わないときは取り違えを避けて入れない（→ update_blog_thumbnails.js が記事の1枚目を入れる）。
    **画像を自サーバーにダウンロードして置き直すことはしない**（著作権上の配慮。公式の URL を参照して表示する）。
    過去分は Discord backfill の `member_media_since` で差し替え済み（150件が佐藤優羽さんの写真・12件は対応が取れず1枚目）。
    縦長写真が多いので member-blog.html のカードは `object-position:center 20%`
  - お誕生日：`notify_birthday.js` が誕生日の3日前から送る（お祝いポストは当日 0:00 に投稿している）。
    メンバー・誕生日・サイリウムカラーは **`members.js`**。卒業・加入・カラー変更（例：山下葉留花さんは
    2026-10-25 から エメラルドグリーン×サクラピンク）があったら直す。ハートはカラーに合わせる（`HEART`）
  - 送り先のスレッド ID は `discord.js` の `THREADS`（ブログ告知用／ブログ写真／他メンバーブログ／祝花／他メンバーお誕生日）
  - 送った記録は `state/*.json`。Actions の実行環境は消えるので **VPS の `/root/satoyu-state/` に置き**、deploy.yml の
    `Restore notify state` で取ってきて `Save notify state` で書き戻す（`merge_state.js` で VPS 側とまとめてから）。
    記録が無いときは記録だけして送らない（過去分を一斉に送らないため）
  - 過去分をまとめて送るときは手動ワークフロー **Discord backfill**（`discord-backfill.yml`）。動作確認は **Discord test**

### 公式ニュース → スケジュール・ヒストリー：`sync_official_news.js`（2026-11-26 追加）
- 公式ニュース一覧（`news/list?dy=YYYYMM`）のイベント／リリース／ミート＆グリート／その他／メディアの記事本文を
  **Claude（claude-opus-5-5）に読ませ**、新しく決まった予定（ライブ・イベント・発売・ミーグリ・佐藤優羽さんのメディア出演）を
  1日1行で DB_SCHEDULE に公開で登録（URL はニュース記事）。チケット・注意事項・グッズ・特典・期間限定タイアップは入れない。
  **「ひなた坂46」の活動は佐藤優羽さんが明記されているときだけ**（18th で表題選抜だったのに ひなた坂46 LIVE が入りかけた）
- 重複は Claude に既存スケジュール（この実行で足した分を含む）を見せて判定＋日付と名前の一致でも見る
- 読んだ記事IDは `state/official-news.json`（VPS と行き来）。通常は直近10日、過去分は Discord backfill の `news_since`（`dry_run` で試せる）
- **公開スケジュールは DB_HISTORY にも入れる**（2026-09-01 以降・手入力の予定も対象・**先の予定も含む**。history.html では未来の日付に「予定」の印）。Type は名前から（`historyType`）。
  ヒストリーとの重複はかっこ書きを除いた名前の一致・包含・URL で判定
- 2026-11-26 に 9月以降を流し込み済み（スケジュール約23件・ヒストリー9件）

### 年表（DB_HISTORY）
`sync_official_news.js` がスケジュールの過ぎた予定を入れる（上記）ほかは、**build.js の `syncToHistory()` が DB_BLOG / DB_LEMINO / DB_INTERVIEW / DB_YOUTUBE の公開分を
自動で集約している**（2026-07-06 以降の日付のみ）。年表が止まって見えるときは、元の DB が止まっている。

### weekly さとうゆの自動生成（deploy.yml の `Generate weekly さとうゆ`）
- **月曜 12:00（JST）以降**に「前の週（月〜日）」を作る。日曜深夜放送の Lemino 回は月曜 01:50 に配信開始し、
  上の同期 → build の年表同期を経てから weekly に入るので、月曜の朝までは待つ
- 管理API `/generate/weekly` に **`onlyIfMissing`** を渡し、作成済みの週は作り直さない（管理ページでの手直しを上書きしない）
- 管理APIのパスワードを GitHub に置かないよう、**VPS のコンテナ内から**呼ぶ（`docker compose exec satoyu-admin node -e "fetch(...)"`）
- **OGP 画像（ogp/weekly.png）は自動では作らない**。管理ページの「プレビューを作成 → このOGP画像を設定」で更新する

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
- **同居するドメイン**: `newsmind.online`（2026-09-02 から。newsmind アプリの入口。同じ nginx・同じ
  `/etc/letsencrypt` を使う。satoyu.info のブロックには手を入れていない）

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
- `server_name _` + `default_server`（80番）→ **2026-09-02 から `https://newsmind.online` へ 301**。
  それ以前は newsmind アプリへの proxy（IP 直アクセス用）だった。satoyu.info は自分の
  80番ブロックで受けるので影響しない
- **443 の既定サーバーは `ssl_reject_handshake on`（2026-09-02 追加）。** 名前が一致しない SNI
  （IP 直打ちの https・未知のホスト名）は握手の段階で断る。これが無いと satoyu.info の
  443 ブロックが既定になり、別ドメイン宛ての https でこのサイトが証明書の警告付きで見えていた
- `newsmind.online` の 443 ブロックは `~/newsmind/nginx/ssl.d/newsmind-ssl.conf`（Git 管理外。
  newsmind の deploy.yml が証明書の存在を確かめてからテンプレートを複写する）。
  nginx.conf 本体は `include /etc/nginx/ssl.d/*.conf` で読む
- SSL証明書：`/etc/letsencrypt/live/satoyu.info/` と `/etc/letsencrypt/live/newsmind.online/`
  （Dockerコンテナ読み取り専用）。newsmind.online の更新は certbot の deploy-hook が nginx を reload
- webroot認証用：`/var/www/certbot` をDockerボリューム共有（両ドメイン共通）
- newsmind のデプロイで nginx.conf が変わると nginx コンテナが作り直される（数秒の断）。
  satoyu.info も同じコンテナから配信しているので、その間は一緒に止まる

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
- **`nginx/nginx.conf` の `location = /serial_scanner.html`**（2026-10-04 追加）：このパスだけ専用の CSP
  （`script-src` に `'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net`、`worker-src blob:`、
  `connect-src` に `https://cdn.jsdelivr.net https://tessdata.projectnaptha.com`）。
  共通 CSP のままだと Tesseract.js の読み込みが `script-src` で拒否され、OCR 補助が黙って無効になる
  （ページ自体は学習済みテンプレートで動く）。location 内の `add_header` は server 側を継承しないので、
  共通側に CSP 以外の `add_header` を足したときはこのブロックにも足すこと
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

### 1-b. canvas の `ctx.font` に CSS変数（`var(--jp)`）を書かない（2026-08-17 実測）
**canvas は CSS変数を解決しない。** `ctx.font = "30px 'Zen Maru Gothic',var(--jp)"` は文字列全体が
不正と判定され、**代入そのものが無視されて既定の `10px sans-serif` のまま描画される**。
エラーも警告も出ないので、「なぜか文字が極小・別フォント」という形でしか気づけない。
```js
ctx.font = "30px 'Zen Maru Gothic',var(--jp)";  ctx.font // → "10px sans-serif"（代入されていない）
ctx.font = "30px 'Zen Maru Gothic'";            ctx.font // → '30px "Zen Maru Gothic"'
```
実際に `2adf5e2`（中国語フォント混入の対策）で `sans-serif` を `var(--jp)` に一括置換した際、
CSSと同じ感覚で canvas 側まで書き換えてしまい、以下が壊れていた（2026-08-17 に修正）。
- `admin.html` の weekly OGP画像：全文字が極小になった
- `message.html` のメッセージカード：5374px幅のcanvasに10pxで描かれ、**本文が事実上見えなかった**
  （`data-font` 属性の値がそのまま `ctx.font` に入る。style属性側はCSSなので `var(--jp)` でよい）
- `card_old.html` のアイコン文字

canvas に渡すフォントは**実名で並べる**こと（`card.html` の `JP_FALLBACK` / `admin.html` の `OGP_FAM`）。

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

### 30分ごとの起動は VPS の cron が担う（2026-11-25）
GitHub Actions の `schedule` は混雑時に間引かれ、**実測で1日3〜5回（4〜10時間おき）**しか動いていなかった。
そこで VPS の cron から `workflow_dispatch` を叩いて起動している（手動実行は間引かれない）。`schedule` は予備として残す。
- cron：`10,40 * * * * /root/bin/satoyu-dispatch.sh`（混む毎時0分・30分を避けている）
- トークン：`/root/.satoyu_dispatch_token`（600）。fine-grained PAT・`yusato_seitan` の **Actions: Read and write のみ**・**期限1年（2027-11 頃に切れる）**
- ログ：`/var/log/satoyu-dispatch.log`（直近1000行）。正常は `HTTP 204`。**期限切れは `HTTP 401`** → 新しいトークンを同じファイルに入れ直すだけ。
  切れてもサイトは壊れず、間引かれた `schedule` だけに戻る
- ビルドの中身は deploy.yml のままなので、安全装置（rsync 前の検証）はそのまま効く

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
