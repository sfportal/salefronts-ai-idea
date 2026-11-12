-- Salefronts AI: schema
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  password_hash TEXT,
  google_sub TEXT,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'customer', -- customer | staff | admin | owner
  ref_code TEXT UNIQUE,
  referred_by INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  industry TEXT,
  company TEXT,
  email TEXT,
  user_id INTEGER,
  vid TEXT,
  source TEXT,
  utm TEXT,
  ref_code TEXT,
  tags TEXT DEFAULT '',
  stage TEXT NOT NULL DEFAULT 'new', -- new | contacted | quoted | won | lost
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_leads_phone ON leads(phone);

-- Service templates (kho mau): web | extension | media
CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  industries TEXT DEFAULT '',
  summary TEXT,
  preview_url TEXT,
  demo_url TEXT,
  repo_url TEXT,
  base_price INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 3,
  options TEXT NOT NULL DEFAULT '[]',   -- JSON [{key,label,question,required,price}]
  claude_notes TEXT,                    -- how Claude should modify the template
  guide_md TEXT,                        -- usage guide template for the customer
  accent TEXT DEFAULT '#7c5cff',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  lead_id INTEGER NOT NULL,
  user_id INTEGER,
  vid TEXT,
  kind TEXT NOT NULL,                 -- web | extension | media
  template_id INTEGER,
  status TEXT NOT NULL DEFAULT 'chatting', -- chatting | mockup | awaiting_payment | paid | in_progress | delivered | rejected | cancelled
  fields TEXT NOT NULL DEFAULT '{}',  -- captured answers
  brief TEXT,                         -- JSON summary form
  brief_md TEXT,
  out_of_template INTEGER NOT NULL DEFAULT 0,
  out_of_template_note TEXT,
  mockup_html TEXT,
  mockup_version INTEGER NOT NULL DEFAULT 0,
  revisions_used INTEGER NOT NULL DEFAULT 0,
  price INTEGER NOT NULL DEFAULT 0,
  custom_price INTEGER,               -- admin quote for out-of-template work
  discount INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  ref_code TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  handoff_md TEXT,
  handoff_status TEXT,
  admin_note TEXT,
  reject_reason TEXT,
  deliverables TEXT NOT NULL DEFAULT '[]', -- JSON [{type,title,url,file_key}]
  guide_md TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT,
  approved_at TEXT,
  delivered_at TEXT
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  role TEXT NOT NULL,   -- user | assistant | system
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_order ON messages(order_id);

CREATE TABLE order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  status TEXT,
  note TEXT,
  actor TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  key TEXT NOT NULL,
  name TEXT,
  size INTEGER,
  type TEXT,
  kind TEXT NOT NULL DEFAULT 'upload', -- upload | delivery
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER,
  booking_id INTEGER,
  user_id INTEGER,
  code TEXT UNIQUE NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cancelled | refunded
  qr_url TEXT,
  account_number TEXT,
  bank TEXT,
  kind TEXT NOT NULL DEFAULT 'full',
  provider TEXT NOT NULL DEFAULT 'sepay',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  lead_id INTEGER NOT NULL,
  user_id INTEGER,
  goal TEXT, budget TEXT, pain TEXT, channels TEXT, current_tools TEXT, slots TEXT, detail TEXT,
  price INTEGER NOT NULL DEFAULT 2000000,
  status TEXT NOT NULL DEFAULT 'awaiting_payment', -- awaiting_payment | paid | scheduled | done | cancelled
  scheduled_at TEXT,
  meet_url TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL DEFAULT 'pct', -- pct | amount
  value INTEGER NOT NULL,
  max_uses INTEGER,
  used INTEGER NOT NULL DEFAULT 0,
  min_total INTEGER NOT NULL DEFAULT 0,
  kinds TEXT DEFAULT '',            -- comma list of kinds, empty = all
  starts_at TEXT,
  ends_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE commissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | paid | void
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);

CREATE TABLE template_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  order_id INTEGER,
  votes INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open', -- open | planned | done | dismissed
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE support_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vid TEXT,
  user_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open', -- open | needs_human | closed
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE crm_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  author TEXT,
  content TEXT NOT NULL,
  due_at TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vid TEXT,
  user_id INTEGER,
  type TEXT NOT NULL,
  data TEXT,
  ip TEXT,
  ua TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_user ON events(user_id);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  target TEXT,
  data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
