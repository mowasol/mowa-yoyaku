# mowaプログラミング教室 予約サイト

保護者がログインなしでレッスンを予約できるサイト。Cloudflare Workers 1つで、画面・予約API・管理画面をまとめて動かす。

## しくみ

```
保護者のスマホ ──https──▶ Cloudflare（独自ドメイン）
                           ├ 画面（public/）…… 予約・確認・個人情報ページ
                           ├ Worker（src/index.js）…… /api/* 予約の受付・定員チェック
                           │    └ D1（データベース）…… 予約・設定・休業日
                           ├ Turnstile …… いたずら予約・ボット対策
                           └ Access …… /admin を許可したGoogleアカウントだけに
GitHub（コード置き場）──push──▶ Cloudflare が自動で公開
メール送信：Resend（予約確認・前日リマインド・管理者への通知）
```

## 予約のルール（管理画面の「設定」で変更できる）
- コース：月1回 / 月2回（内容はお子さまごとに個別）
- 営業時間：平日 17:00〜19:00、土日 9:00〜17:30（休憩 12:00〜13:00）
- 1コマ60分・定員4人
- 同じ曜日は月4回まで。第5週にあたる日は自動でお休み（「営業日」タブで個別に振替できる）
- 予約は24時間前まで、62日先まで。変更・キャンセルは24時間前まで、保護者がメールのリンクから行う
- 同じ月の中で選ぶ。1日1回まで
- 定員はデータベースのトリガーでも確認するため、同時に申し込まれても定員を超えない

## お試しモード
サーバーが無い状態（ローカルで `public/` を開いたとき）は、ブラウザの中だけで動くお試しモードになる。
```
python -m http.server 8765 --directory public
```
→ http://localhost:8765/ （予約画面）、http://localhost:8765/admin/ （管理画面）

## 公開手順（初回だけ・30〜60分）

### 1. GitHub
1. GitHub に非公開リポジトリ `mowa-yoyaku` を作り、このフォルダをpushする

### 2. Cloudflare（無料プランでOK）
1. Cloudflare アカウントを作り、独自ドメインを追加する（ネームサーバーをCloudflareに変更）
2. **D1**：Storage & Databases → D1 → 「mowa-yoyaku」を作成 → Console に `schema.sql` の中身を貼って実行
3. 作ったD1の **Database ID** を `wrangler.jsonc` の `database_id` に書く
4. **Workers**：Workers & Pages → Create → 「Import a repository」で GitHub の `mowa-yoyaku` をつなぐ（以後、pushするたびに自動で公開される）
5. Worker の Settings → Domains & Routes で独自ドメイン（例：`yoyaku.mowasol.com`）を追加
6. `wrangler.jsonc` の `SITE_URL` をそのドメインに変更

### 3. 管理画面を守る（Cloudflare Access）
1. Zero Trust → Access → Applications → Self-hosted を追加
   - ドメイン：`yoyaku.xxx/admin*` と `yoyaku.xxx/api/admin*` の2つ
   - ポリシー：許可するメールアドレス（教室スタッフのGoogleアカウント）
   - ログイン方法：Google（またはメールで届くワンタイムコード）
2. アプリの **AUD タグ** を `ACCESS_AUD` に、チーム名（`xxx.cloudflareaccess.com`）を `ACCESS_TEAM_DOMAIN` に書く
3. 念のため `ADMIN_EMAILS` にも同じアドレスをカンマ区切りで書く（二重チェック）

### 4. ボット対策（Turnstile）
1. Turnstile → サイトを追加（ドメインを指定）
2. サイトキーを `TURNSTILE_SITE_KEY` に、シークレットキーを Worker の Secrets `TURNSTILE_SECRET` に入れる

### 5. メール（Resend）
1. resend.com でアカウントを作り、送信用ドメインを認証（DNSに数行追加。Cloudflareなら自動）
2. APIキーを Worker の Secrets `RESEND_API_KEY` に入れる
3. `MAIL_FROM`（送信元）と `ADMIN_NOTIFY_EMAIL`（新規予約の通知先）を書く

### 6. 仕上げ
- Security → WAF → Rate limiting で `/api/reservations` に「1分に10回まで」などの制限をかける
- `privacy.html` の制定日を書き、内容を確認する
- 自分で一度予約 → メールが届く → 確認リンクで変更・キャンセルできることを確認

## ファイル
| ファイル | 内容 |
|---|---|
| `public/index.html` `js/book.js` | 予約画面（コース → 日時 → お子さま情報 → 確認） |
| `public/reservation.html` `js/reservation.js` | 予約の確認・日時変更・キャンセル |
| `public/admin/` `js/admin.js` | 管理画面（予約一覧・営業日・設定・CSV） |
| `public/js/schedule.js` | 営業日とコマの計算（画面とWorkerで共通） |
| `public/js/core.js` | 予約ルールの判定（画面のお試しモードとWorkerで共通） |
| `public/js/api.js` | API呼び出しとお試しモード |
| `src/index.js` | Worker本体（D1・Access確認・Turnstile・メール・毎朝の処理） |
| `schema.sql` | データベースの定義 |
| `wrangler.jsonc` | Cloudflareの設定 |

## 毎朝9:00の自動処理
- 翌日にレッスンがある家庭へリマインドメール
- レッスンの月から `RETENTION_DAYS`（既定365日）が過ぎた予約は、名前・連絡先を消す
