
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS units (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  unit_code TEXT NOT NULL REFERENCES units(code),
  client TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  due_date TEXT,
  total INTEGER NOT NULL CHECK(total >= 0),
  paid INTEGER NOT NULL DEFAULT 0 CHECK(paid >= 0),
  status TEXT NOT NULL DEFAULT 'UNPAID',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_date TEXT NOT NULL,
  unit_code TEXT NOT NULL REFERENCES units(code),
  kind TEXT NOT NULL CHECK(kind IN ('INCOME','EXPENSE')),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  counterparty TEXT,
  amount INTEGER NOT NULL CHECK(amount >= 0),
  taxable INTEGER NOT NULL DEFAULT 1,
  tax_base_amount INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  tax_estimate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PAID',
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_proofs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_at INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO units(code,name) VALUES
  ('BWD','Bali Wedding DJ'),
  ('STUDIO','NADMO Studio'),
  ('LIVE','NADMO LIVE'),
  ('OTHER','Unit Usaha Lainnya');

INSERT OR IGNORE INTO settings(key,value) VALUES
  ('tax_rate','0.005'),
  ('tax_method','PPh Final UMKM - PT Perseroan Perorangan'),
  ('annual_turnover_limit','4800000000'),
  ('company_name','PT NADMO Studio Indonesia'),
  ('seeded','0');
