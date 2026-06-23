# さとうゆポータル — 作業メモ

## 概要

| 項目 | 内容 |
|---|---|
| リポジトリ | `C:\Users\kosho\yusato_seitan` |
| 公開先 | GitHub Pages（`ysatoseitan0910.github.io/yusato_seitan`） |
| デプロイ | GitHub Actions（30分おき自動 + 手動トリガー可） |
| CMS | Notion（DB_BLOG, DB_YU_NEWS, DB_ACTIVITIES 等） |
| バックエンド別リポジトリ | `C:\Users\kosho\satoyu-portal`（開発中・未デプロイ） |

---

## 完了した作業

### 誕生日メッセージ機能（message.html）2026-06

ブラウザ内Canvas描画でメッセージカードを生成し、Notion DBに保存する機能。

**フォーム入力項目**
- メッセージ本文（文字サイズ・フォント・文字色選択可）
- ファンネーム
- X ID（省略可）

**Canvas描画**
- `ZONES` 定数でメッセージ枠・名前位置を比率指定
- 名前は `FROM_LINE_Y` 基準で「緑線の少し上」に動的配置（`textBaseline='top'`）
- 名前フォントサイズは文字サイズ設定によらず常に「小」で統一
- X IDがある場合、名前欄に「ファンネーム（@handle）」と表示

**スパム対策**
- ハニーポット（非表示フィールド `#hp-url`）でbot判定
- IPレートリミット：1時間あたり3件まで（`msgRateMap`）

**Notionへの保存プロパティ**
`Name`（ファンネーム）、`Date`、`Message`（本文）、`Font`（multi_select）、`Size`（multi_select）、`X`（rich_text）

**デプロイ**
- `deploy_message.yml`（手動トリガー専用）を作成
- `rsync --checksum` でファイル内容ベースの差分転送

---

### プロフィールカードジェネレーター 機能拡充（card.html）2026-06

既存のcanvas描画カードを大幅に拡張。

**情報共有機能**
- 「委員会に送る」ボタンを廃止し「入力した情報を委員会に共有する」チェックボックスに変更
- ダウンロード・X投稿ボタン押下時にチェック済みならNotion DB（DB_CARDS）へ自動送信
- X IDで重複チェック：同一IDの既存レコードをアーカイブして最新のみ保持
- スパム対策：ハニーポット＋IPレートリミット1時間10件

**他推しフィールド**
- 「他推しは？（さとうゆ一推しの場合は空欄）」入力欄を追加
- 入力あり → `yuzai.png`、未入力 → `muzai.png` をイラスト1枠目に自動セット
- イラスト手動選択をyuzai/muzai除外の8種・最大4枚に変更（1枠目は自動）

**My Best さとうゆ（ライブ）**
- 各エントリに「ライブ名」「楽曲名」の2フィールドを持つ形式
- カード表示：`1. ライブ名の楽曲名`（「」なし）
- 入力例：「新参者のガラス窓が汚れてる」等

**My Best さとうゆ（バラエティ等）**
- 「バラエティ等」に名称変更
- 入力例：「ひななりのボイトレ回」等

**さとうゆの好きなところ**
- ラベルを「○○なさとうゆが大好き！」に変更（入力した語句が `〇〇なゆうちゃんが大好き！` に展開）
- 「好きなところ（自由記述）」テキストエリアを追加

**テンプレート**
- ノート縦型をデフォルトに変更

**Notionへの保存プロパティ（DB_CARDS）**
`Handle`（X ID・重複排除キー）、`BestLive1〜3`、`BestVar1〜3`、`OshiLike`、`OshiLikeFree`、`OtherOshi`、その他プロフィール項目全件

---

### プライバシーポリシーページ（privacy.html）2026-06

- 独立した静的ページとして新規作成
- 機能別（message.html / card.html）に取り扱い内容を説明
- チェックボックスの挙動・利用目的・管理方法・保管期間・問い合わせ先を記載
- message.html・card.html に本ページへのリンクを追記

---

### 管理ページ更新（admin.html）2026-06

**他メンバーブログフォーム追加**
- サイドバーに「📔 他メンバーブログ」ボタンを追加
- フォーム項目：タイトル、日付、URL、メンバー名（カンマ区切り）、説明
- server.js の `/add/memberblog` エンドポイントで Member multi_select として保存

**メッセージビュー独立化**
- 「✉ メッセージ」をパネルタブから分離し、サイドバーの独立ボタンに移動
- クリックでパネルタブ・フォーム・一覧を非表示にし、メッセージ一覧エリアを全面表示
- 他DBボタン押下で通常ビューに戻る（`showMessages()` / `switchDB()` 関数）

---

### APIサーバー（admin-api/server.js）2026-06

| 追加・変更点 | 内容 |
|---|---|
| `app.set('trust proxy', 1)` | nginxプロキシ越しに正しいIPを取得 |
| `DB.messages` | DB_MESSAGES 環境変数追加 |
| `DB.cards` | DB_CARDS 環境変数追加 |
| `DB.memberblog` | DB_MEMBER_BLOG 環境変数追加 |
| POST `/messages` | メッセージ保存（ハニーポット・レートリミット・Font/Size multi_select） |
| POST `/cards` | カード情報保存（ハニーポット・レートリミット・Handle重複アーカイブ） |
| POST `/add/memberblog` | 他メンバーブログ追加（Member multi_select） |

---

### デザイン刷新（B案 Kawaii Stack）
- `_template.html` を全面リニューアル
  - フォント: Klee One + Caveat
  - カラー: エメラルドグリーン + ピンク + バターイエロー
  - ドット境界線・カラーシャドウ・スタンプ風アクセント
- `yu.html`・`about.html`・`terms.html`・`join.html` を新デザインに置き換え

### サイト再編成
- サイト名を「さとうゆポータル」に変更（運営：佐藤優羽生誕祭実行委員会 をサブテキストに）
- ナビゲーション順を変更：ファンコンテンツ優先 → 委員会コンテンツ
- トップページの佐藤優羽さん News をメインに、委員会 News・活動報告をサブに

### YouTubeまとめページ
- Channel 別 → **Type 別**表示に変更
- 表示順: 個人PV → ドキュメンタリー → 企画 → 生配信 → MV → コール動画 → ひななり → ひなこい
- カード左上バッジに Channel 名を表示

### 佐藤優羽さん News サムネイル自動取得
- **YouTube**: URL からビデオ ID を抽出し `img.youtube.com` のサムネイルを自動生成（API不要）
- **TikTok**: oEmbed API から並列取得（期限切れ対応）
- **X**: 取得不可のためプレースホルダー表示のまま
- トップページ・News ページ両方に適用

### その他
- **X** を Yu News 自動集約から除外（DB_X に追加しても Yu News に入らない）
- X ページの説明文を「佐藤優羽さん関連の X 投稿をまとめています」に変更

### クイズ機能
- `quiz_questions.json`（リポジトリ内 JSON）で問題を管理
- `generate_quiz.js` を使って問題を手動生成・追加
- ナビに「クイズ」リンクを追加、`quiz.html` を自動生成

---

## クイズ機能の使い方

```bash
# 1. .env ファイルを作成（初回のみ）
# C:\Users\kosho\yusato_seitan\.env に以下を記述
ANTHROPIC_API_KEY=sk-ant-...

# 2. ブログURLを指定して問題を生成
cd C:\Users\kosho\yusato_seitan
node generate_quiz.js "https://www.hinatazaka46.com/s/official/diary/detail/XXXXX"

# 内容確認だけ（保存しない）
node generate_quiz.js --dry-run "URL"

# 3. 公開
git add quiz_questions.json
git commit -m "クイズ問題を追加"
git push
```

- 問題の削除・修正: `quiz_questions.json` を直接テキストエディタで編集 → push
- GitHub Actions が `quiz.html` を自動再ビルド

---

## 今後の作業（TODO）

### yu.html の修正
- [ ] 「委員会セレクト・ベストコンテンツ」セクションのリンクを `#` から実URLに差し替え
- [ ] 「これまでの歩み（タイムライン）」の日付・内容を史実に合わせて校閲・追記
- [ ] 本人写真の使用許諾が取れたら、モノグラムを写真に差し替え（方法は下記参照）

**写真差し替え方法（yu.html ヒーロー）:**
```html
<!-- 現状 -->
<div class="hero-stamp">
  <div class="hero-stamp-mark">優</div>
</div>

<!-- 差し替え後 -->
<div class="hero-stamp" style="padding:0;">
  <img src="images/portraits/yu_hero.jpg" alt="佐藤優羽"
       style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
</div>
```

### satoyu-portal バックエンド（開発中・VPS移行時に再開）
- リポジトリ: `C:\Users\kosho\satoyu-portal`
- 実装済み:
  - Express + PostgreSQL（ポート 5433 で開発用 Docker）
  - ファンメッセージ投稿・承認ワークフロー（`/api/messages`）
  - 委員会管理者パネル（`/api/admin`、bcrypt + express-session 認証）
  - DB マイグレーション（`migrations/001_initial.sql`）
- 未実施:
  - ConoHa VPS へのデプロイ
  - ドメイン設定・HTTPS
  - GitHub Pages → VPS への切り替え
  - フロントエンド（ファンメッセージ表示 UI）

**VPS 移行の推奨手順（パターン A）:**
1. GitHub Pages → VPS（Nginx）に配信先を変更（Notion CMS はそのまま）
2. satoyu-portal API を VPS 上で起動（ポート 3002）
3. ドメイン取得・DNS 設定・Let's Encrypt で HTTPS
4. 将来: NocoDB を VPS に追加して Notion ライクな DB 管理 UI を用意

### OGP 画像
- [ ] 現在は既存の `ogp.png` を流用中。B案テイストに合わせた画像に差し替えたい場合は別途作成

---

## ファイル構成メモ

```
yusato_seitan/
├── _template.html        # 全ページ共通テンプレート（ナビ・フッター等）
├── build.js              # Notion → HTML ビルドスクリプト
├── generate_quiz.js      # クイズ問題生成 CLI（ローカル実行）
├── quiz_questions.json   # クイズ問題データ（git管理）
├── yu.html               # 佐藤優羽さんについて（手書き・build.jsで生成しない）
├── about.html            # 委員会について（同上）
├── terms.html            # 規約（同上）
├── join.html             # 入会案内（同上）
├── add_blog_posts.js     # ブログ新着をNotionに追加
├── update_media_thumbnails.js  # YouTube/Lemino/TikTokサムネイル更新
└── .github/workflows/deploy.yml  # GitHub Actions（30分おき自動デプロイ）
```

---

## Notion DB 一覧

| 変数名 | 内容 |
|---|---|
| DB_COMMITTEE_NEWS | 委員会 News |
| DB_YU_NEWS | 佐藤優羽さん News（各DBから自動集約） |
| DB_ACTIVITIES | 活動報告 |
| DB_BLOG | ブログ |
| DB_INTERVIEW | インタビュー・雑誌掲載 |
| DB_TIKTOK | TikTok |
| DB_X | X（Xまとめページ専用・Yu Newsには集約しない） |
| DB_YOUTUBE | YouTube |
| DB_LEMINO | Lemino |
| DB_WEB | Web記事 |
| DB_SCHEDULE | スケジュール |
