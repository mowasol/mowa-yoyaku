# mowaプログラミング教室 予約サイト

保護者がログインなしでレッスンを予約できるサイト。Cloudflareは使わず、GitHub と Google（スプレッドシート・Gmail・カレンダー）だけで動く。

## しくみ

```
保護者のスマホ ──▶ 予約ページ（GitHub Pages：docs/）  React + framer-motion
                      │  予約・変更・キャンセル
                      ▼
               Google Apps Script（公開URL）──▶ スプレッドシート（予約データ）
                      │                        ├▶ Gmail（確認メール・前日のお知らせ）
                      │                        └▶ Googleカレンダー（教室の予定に自動登録）
スタッフ ──▶ 管理画面（Apps Script の管理者用URL・@mowasol.com のGoogleログイン必須）
```

- 画面：`docs/`（ビルド不要。React・framer-motion・htm はブラウザが CDN から読む）
- 予約ルール：`docs/js/schedule.js`・`docs/js/core.js`（画面のお試しモードと Apps Script で共通）
- サーバー：`gas/`（Apps Script に貼るファイル。`Shared.gs` は自動生成）

## 前の版に戻すには
作り直す前の版（素のHTML・Cloudflare向け）は、タグ `v1-classic` とブランチ `classic` に残してある。
```
git checkout classic        # 前の版を見る
git checkout main           # 今の版に戻る
```

## お試しモード
`docs/js/config.js` の `API_URL` が空のときは、ブラウザの中だけで動く。
```
python -m http.server 8767 --directory docs
```
→ 予約画面 http://localhost:8767/ ／ 管理画面 http://localhost:8767/admin/

## 予約のルール（管理画面の「設定」で変更できる）
- コース：月1回 / 月2回（内容はお子さまごとに個別）
- 営業時間：平日 17:00〜19:00、土日 9:00〜17:30（休憩 12:00〜13:00）、1コマ60分・定員4人
- 同じ曜日は月4回まで。第5週にあたる日は自動でお休み（「営業日」で個別に振替できる）
- 予約は24時間前まで・62日先まで。変更・キャンセルは24時間前まで（保護者がメールのリンクから）
- 同じ月の中で選ぶ。1日1回まで。定員チェックはサーバー側でロックをかけて行う

## 公開手順（初回だけ）

### 1. スプレッドシートと Apps Script（10分）
1. 教室の管理用Googleアカウント（例：info@mowasol.com）で、新しいスプレッドシートを作る（名前：mowa予約）
2. 拡張機能 → Apps Script を開き、`gas/` の4ファイルを同じ名前で作って中身を貼る
   - `Code.gs`、`Shared.gs`、`Admin.html`、`appsscript.json`（プロジェクトの設定で「appsscript.json をエディタで表示」をオン）
3. プロジェクトの設定 → スクリプト プロパティに追加
   - `SITE_URL`：予約ページのURL（現在 `https://yoyaku.mowasol.com`）
   - `CALENDAR_ID`：予定を入れるGoogleカレンダーのID（カレンダーの設定 → カレンダーの統合）
   - `ADMIN_NOTIFY_EMAIL`：新規予約の通知先（`school@mowasol.com`）
   - `REPLY_TO`：保護者の返信先（空なら `school@mowasol.com`）
4. スプレッドシートを開き直し、メニュー「予約システム」→「初期設定」（権限の確認が出たら許可）

### 2. 公開URLを2つ作る（デプロイ）
1. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
   - **予約受付用**：実行ユーザー「自分」、アクセス「全員」 → URL を `docs/js/config.js` の `API_URL` に貼る
2. もう一度 新しいデプロイ
   - **管理画面用**：実行ユーザー「自分」、アクセス「mowasol.com 内の全員」 → このURLをスタッフに共有（ブックマーク）
3. 管理画面の「設定 → 管理者」に、スタッフのGoogleアカウントを追加する（公開した本人は最初から入れる）

### 3. GitHub Pages
1. GitHub のリポジトリ → Settings → Pages → Branch：`main`、フォルダ：`/docs` → Save
2. 無料プランでは、リポジトリを Public にする必要がある（コードに個人情報や鍵は入っていない。予約データはスプレッドシート側）
3. 独自ドメイン：Pages の Custom domain に `yoyaku.mowasol.com` を入れ、mowasol.com のDNS（GoDaddy）に CNAME（`yoyaku` → `mowasol.github.io`）を1行追加（設定済み）。「Enforce HTTPS」をオン

### 4. 仕上げ
- `privacy.html` の制定日と内容を確認
- 自分で予約 → メール → カレンダー → 変更・キャンセル まで通しで確認

## 予約ルールを直したとき
```
python tools/build_gas.py     # docs/js の予約ルールを gas/Shared.gs に反映
```
そのあと `Shared.gs` を Apps Script に貼り直し、デプロイを「新しいバージョン」で更新する（URLは変わらない）。

## 毎朝9:00の自動処理
- 翌日にレッスンがある家庭へお知らせメール
- レッスンの月から1年過ぎた予約は、名前・連絡先を消す
