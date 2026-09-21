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
    category TEXT,
    area TEXT,
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

  CREATE TABLE IF NOT EXISTS discord_notifications (
    lead_id INTEGER PRIMARY KEY,
    sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS lead_outreach_status (
    lead_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'REVIEW_PENDING',
    approved_at TEXT,
    contacted_at TEXT,
    synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("leads", "category", "TEXT");
ensureColumn("leads", "area", "TEXT");

const upsertLeadStmt = db.prepare(`
  INSERT INTO leads (name, source_url, page_title, phone, email, instagram, category, area, status)
  VALUES (@name, @sourceUrl, @pageTitle, @phone, @email, @instagram, @category, @area, @status)
  ON CONFLICT(source_url) DO UPDATE SET
    name = excluded.name,
    page_title = excluded.page_title,
    phone = excluded.phone,
    email = excluded.email,
    instagram = excluded.instagram,
    category = COALESCE(excluded.category, leads.category),
    area = COALESCE(excluded.area, leads.area),
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

const upsertOutreachStatusStmt = db.prepare(`
  INSERT INTO lead_outreach_status (
    lead_id, status, approved_at, contacted_at, synced_at
  )
  VALUES (@leadId, @status, @approvedAt, @contactedAt, CURRENT_TIMESTAMP)
  ON CONFLICT(lead_id) DO UPDATE SET
    status = excluded.status,
    approved_at = COALESCE(excluded.approved_at, lead_outreach_status.approved_at),
    contacted_at = COALESCE(excluded.contacted_at, lead_outreach_status.contacted_at),
    synced_at = CURRENT_TIMESTAMP
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
    category,
    area,
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

export function upsertLeadOutreachStatus({
  leadId,
  status,
  approvedAt = null,
  contactedAt = null
}) {
  upsertOutreachStatusStmt.run({
    leadId,
    status,
    approvedAt,
    contactedAt
  });
}

export function listReviewLeads({ unsentOnly = false } = {}) {
  const unsentClause = unsentOnly
    ? "AND NOT EXISTS (SELECT 1 FROM discord_notifications d WHERE d.lead_id = l.id)"
    : "";

  return db.prepare(`
    SELECT
      l.id,
      l.name,
      l.phone,
      l.email,
      l.instagram,
      l.category,
      l.area,
      l.source_url AS sourceUrl,
      l.status,
      v.verdict,
      v.official_url AS officialUrl,
      v.checked_at AS checkedAt,
      COALESCE(o.status, 'REVIEW_PENDING') AS outreachStatus
    FROM leads l
    JOIN lead_verifications v ON v.lead_id = l.id
    LEFT JOIN lead_outreach_status o ON o.lead_id = l.id
    WHERE v.verdict IN ('NO_OFFICIAL_SITE_FOUND', 'SOCIAL_ONLY', 'DEAD_WEBSITE')
      AND (l.phone IS NOT NULL OR l.email IS NOT NULL OR l.instagram IS NOT NULL)
      ${unsentClause}
    ORDER BY
      CASE WHEN l.phone IS NOT NULL THEN 1 ELSE 0 END DESC,
      CASE WHEN l.email IS NOT NULL THEN 1 ELSE 0 END DESC,
      CASE WHEN l.instagram IS NOT NULL THEN 1 ELSE 0 END DESC,
      l.updated_at DESC
  `).all();
}

export function listReviewNotificationStatus() {
  return db.prepare(`
    SELECT
      l.id,
      l.name,
      v.verdict,
      v.official_url AS officialUrl,
      v.checked_at AS checkedAt,
      d.sent_at AS sentAt,
      CASE WHEN d.lead_id IS NULL THEN 0 ELSE 1 END AS sent,
      COALESCE(o.status, 'REVIEW_PENDING') AS outreachStatus,
      o.approved_at AS approvedAt,
      o.contacted_at AS contactedAt,
      o.synced_at AS outreachSyncedAt
    FROM leads l
    JOIN lead_verifications v ON v.lead_id = l.id
    LEFT JOIN discord_notifications d ON d.lead_id = l.id
    LEFT JOIN lead_outreach_status o ON o.lead_id = l.id
    WHERE v.verdict IN ('NO_OFFICIAL_SITE_FOUND', 'SOCIAL_ONLY', 'DEAD_WEBSITE')
      AND (l.phone IS NOT NULL OR l.email IS NOT NULL OR l.instagram IS NOT NULL)
    ORDER BY l.updated_at DESC, l.id DESC
  `).all();
}

export function clearDiscordNotification(leadId) {
  return db.prepare("DELETE FROM discord_notifications WHERE lead_id = ?").run(leadId);
}

export function markDiscordNotified(leadIds) {
  const stmt = db.prepare(`
    INSERT INTO discord_notifications (lead_id)
    VALUES (?)
    ON CONFLICT(lead_id) DO NOTHING
  `);

  const tx = db.transaction((ids) => {
    for (const id of ids) stmt.run(id);
  });

  tx(leadIds);
}

export function closeDb() {
  db.close();
}
