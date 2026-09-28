# NADMO Scout Approval Gateway — Cloudflare migration

This directory is a behavior-preserving migration of the existing AppDeploy gateway.

Runtime:
- Cloudflare Worker for the API
- Cloudflare Static Assets for the existing frontend
- Cloudflare D1 for outreach event persistence
- GitHub remains the source of truth

The visible UI, route names, status values, WhatsApp validation, redirects, pipeline stages, follow-up event behavior, and JSON response shapes are intentionally preserved.

Deploy from this directory with:

```bash
npm install
npm run deploy
```

Cloudflare Wrangler will provision the D1 binding declared in `wrangler.jsonc` when the Cloudflare account is connected.
