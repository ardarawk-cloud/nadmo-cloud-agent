import Database from "better-sqlite3";
import { config } from "./config.js";

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    source_url TEXT NOT NULL UNIQUE,
    page_title TEXT,
    phone TEXT,
    email TEXT,
    instagram TEXT,
    status TEXT NOT NULL DEFAULT 'INSPECTED',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const upsertLeadStmt = db.prepare(`
  INSERT INTO leads (name, source_url, page_title, phone, email, instagram, status)
  VALUES (@name, @sourceUrl, @pageTitle, @phone, @email, @instagram, @status)
  ON CONFLICT(source_url) DO UPDATE SET
    name = excluded.name,
    page_title = excluded.page_title,
    phone = excluded.phone,
    email = excluded.email,
    instagram = excluded.instagram,
    status = excluded.status,
    updated_at = CURRENT_TIMESTAMP
`);

const logStmt = db.prepare(`
  INSERT INTO activity_log (action, details)
  VALUES (?, ?)
`);

export function upsertLead(lead) {
  upsertLeadStmt.run(lead);
}

export function logActivity(action, details = {}) {
  logStmt.run(action, JSON.stringify(details));
}

export function closeDb() {
  db.close();
}
