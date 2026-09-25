# Papa Sauce Lab Sync

Uses the existing Nadmo VPS and existing `agent.nadmo.id` domain.

Public API path after Nginx is configured:

- `https://agent.nadmo.id/psl-sync/health`
- `https://agent.nadmo.id/psl-sync/sync/push`
- `https://agent.nadmo.id/psl-sync/sync/pull`
- `https://agent.nadmo.id/psl-sync/sync/stats`

The API stores Papa Sauce Lab transactions, stock movements, snapshots, corrections, and periods in SQLite on a persistent Docker volume.

## Server install

From the VPS:

```bash
git clone https://github.com/ardarawk-cloud/nadmo-cloud-agent.git
cd nadmo-cloud-agent/services/psl-sync
cp .env.example .env
nano .env
docker compose up -d --build
```

Add `nginx-psl-sync.conf`'s location block inside the existing HTTPS server block for `agent.nadmo.id`, then:

```bash
sudo nginx -t && sudo systemctl reload nginx
curl https://agent.nadmo.id/psl-sync/health
```

Never commit the real sync code.
