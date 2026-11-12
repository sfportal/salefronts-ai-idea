-- Request submission deadline (5 days to pay) and staff contact SLA
ALTER TABLE orders ADD COLUMN submitted_at TEXT;
ALTER TABLE orders ADD COLUMN pay_deadline TEXT;

-- Wallet
ALTER TABLE users ADD COLUMN wallet_balance INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS wallet_tx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,            -- + top-up/refund, - spend
  kind TEXT NOT NULL,                 -- topup | spend | refund | adjust
  ref TEXT UNIQUE,                    -- payment code / export id, makes credits idempotent
  note TEXT,
  balance_after INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_tx(user_id);

-- Self-serve media studio templates (managed in admin)
CREATE TABLE IF NOT EXISTS studio_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'image',  -- image | video
  layout TEXT NOT NULL DEFAULT 'promo',-- promo | story | cover | reel
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1080,
  price INTEGER NOT NULL DEFAULT 20000,
  accent TEXT DEFAULT '#7c5cff',
  overlay_key TEXT,                    -- optional PNG frame uploaded by admin
  sample_key TEXT,                     -- optional preview image uploaded by admin
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS studio_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  template_id INTEGER NOT NULL,
  price INTEGER NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO studio_templates (name,kind,layout,width,height,price,accent,description,sort) VALUES
 ('Banner vuông khuyến mãi','image','promo',1080,1080,20000,'#ff7a45','Ảnh vuông 1:1 cho bài đăng Facebook, Zalo, Instagram: ảnh sản phẩm, tiêu đề lớn, giá và nút kêu gọi.',0),
 ('Story / Reels dọc 9:16','image','story',1080,1920,20000,'#ec4899','Ảnh dọc cho Story Facebook, Zalo, TikTok: ảnh nền toàn màn hình, tiêu đề và lời kêu gọi.',1),
 ('Ảnh bìa ngang','image','cover',1200,628,20000,'#3d8bfd','Ảnh ngang cho bìa fanpage, quảng cáo link, website.',2),
 ('Video slideshow 9:16','video','reel',1080,1920,50000,'#a855f7','Video dọc 10 đến 30 giây từ ảnh của bạn: chuyển cảnh, chữ chạy, logo, lời kêu gọi cuối video.',3);

INSERT OR IGNORE INTO settings (key,value) VALUES ('wallet_min_topup','50000');
INSERT OR IGNORE INTO settings (key,value) VALUES ('pay_days','5');
INSERT OR IGNORE INTO settings (key,value) VALUES ('contact_hours','8');
