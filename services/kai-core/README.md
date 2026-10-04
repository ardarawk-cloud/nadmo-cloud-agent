# ACC KAI Core

Production foundation for **ARDA CORE CORPORATION — KAI 3D Virtual HQ**.

This service is deliberately separate from the old NADMO Virtual HQ V1–V4 prototypes.

## Current Phase

Phase A — Foundation.

Implemented foundation endpoints:
- `GET /health`
- `GET /state`
- `GET /events`
- `POST /goals`
- `POST /tasks`
- `POST /tasks/{id}/start`
- `POST /tasks/{id}/complete`
- `POST /approvals/{id}`
- `WS /ws`

The state is currently in-memory. Persistent storage, auth, permissions, and real KAI orchestration are intentionally deferred to the next Phase A increments.

## Run locally

```bash
cd services/kai-core
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload --port 8788
```

Windows activation:

```powershell
.venv\Scripts\activate
```

## Architectural contract

The 3D frontend must subscribe to backend events. Movement and animation must reflect backend state rather than random decorative animation.

See:
`docs/ACC-KAI-3D-VIRTUAL-HQ-MASTER-SPEC-V5.md`
