# KAI INDEPENDENT — Owner Browser Lab v0.2

**Deploy: `https://kai-independent-lab.ardarawk.workers.dev/`**

This is an **isolated** AI lab under the existing `nadmo-cloud-agent` repository. ACC OS X, `services/kai-core`, and `hq.nadmo.id` remain unchanged. Its GitHub PR is intentionally a draft.

## KAI Master Knowledge v0.3 (branch, pending deployment)

The old v0.2 browser displayed an invented explanation of ACC/NADMO. Root cause: small chat model had no authoritative company knowledge, and its existing conversations preserve the wrong answer.

- `master-knowledge.mjs` is versioned owner-confirmed canon (ACC = Arda Core Corporation; PT Nadmo Studio Indonesia; Arda = Owner; KAI Prime vs KAI ONE CTO; AM STUDIO vs NADMO Studio; independent evidence-first editorial principles).
- The branch now uses `@cf/qwen/qwen3-30b-a3b-fp8` and parses ChatCompletion responses.
- `GET /master?division=...` and a read-only Master Canon tab reveal the knowledge source separately from user-editable memory.
- A direct Cloudflare Workers AI API test of Qwen3 with the canon returned the correct ACC/NADMO identity.
- Local mocked regression tests cover canonical facts, Qwen response shape, previous erroneous-history priority and owner-only master visibility.

**Deployment state:** the v0.3 multi-module Worker upload was blocked by the deployment tool; therefore the deployed Worker has NOT been confirmed upgraded. No claim of live Qwen3 or live Master tab is made.

**Immediate verified mitigation (30 Oct 2026 WITA):** Four D1 memory entries (master identity, company/role correction, division context, and integrity rule) were written to each of the three division passports, all twelve entries verified. This improves the currently running v0.2 Llama chat, but cannot guarantee it never fabricates relationships or roles. Prefer a fresh thread rather than reusing the incorrect earlier reply.

## Private owner UI

Open the URL in a browser. Cloudflare Access requires the designated Cloudflare-account identity to sign in. Other identities are excluded by an exact-email Access policy attached to the **Worker** (not just a path). The Worker additionally validates the authenticated `ctx.access.getIdentity().email` against its server-side `OWNER_EMAIL` secret and refuses to serve the UI otherwise.

The responsive, self-contained browser UI supports:
- Chat with the Cloudflare-hosted open-weight Llama 3.2 3B Instruct model, with per-division/thread history.
- Per-division persistent memories in D1, editable and deletable.
- A user-supplied evidence ledger with source URL and excerpt. Such sources are **not independently verified**.
- Internal draft submission and approval, without claiming public posting.

There are no browser-side access tokens, localStorage secrets, externally loaded scripts, or cross-origin API permissions. The page uses CSP with a per-request script/style nonce and text-only rendering of model/user messages. Cross-origin POST requests are blocked.

## Deployment verification (30 Oct 2026 WITA)

- Cloudflare Worker `kai-independent-lab` API upload succeeded; 100% active version.
- Worker bindings: AI, DB (D1), OWNER_EMAIL secret, OWNER_TOKEN secret.
- Cloudflare Access self-hosted app created for this Worker and restricted to the owner's email, using Cloudflare login.
- D1 `kai-independent-lab` exists (APAC), four tables initialized.
- Direct Cloudflare Workers AI model inference returned HTTP 200 with text.
- GitHub Actions regression suite: 10 mocked service/UI checks passing, including owner Access identity and cross-site rejection.

**Release caveat:** requests to this `workers.dev` address from the assistant tooling are blocked at the egress layer. We could not yet verify the complete browser-login → chat → D1 persistence sequence from an external signed-in client. The page may need owner-side browser validation. Do **not** treat a successful Worker deployment or direct model inference as proof of the end-to-end UI.

## Owner usage

1. Open `https://kai-independent-lab.ardarawk.workers.dev/`, and complete Cloudflare Access sign-in using the authorized account.
2. Select ACC CORE, NADMO STUDIO, or DISTORSI RAKYAT.
3. Type a message and select **Kirim**. Ctrl+Enter sends. Use a new thread ID for separate subjects.
4. Use **Memori** for durable context; **Sumber** to attach manually entered references; **Draf** for internal approval.

## API / trust boundary

- `GET /health` — health information (behind Cloudflare Access at the edge).
- `GET /session` — verified Access identity for the browser UI.
- `GET /history?division=...&thread_id=...`
- `GET|PUT|DELETE /memory`
- `GET|POST /evidence`
- `POST /chat` — optional `thread_id`, optional `evidence_ids` (max 8).
- `GET|POST /drafts`; `POST /drafts/:id/approve`

All API endpoints require Cloudflare Access authenticated owner identity or a strong server-side owner bearer token, and Cloudflare Access additionally protects the Worker URL. No bearer token is exposed to the browser. The health route is intentionally unauthenticated at the app layer, but Access guards the Worker in production.

## Tests

```bash
cd services/kai-independent
npm test
npm run check
```

Node in-memory SQLite and mocked AI are used for regression tests. No test fakes a real publish ID.

## Known limitations

- **Not a self-hosted GPU model:** inference uses Cloudflare infrastructure. Self-hosted model fallback is future work.
- No live web/news search, crawler, fact-checker, or automatic independent corroboration.
- No publish action or social-account API integration.
- No rate quotas, usage budget alerts, audit log or scheduled D1 backups yet.
- Direct `OWNER_TOKEN` secret must be rotated if ever exposed, even though Cloudflare Access blocks unauthenticated ingress.
- Before declaring production-ready: confirm browser sign-in, real chat response, D1 message persistence across reloads, limits/billing, and monitoring.

