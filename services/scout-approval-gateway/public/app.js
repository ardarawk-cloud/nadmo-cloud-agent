const app = document.querySelector('#app');

function render(title, message, payload) {
  if (!app) return;
  const json = payload === undefined ? '' : JSON.stringify(payload);
  app.innerHTML = `
    <main class="shell">
      <p class="eyebrow">NADMO STUDIO</p>
      <h1>${title}</h1>
      <p>${message}</p>
      ${json ? `<pre id="bridge-output">${json}</pre>` : ''}
      <div class="status">● SERVICE ONLINE</div>
    </main>
  `;
}

const basePath = window.location.pathname.startsWith('/scout-approval/')
  ? '/scout-approval'
  : '';

async function apiGet(path) {
  const response = await fetch(`${basePath}${path}`, {
    headers: { Accept: 'application/json' }
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Gateway returned non-JSON response: ${text.slice(0, 120)}`);
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }
  return data;
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

async function runBridge() {
  const params = new URLSearchParams(window.location.search);
  const bridge = params.get('bridge');

  if (!bridge) {
    render(
      'NADMO Scout Approval Gateway',
      'Approval tracking service is online. Discord outreach links use this bridge to update the NADMO Scout sales pipeline.',
    );
    return;
  }

  try {
    if (bridge === 'status') {
      const leadId = params.get('leadId') || '';
      const result = await apiGet(`/api/status?leadId=${encodeURIComponent(leadId)}`);
      render('Pipeline Status', 'Status loaded.', result);
      document.body.dataset.bridgeReady = '1';
      return;
    }

    if (bridge === 'approve') {
      const leadId = params.get('leadId') || '';
      const name = params.get('name') || 'Lead';
      const phone = normalizeWhatsappPhone(params.get('phone'));
      const text = params.get('text') || '';
      if (!phone) throw new Error('Invalid WhatsApp phone');
      const q = new URLSearchParams({ leadId, name, phone, text, dry: '1' });
      const result = await apiGet(`/api/approve?${q}`);
      render('Lead APPROVED', 'Approval recorded. Opening WhatsApp…', result);
      document.body.dataset.bridgeReady = '1';
      if (params.get('bridgeDry') !== '1') {
        window.location.href = `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
      }
      return;
    }

    if (bridge === 'followup') {
      const leadId = params.get('leadId') || '';
      const name = params.get('name') || 'Lead';
      const phone = normalizeWhatsappPhone(params.get('phone'));
      const text = params.get('text') || '';
      if (!phone) throw new Error('Invalid WhatsApp phone');
      const q = new URLSearchParams({ leadId, name, phone, text, dry: '1' });
      const result = await apiGet(`/api/followup?${q}`);
      render('Follow-up Recorded', 'Follow-up recorded. Opening WhatsApp…', result);
      document.body.dataset.bridgeReady = '1';
      if (params.get('bridgeDry') !== '1') {
        window.location.href = `https://wa.me/${phone}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
      }
      return;
    }

    if (bridge === 'stage' || bridge === 'contacted') {
      const leadId = params.get('leadId') || '';
      const name = params.get('name') || 'Lead';
      const phone = params.get('phone') || '';
      const q = new URLSearchParams({ leadId, name, phone, dry: '1' });

      let title = 'Pipeline Updated';
      let result;
      if (bridge === 'contacted') {
        result = await apiGet(`/api/contacted?${q}`);
        title = 'Lead CONTACTED';
      } else {
        const status = params.get('status') || '';
        q.set('status', status);
        result = await apiGet(`/api/stage?${q}`);
        title = `Lead ${status}`;
      }

      render(title, 'Pipeline status recorded.', result);
      document.body.dataset.bridgeReady = '1';
      return;
    }

    throw new Error('Unknown bridge action');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    render('Bridge Error', message, { ok: false, error: message });
    document.body.dataset.bridgeReady = 'error';
  }
}

runBridge();
