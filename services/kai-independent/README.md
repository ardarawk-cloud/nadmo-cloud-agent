# KAI Independent v0.1 (isolated lab)

Independent Cloudflare Worker in the existing `nadmo-cloud-agent` repository. It does **not** change the `services/kai-core` FastAPI prototype, `hq.nadmo.id`, ACC OS X, or content publishing.

## Implemented

- Model-backed `/chat` using Cloudflare Workers AI (Meta Llama 3.2 3B Instruct); no fallback fabricated answer.
- Owner-only access by a strong `OWNER_TOKEN` secret. No browser CORS permissions.
- Division-isolated D1 memories and thread histories (`acc-core`, `nadmo-studio`, `distorsi-rakyat`).
- User-supplied evidence ledger with explicit **unverified** status; linked evidence is returned in machine-readable results. **No live web search or automatic source verification yet.**
- Draft approval gate. `APPROVED` is *not* `PUBLISHED`; no external posting occurs in this lab.
- Request size and input limits, and non-sensitive error responses.

## Local validation

```bash
cd services/kai-independent
npm test
npm run check
```

The tests use Node's experimental built-in SQLite to emulate D1 and a fake model. They are **not** proof of production Cloudflare inference.

## Lab deployment (29 October 2026)

Cloudflare API confirmed the following isolated resources in the owner's account:

- Worker: `kai-independent-lab`, bound to Workers AI, D1 and a private `OWNER_TOKEN` secret.
- D1 database: `kai-independent-lab` (APAC), four tables created, no real user records seeded.
- Worker deployment: active (100% of the deployed version); workers.dev subdomain enabled and preview URLs disabled.
- Lab address: `https://kai-independent-lab.ardarawk.workers.dev`.

**Important:** the deployment API and bindings were verified, but an HTTP end-to-end smoke test was **not verified**: the testing environment blocked requests to workers.dev with HTTP 403 before they reached the Worker. Do not label the AI chat or remote persistence "working" until an authenticated request succeeds from an approved client.

To operate or rotate credentials, use the Cloudflare dashboard. Never print the private bearer token into a public page or source control. Before opening this to general browser use, add Cloudflare Access plus scoped sessions, request budgets, and monitoring.

Example once the owner has a securely provisioned token:

```bash
curl -s https://kai-independent-lab.ardarawk.workers.dev/health
curl -s -X POST https://kai-independent-lab.ardarawk.workers.dev/chat -H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Type: application/json" -d '{"division":"distorsi-rakyat","message":"Apa yang belum terverifikasi dalam sebuah laporan demo?"}'
```

## API

- `GET /health` public metadata only.
- `GET /memory?division=...`, `PUT /memory`, `DELETE /memory?division=...&key=...`.
- `POST /evidence`, `GET /evidence?division=...` (submission is not automated verification).
- `POST /chat` with `division`, `message`, optional `thread_id`, optional `evidence_ids` (up to 8).
- `POST /drafts`, `GET /drafts?division=...`, `POST /drafts/:id/approve`.

All endpoints other than health require `Authorization: Bearer <OWNER_TOKEN>` and initialized D1. There is no publication or search endpoint.

## Known gaps / release blockers

- No automatic news discovery, crawler, or independent corroboration. Supplied URLs and excerpts cannot be treated as verified facts.
- No UI or secure personal login; secret-only API is a lab interface. For general browser access, implement Cloudflare Access and scoped sessions.
- No cost controls/rate limits beyond a private bearer token; deploy behind suitable Cloudflare controls before heavy usage.
- Cannot claim persistence or real model inference until remote D1 and AI bindings are deployed and verified.
- Before integrating with KAI Core, add role-based approval records, backups, audit logs, and retrieval against trusted sources.
