-- mowaプログラミング 予約サイト D1 データベース
-- Cloudflare ダッシュボード > D1 > mowa-yoyaku > Console に貼り付けて実行するか、
--   npx wrangler d1 execute mowa-yoyaku --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- 初期設定（中身が空なら画面の既定値が使われる。定員だけはここで判定に使う）
INSERT OR IGNORE INTO settings (key, value) VALUES ('main', '{"capacity":4}');

-- 日付ごとの例外（臨時休業・第5週の振替営業など）
CREATE TABLE IF NOT EXISTS overrides (
  date TEXT PRIMARY KEY,
  open INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);

-- 予約（1家族・1か月分の申込み）
CREATE TABLE IF NOT EXISTS reservations (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,   -- 確認・キャンセル用リンクの鍵
  plan        TEXT NOT NULL,
  month       TEXT NOT NULL,
  child_name  TEXT NOT NULL,
  grade       TEXT NOT NULL,
  parent_name TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  anonymized  INTEGER NOT NULL DEFAULT 0
);

-- 予約の各回（1コマ）
CREATE TABLE IF NOT EXISTS lessons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  date           TEXT NOT NULL,
  time           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active',  -- active / cancelled
  reminded       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lessons_slot ON lessons (date, time, status);
CREATE INDEX IF NOT EXISTS idx_lessons_res  ON lessons (reservation_id);

-- 定員チェック：同時に申し込まれても定員を超えないよう、DB側で止める
CREATE TRIGGER IF NOT EXISTS lessons_capacity
BEFORE INSERT ON lessons
WHEN NEW.status = 'active' AND
  (SELECT COUNT(*) FROM lessons WHERE date = NEW.date AND time = NEW.time AND status = 'active')
  >= COALESCE((SELECT CAST(json_extract(value, '$.capacity') AS INTEGER) FROM settings WHERE key = 'main'), 4)
BEGIN
  SELECT RAISE(ABORT, 'SLOT_FULL');
END;
