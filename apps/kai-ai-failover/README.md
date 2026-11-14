# KAI AI Failover v0.2: Free-first

Replaces the old provider billing requirement with two models hosted on Cloudflare Workers AI:
1. Primary: @cf/zai-org/glm-4.7-flash
2. Fallback: @cf/google/gemma-4-26b-a4b-it

Google Gemma 4 is NOT the Gemini API. Neither model uses an OpenAI, Claude, or Gemini API key. The account's other AI Gateway, kai-failover-staging, is NOT used by this native inference route.

Cloudflare Workers Free accounts receive 10,000 free Neurons per day across all Workers AI usage. Further calls fail when the quota is reached. If the account is on Workers Paid, overage may be billed. The connector could not read account subscriptions (403), so do not claim a verified no-cost plan until it is checked in the dashboard.

Staging Worker: kai-ai-failover-staging, with workers.dev and preview URLs disabled. Neither NADMO LIVE nor ACC OS X production is modified.

Internal endpoints:
- GET /health: deployment readiness only, no secrets.
- POST /v1/chat/completions: requires AI binding and private KAI_ROUTER_TOKEN secret; otherwise 503 fail-closed. Only text, maximum 6 messages, 1,500 characters per message, 4,000 total characters, 256 output tokens.
- Uses two native env.AI.run calls sequentially on failures. An exhausted quota stops retries.
- No CORS, no public route, no memory, no tool execution, no files, no admin access, no ChatGPT plugin reuse.
- Future use by KAI ONE needs an authenticated internal service binding plus central memory and tool adapters.
- Both models share Cloudflare infrastructure, so this does not cover Cloudflare-wide outages.

Unit tests are fully mocked and consume zero Workers AI neurons.
Run: node --test apps/kai-ai-failover/tests/failover.test.mjs
