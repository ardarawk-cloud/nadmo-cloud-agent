import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, urlparse

HOST = '0.0.0.0'
PORT = int(os.environ.get('PORT', '8788'))
DB_PATH = os.environ.get('DB_PATH', '/data/scout-approval.sqlite3')
PUBLIC_DIR = Path(__file__).parent / 'public'
STAGES = {'CONTACTED', 'REPLIED', 'INTERESTED', 'PROPOSAL', 'WON', 'LOST'}

def now_iso():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('''
        CREATE TABLE IF NOT EXISTS outreach_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            phone TEXT,
            created_at TEXT NOT NULL
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_outreach_lead_created ON outreach_events (lead_id, created_at DESC)')
    conn.commit()
    return conn

def parse_lead_id(raw):
    try:
        value = int(raw or '')
        return value if value > 0 else None
    except Exception:
        return None

def normalize_whatsapp(raw):
    if not raw:
        return None
    digits = re.sub(r'\D', '', raw)
    if digits.startswith('0'):
        digits = '62' + digits[1:]
    if not digits.startswith('628') or len(digits) < 10 or len(digits) > 15:
        return None
    return digits

def record_event(lead_id, name, status, phone=''):
    conn = db()
    conn.execute(
        'INSERT INTO outreach_events (lead_id, name, status, phone, created_at) VALUES (?, ?, ?, ?, ?)',
        (lead_id, name, status, phone or None, now_iso()),
    )
    conn.commit()
    conn.close()
    return True

def valid_event(event):
    if event['status'] in ('APPROVED', 'FOLLOW_UP_SENT'):
        return normalize_whatsapp(event['phone']) is not None
    return True

def read_status(lead_id):
    conn = db()
    rows = conn.execute(
        'SELECT lead_id AS leadId, name, status, phone, created_at AS createdAt FROM outreach_events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50',
        (lead_id,),
    ).fetchall()
    conn.close()
    events = [dict(row) for row in rows]
    events = [event for event in events if valid_event(event)]
    latest_stage = next((event for event in events if event['status'] != 'FOLLOW_UP_SENT'), None)
    latest_follow = next((event for event in events if event['status'] == 'FOLLOW_UP_SENT'), None)
    return {
        'leadId': lead_id,
        'latestStatus': latest_stage['status'] if latest_stage else 'REVIEW_PENDING',
        'latestAt': latest_stage['createdAt'] if latest_stage else None,
        'lastFollowUpAt': latest_follow['createdAt'] if latest_follow else None,
        'events': events,
    }

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print('%s - %s' % (self.address_string(), fmt % args), flush=True)

    def send_json(self, payload, status=200):
        body = json.dumps(payload, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, message, status=400):
        self.send_json({'error': message}, status)

    def send_html_message(self, title, message):
        import html
        body = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>
body{{font-family:system-ui,sans-serif;background:#07111f;color:#f6f8fb;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}}
main{{max-width:560px;background:#0d1b2e;border:1px solid #1f6feb;border-radius:20px;padding:28px;box-shadow:0 24px 70px rgba(0,0,0,.35)}}
h1{{margin:0 0 12px;font-size:26px}}p{{line-height:1.6;color:#c9d4e5}}.ok{{color:#5ee38d;font-weight:700}}
</style>
</head>
<body><main><div class="ok">NADMO SCOUT</div><h1>{html.escape(title)}</h1><p>{html.escape(message)}</p></main></body>
</html>'''.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, target):
        self.send_response(302)
        self.send_header('Location', target)
        self.end_headers()

    def query_one(self, query, key, default=''):
        values = query.get(key)
        return values[0] if values else default

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path.startswith('/api/'):
            return self.handle_api(path, query)

        if path == '/' or path == '/index.html':
            return self.send_file('index.html', 'text/html; charset=utf-8')
        if path == '/styles.css':
            return self.send_file('styles.css', 'text/css; charset=utf-8')
        if path == '/app.js':
            return self.send_file('app.js', 'application/javascript; charset=utf-8')

        self.send_error_json('Not found', 404)

    def send_file(self, name, content_type):
        target = PUBLIC_DIR / name
        if not target.exists():
            return self.send_error_json('Not found', 404)
        body = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_api(self, path, query):
        if path == '/api/_healthcheck':
            return self.send_json({'message': 'Success'})

        if path == '/api/approve':
            lead_id = parse_lead_id(self.query_one(query, 'leadId'))
            phone = normalize_whatsapp(self.query_one(query, 'phone'))
            if not lead_id:
                return self.send_error_json('Invalid leadId', 400)
            if not phone:
                return self.send_error_json('Invalid WhatsApp phone', 400)
            name = self.query_one(query, 'name', 'Lead')[:160]
            text = self.query_one(query, 'text')[:1500]
            record_event(lead_id, name, 'APPROVED', phone)
            if self.query_one(query, 'dry') == '1':
                return self.send_json({'leadId': lead_id, 'name': name, 'status': 'APPROVED', 'recorded': True})
            target = f'https://wa.me/{phone}' + (f'?text={quote(text)}' if text else '')
            return self.redirect(target)

        if path == '/api/contacted':
            lead_id = parse_lead_id(self.query_one(query, 'leadId'))
            if not lead_id:
                return self.send_error_json('Invalid leadId', 400)
            name = self.query_one(query, 'name', 'Lead')[:160]
            phone = self.query_one(query, 'phone')[:40]
            record_event(lead_id, name, 'CONTACTED', phone)
            if self.query_one(query, 'dry') == '1':
                return self.send_json({'leadId': lead_id, 'name': name, 'status': 'CONTACTED', 'recorded': True})
            return self.send_html_message('Lead marked CONTACTED', f'{name} sudah tercatat sebagai CONTACTED di NADMO Scout.')

        if path == '/api/stage':
            lead_id = parse_lead_id(self.query_one(query, 'leadId'))
            if not lead_id:
                return self.send_error_json('Invalid leadId', 400)
            status = self.query_one(query, 'status').upper()
            if status not in STAGES:
                return self.send_error_json('Invalid pipeline status', 400)
            name = self.query_one(query, 'name', 'Lead')[:160]
            phone = self.query_one(query, 'phone')[:40]
            record_event(lead_id, name, status, phone)
            if self.query_one(query, 'dry') == '1':
                return self.send_json({'leadId': lead_id, 'name': name, 'status': status, 'recorded': True})
            return self.send_html_message(f'Lead marked {status}', f'{name} sekarang berada di stage {status}.')

        if path == '/api/followup':
            lead_id = parse_lead_id(self.query_one(query, 'leadId'))
            phone = normalize_whatsapp(self.query_one(query, 'phone'))
            if not lead_id:
                return self.send_error_json('Invalid leadId', 400)
            if not phone:
                return self.send_error_json('Invalid WhatsApp phone', 400)
            name = self.query_one(query, 'name', 'Lead')[:160]
            text = self.query_one(query, 'text')[:1500]
            record_event(lead_id, name, 'FOLLOW_UP_SENT', phone)
            if self.query_one(query, 'dry') == '1':
                return self.send_json({'leadId': lead_id, 'name': name, 'status': 'FOLLOW_UP_SENT', 'recorded': True})
            target = f'https://wa.me/{phone}' + (f'?text={quote(text)}' if text else '')
            return self.redirect(target)

        if path == '/api/status':
            lead_id = parse_lead_id(self.query_one(query, 'leadId'))
            if not lead_id:
                return self.send_error_json('Invalid leadId', 400)
            return self.send_json(read_status(lead_id))

        match = re.fullmatch(r'/api/status/(\d+)', path)
        if match:
            lead_id = parse_lead_id(match.group(1))
            if not lead_id:
                return self.send_error_json('Invalid leadId', 400)
            return self.send_json(read_status(lead_id))

        return self.send_error_json('Not found', 404)

if __name__ == '__main__':
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db().close()
    print(f'NADMO Scout Approval Gateway listening on {HOST}:{PORT}', flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
