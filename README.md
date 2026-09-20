# NADMO Cloud Agent

Self-hosted cloud-agent project for NADMO Studio.

## Current phase: Scout MVP v0.2

The VPS worker can now:
- run Chromium headlessly through Playwright
- inspect public websites
- extract public phone/email/Instagram links exposed by a page
- store results in SQLite
- keep an activity log
- discover candidate URLs from a natural-language search query
- keep outreach, publishing, and purchasing disabled by default

## Inspect one known URL

```bash
npm run scout -- https://example.com
```

## Discovery test

```bash
npm run discover -- "makeup artist denpasar bali" 10
```

Discovery only finds public candidate URLs, inspects them, and stores results. It does not contact anyone.

## Safety defaults

```env
ALLOW_OUTREACH=false
ALLOW_PUBLISH=false
ALLOW_PURCHASE=false
```

## Roadmap
1. Phase 0 — browser + memory foundation ✅
2. Phase 1A — public candidate discovery ✅
3. Phase 1B — business qualification and duplicate filtering
4. Phase 2 — Google Sheets reporting
5. Phase 3 — Discord control + approval commands
6. Phase 4 — draft outreach
7. Phase 5 — scheduler and 24/7 runtime
8. Phase 6 — additional agents (Client Ops, Finance, Web Ops)

See `docs/SCOUT-SOP.md` for operating rules.
