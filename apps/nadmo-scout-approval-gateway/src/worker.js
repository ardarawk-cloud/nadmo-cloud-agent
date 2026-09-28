const STAGES = new Set([
  'CONTACTED',
  'REPLIED',
  'INTERESTED',
  'PROPOSAL',
  'WON',
  'LOST',
]);

function parseLeadId(raw) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeWhatsappPhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `62${digits.slice(1)}`;

  if (!digits.startsWith('628') || digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function htmlResponse(title, message) {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#07111f;color:#f6f8fb;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
main{max-width:560px;background:#0d1b2e;border:1px solid #1f6feb;border-radius:20px;padding:28px;box-shadow:0 24px 70px rgba(0,0,0,.35)}
h1{margin:0 0 12px;font-size:26px}p{line-height:1.6;color:#c9d4e5}.ok{color:#5ee38d;font-weight:700}
</style>
</head>
<body><main><div class="ok">NADMO SCOUT</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function ensureSchema(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS outreach_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      phone TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_outreach_lead_created
      ON outreach_events (lead_id, created_at DESC);
  `);
}

async function recordEvent(db, event) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      'INSERT INTO outreach_events (lead_id, name, status, phone, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .bind(
      event.leadId,
      event.name,
      event.status,
      event.phone ?? null,
      event.createdAt
    )
    .run();
  return Boolean(result.success);
}

function isValidStoredEvent(event) {
  if (event.status === 'APPROVED' || event.status === 'FOLLOW_UP_SENT') {
    return normalizeWhatsappPhone(event.phone) !== null;
  }
  return true;
}

async function readStatus(db, leadId) {
  await ensureSchema(db);
  const result = await db
    .prepare(
      'SELECT lead_id AS leadId, name, status, phone, created_at AS createdAt FROM outreach_events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50'
    )
    .bind(leadId)
    .all();

  const events = (result.results || []).filter(isValidStoredEvent);
  const latestStage = events.find((event) => event.status !== 'FOLLOW_UP_SENT');
  const latestFollowUp = events.find((event) => event.status === 'FOLLOW_UP_SENT');

  return {
    leadId,
    latestStatus: latestStage?.status ?? 'REVIEW_PENDING',
    latestAt: latestStage?.createdAt ?? null,
    lastFollowUpAt: latestFollowUp?.createdAt ?? null,
    events,
  };
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const query = url.searchParams;
  const path = url.pathname;

  if (request.method !== 'GET') {
    return error('Method not allowed', 405);
  }

  if (path === '/api/_healthcheck') {
    return json({ message: 'Success' });
  }

  if (path === '/api/approve') {
    const leadId = parseLeadId(query.get('leadId'));
    const phone = normalizeWhatsappPhone(query.get('phone'));

    if (!leadId) return error('Invalid leadId', 400);
    if (!phone) return error('Invalid WhatsApp phone', 400);

    const name = (query.get('name') || 'Lead').slice(0, 160);
    const text = (query.get('text') || '').slice(0, 1500);
    const saved = await recordEvent(env.DB, {
      leadId,
      name,
      status: 'APPROVED',
      phone,
      createdAt: new Date().toISOString(),
    });

    if (!saved) return error('Could not record approval', 500);

    if (query.get('dry') === '1') {
      return json({ leadId, name, status: 'APPROVED', recorded: true });
    }

    const target = `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    return Response.redirect(target, 302);
  }

  if (path === '/api/contacted') {
    const leadId = parseLeadId(query.get('leadId'));
    if (!leadId) return error('Invalid leadId', 400);

    const name = (query.get('name') || 'Lead').slice(0, 160);
    const phone = (query.get('phone') || '').slice(0, 40);
    const saved = await recordEvent(env.DB, {
      leadId,
      name,
      status: 'CONTACTED',
      phone,
      createdAt: new Date().toISOString(),
    });

    if (!saved) return error('Could not record contacted status', 500);

    if (query.get('dry') === '1') {
      return json({ leadId, name, status: 'CONTACTED', recorded: true });
    }

    return htmlResponse(
      'Lead marked CONTACTED',
      `${name} sudah tercatat sebagai CONTACTED di NADMO Scout.`
    );
  }

  if (path === '/api/stage') {
    const leadId = parseLeadId(query.get('leadId'));
    if (!leadId) return error('Invalid leadId', 400);

    const status = (query.get('status') || '').toUpperCase();
    if (!STAGES.has(status)) return error('Invalid pipeline status', 400);

    const name = (query.get('name') || 'Lead').slice(0, 160);
    const phone = (query.get('phone') || '').slice(0, 40);
    const saved = await recordEvent(env.DB, {
      leadId,
      name,
      status,
      phone,
      createdAt: new Date().toISOString(),
    });

    if (!saved) return error('Could not record pipeline status', 500);

    if (query.get('dry') === '1') {
      return json({ leadId, name, status, recorded: true });
    }

    return htmlResponse(
      `Lead marked ${status}`,
      `${name} sekarang berada di stage ${status}.`
    );
  }

  if (path === '/api/followup') {
    const leadId = parseLeadId(query.get('leadId'));
    const phone = normalizeWhatsappPhone(query.get('phone'));

    if (!leadId) return error('Invalid leadId', 400);
    if (!phone) return error('Invalid WhatsApp phone', 400);

    const name = (query.get('name') || 'Lead').slice(0, 160);
    const text = (query.get('text') || '').slice(0, 1500);
    const saved = await recordEvent(env.DB, {
      leadId,
      name,
      status: 'FOLLOW_UP_SENT',
      phone,
      createdAt: new Date().toISOString(),
    });

    if (!saved) return error('Could not record follow-up', 500);

    if (query.get('dry') === '1') {
      return json({ leadId, name, status: 'FOLLOW_UP_SENT', recorded: true });
    }

    const target = `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
    return Response.redirect(target, 302);
  }

  if (path === '/api/status') {
    const leadId = parseLeadId(query.get('leadId'));
    if (!leadId) return error('Invalid leadId', 400);
    return json(await readStatus(env.DB, leadId));
  }

  const statusMatch = path.match(/^\/api\/status\/(\d+)$/);
  if (statusMatch) {
    const leadId = parseLeadId(statusMatch[1]);
    if (!leadId) return error('Invalid leadId', 400);
    return json(await readStatus(env.DB, leadId));
  }

  return error('Not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
