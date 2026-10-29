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

## Cloudflare setup (lab only)

1. `npx wrangler d1 create kai-independent-lab` and set its returned ID in `wrangler.jsonc`.
2. `npx wrangler d1 migrations apply kai-independent-lab --remote`.
3. Set a randomly generated bearer secret with `npx wrangler secret put OWNER_TOKEN` (>= 32 characters). Never commit or store it in a frontend.
4. `npx wrangler deploy` from this subdirectory. Check account-specific Workers AI billing/limits before invoking inference.
5. Verify `/health` and unauthorized denial, then authenticate and test chat, memory, and draft flow. Keep this lab URL private until access controls and monitoring have been reviewed.

Example:

```bash
curl -s https://<lab-worker-host>/health
curl -s -X POST https://<lab-worker-host>/chat -H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Type: application/json" -d '{"division":"distorsi-rakyat","message":"Apa yang belum terverifikasi dalam sebuah laporan demo?"}'
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
