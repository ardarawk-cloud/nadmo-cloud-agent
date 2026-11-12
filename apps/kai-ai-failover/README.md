# KAI AI Failover v0.1 (STAGING)

Independent, narrow AI inference router for ACC Enterprise. Does NOT replace ChatGPT UI, ChatGPT memory, plugins, or scheduled automations.

## Deployment

Cloudflare Worker: kai-ai-failover-staging (no public workers.dev domain or zone route).
AI Gateway: kai-failover-staging (authenticated, BYOK only, logs off, caching off).
Provider order: OpenAI gpt-5.5 -> Anthropic Claude Sonnet 5.5 -> Google Gemini 3.8 Flash.

This Worker **fails closed** until both these Cloudflare Worker *secret_text* bindings are set:
- KAI_ROUTER_TOKEN: unique, long private service-to-service bearer token.
- CF_AIG_TOKEN: Cloudflare API token scoped to AI Gateway inference.

Provider keys must be added to the AI Gateway BYOK configuration for OpenAI, Anthropic, and Google. Without keys, no real model can run. Cloudflare account currently has zero AI Gateway balance and no payment method (as checked at setup).

## Endpoints

- GET /health — non-sensitive staging readiness state.
- POST /v1/chat/completions — requires router Bearer token; non-streaming, text-only, 1-8 short messages, 1-1024 max output tokens. Blocks requests until both secrets exist.
- Response shape: OpenAI-compatible chat completion with extra \`kai\` metadata showing selected provider and whether failover was used.

No tools, no GitHub edits, no Cloudflare mutations, no filesystem access, no user-upload handling, no persistent memory, and no production routes are attached.

## Safeguards

- Gateway authenticated, BYOK only, 10 requests / minute, US$1 spend cap per 24 hours.
- No request/response logging and no AI response cache.
- Two-stage authorization: secret Worker bearer + Cloudflare API token.
- No CORS cross-origin authorization, no conversation storage.
- Model fallback only when a provider errors before returning a usable answer; it does **not** retry failed tool actions.
- Cloudflare outage remains a single point of failure. The eventual off-Cloudflare standby must run separately.

## Tests

Run \`node --test apps/kai-ai-failover/tests/failover.test.mjs\` from repository root. Tests mock all provider requests and incur no AI costs.

## Next gated steps

1. Store provider API keys in AI Gateway BYOK (or explicitly approve Unified Billing). Do not send keys in chat.
2. Add scoped CF_AIG_TOKEN and random KAI_ROUTER_TOKEN via Cloudflare secret bindings.
3. Verify test prompt on staging and observe real gateway logs/cost totals (leave payload logs off).
4. Attach a protected internal service binding to ACC Enterprise. Never directly expose the router as a public unauthenticated API.
5. Mirror master project memory in D1/R2 and implement provider-neutral tool adapters with action-specific approvals.
