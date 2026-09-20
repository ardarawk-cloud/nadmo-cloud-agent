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

  CREATE TABLE IF NOT EXISTS lead_verifications (
    lead_id INTEGER PRIMARY KEY,
    verdict TEXT NOT NULL,
    official_url TEXT,
    evidence_title TEXT,
    evidence_snippet TEXT,
    checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

const saveVerificationStmt = db.prepare(`
  INSERT INTO lead_verifications (
    lead_id, verdict, official_url, evidence_title, evidence_snippet, checked_at
  )
  VALUES (@leadId, @verdict, @officialUrl, @evidenceTitle, @evidenceSnippet, CURRENT_TIMESTAMP)
  ON CONFLICT(lead_id) DO UPDATE SET
    verdict = excluded.verdict,
    official_url = excluded.official_url,
    evidence_title = excluded.evidence_title,
    evidence_snippet = excluded.evidence_snippet,
    checked_at = CURRENT_TIMESTAMP
`);

const listLeadsStmt = db.prepare(`
  SELECT
    id,
    name,
    source_url AS sourceUrl,
    page_title AS pageTitle,
    phone,
    email,
    instagram,
    status,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM leads
  ORDER BY updated_at DESC, id DESC
`);

export function upsertLead(lead) {
  upsertLeadStmt.run(lead);
}

export function listLeads() {
  return listLeadsStmt.all();
}

export function logActivity(action, details = {}) {
  logStmt.run(action, JSON.stringify(details));
}

export function saveVerification(verification) {
  saveVerificationStmt.run(verification);
}

export function listReviewLeads() {
  return db.prepare(`
    SELECT
      l.id,
      l.name,
      l.phone,
      l.email,
      l.instagram,
      l.source_url AS sourceUrl,
      l.status,
      v.verdict,
      v.official_url AS officialUrl,
      v.checked_at AS checkedAt
    FROM leads l
    JOIN lead_verifications v ON v.lead_id = l.id
    WHERE v.verdict IN ('NO_OFFICIAL_SITE_FOUND', 'SOCIAL_ONLY', 'DEAD_WEBSITE')
      AND (l.phone IS NOT NULL OR l.email IS NOT NULL OR l.instagram IS NOT NULL)
    ORDER BY
      CASE WHEN l.phone IS NOT NULL THEN 1 ELSE 0 END DESC,
      CASE WHEN l.email IS NOT NULL THEN 1 ELSE 0 END DESC,
      CASE WHEN l.instagram IS NOT NULL THEN 1 ELSE 0 END DESC,
      l.updated_at DESC
  `).all();
}

export function closeDb() {
  db.close();
}
