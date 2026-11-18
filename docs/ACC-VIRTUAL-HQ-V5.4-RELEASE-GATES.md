# ACC Virtual HQ V5.4 — Live Readiness Gate

Status: IMPLEMENTATION / NOT PRODUCTION READY.

## Verified baseline
- V5.3 3D frontend exists at apps/acc-virtual-hq/index.html.
- KAI Core FastAPI endpoints exist in services/kai-core/app.py.
- Backend STATE.mode is SIMULATION, in-memory only.
- Frontend local task buttons simulate progress and completion.
- GitHub commit status is read-only live data; it does not establish agent activity.

## Mandatory release gates
1. Deploy KAI Core behind authenticated HTTPS; remove wildcard CORS for owner-only API.
2. Persist tasks, goals, approvals, audit events in durable storage.
3. Bind frontend to authenticated GET /state and WebSocket /ws with reconnect and clear disconnected state.
4. Replace simulated progress controls with real task lifecycle events; never increment progress without executor evidence.
5. Map each agent ID to an explicitly authorized executor; no implied autonomous tool access.
6. Enforce owner authentication and role-based authorization on mutations; protect approval endpoints.
7. Add idempotency, error reporting, and retry for all mutations.
8. Make status provenance visible: SIMULATION / CONNECTED / DISCONNECTED.
9. Verify mobile Android rendering, reload persistence, two-session synchronization, and offline behavior.
10. Deploy to hq.nadmo.id only after staging acceptance and rollback preparation.

## Acceptance tests
- A newly created goal persists after API restart.
- Task status changes only after an authenticated server event.
- A second browser sees the same task/approval state.
- Unauthenticated POST and WebSocket are denied.
- Approval and rejection create immutable audit records.
- A disconnected backend never appears as a working agent.
- No deployment changes existing NADMO LIVE or ACC OS X workflows.

## Next execution
Build authenticated durable KAI Core first, then connect V5.3 frontend to it. No fake operational claims.
