# NADMO Cloud Agent

A self-hosted cloud-agent project for NADMO Studio.

## Current phase: Scout MVP foundation

Version 0.1 is intentionally limited. It gives us the safe building blocks for a future cloud employee:

- Chromium browser worker via Playwright
- Persistent SQLite memory
- Activity log
- Environment-based safety gates
- CLI for inspecting public business URLs
- No automatic outreach, publishing, purchasing, or production changes

## Architecture

```text
Arda / phone
    |
    v
NADMO Agent Controller
    |
    +-- Browser worker (Playwright + Chromium)
    +-- Scout logic
    +-- SQLite memory
    +-- Activity log
    +-- Safety gates / approval layer
```

## Local/VPS setup

Requirements:
- Ubuntu or another Linux host
- Node.js 20+
- 2 vCPU / 4 GB RAM recommended for the first MVP

Install:

```bash
npm install
npx playwright install --with-deps chromium
cp .env.example .env
```

Test:

```bash
npm run scout -- https://example.com
```

The result is stored in `nadmo-agent.db`.

## Safety defaults

```env
ALLOW_OUTREACH=false
ALLOW_PUBLISH=false
ALLOW_PURCHASE=false
```

Keep these disabled until an explicit human-approval workflow exists.

## Roadmap

1. Phase 0 — browser + memory foundation
2. Phase 1 — business discovery and qualification
3. Phase 2 — Google Sheets reporting
4. Phase 3 — Discord control + approval buttons/commands
5. Phase 4 — draft outreach
6. Phase 5 — scheduler and 24/7 VPS runtime
7. Phase 6 — additional NADMO agents (Client Ops, Finance, Web Ops)

See `docs/SCOUT-SOP.md` for the operating rules.
