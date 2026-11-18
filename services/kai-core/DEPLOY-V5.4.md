# KAI Core V5.4 deployment notes

This branch is a secured control-plane foundation, NOT a working autonomous agent runtime.

Required environment:
- KAI_CORE_OWNER_TOKEN: high-entropy private token; never put in frontend JavaScript or Git.
- KAI_CORE_DB_PATH: durable mounted disk path (default /data/kai-core.sqlite3).
- KAI_CORE_ALLOWED_ORIGINS: comma-separated trusted origins, e.g. https://hq.nadmo.id.

Run: uvicorn app:app --host 127.0.0.1 --port 8000

Security:
- /health is public; state, events and mutations require Authorization: Bearer token.
- /ws requires an Authorization header, so a direct browser WebSocket cannot authenticate yet. Use a same-origin authenticated gateway/session before enabling browser realtime.
- Task completion deliberately returns 409 until verified executor evidence exists.
- SQLite snapshot persistence survives restarts only when DB_PATH uses a persistent mounted volume.
- Single-process only: in-memory sockets and SQLite snapshots do not support multi-worker concurrency without redesign.
- No production rollout before auth gateway, frontend integration, tests and backup/rollback.
