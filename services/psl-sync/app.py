import hashlib
import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

APP_VERSION = "1.0.0"
DB_PATH = Path(os.environ.get("PSL_DB_PATH", "/data/papa-sauce-lab.sqlite3"))
SYNC_CODE = os.environ.get("PSL_SYNC_CODE", "")
ALLOWED_STORES = {"transactions", "stock_movements", "snapshots", "corrections", "periods"}
LOCK = threading.RLock()

app = FastAPI(title="Papa Sauce Lab Sync", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

class SyncRecord(BaseModel):
    store: str
    key: str
    payload: dict[str, Any]
    ts: int = 0

class PushBody(BaseModel):
    records: list[SyncRecord] = Field(default_factory=list)

def _code_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def _auth(code: str | None) -> None:
    if not SYNC_CODE:
        raise HTTPException(status_code=503, detail="sync_not_configured")
    if not code or _code_hash(code) != _code_hash(SYNC_CODE):
        raise HTTPException(status_code=401, detail="unauthorized")

def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con

def _init_db() -> None:
    with LOCK, _connect() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS records (
              store_name TEXT NOT NULL,
              record_key TEXT NOT NULL,
              payload TEXT NOT NULL,
              client_updated_at INTEGER NOT NULL DEFAULT 0,
              server_updated_at INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (store_name, record_key)
            )
            """
        )
        con.execute(
            "CREATE INDEX IF NOT EXISTS idx_records_server_updated ON records(server_updated_at)"
        )
        con.commit()

@app.on_event("startup")
def startup() -> None:
    _init_db()

@app.get("/health")
def health() -> dict[str, Any]:
    with _connect() as con:
        con.execute("SELECT 1").fetchone()
    return {
        "service": "PAPA_SAUCE_LAB_SYNC",
        "status": "ONLINE",
        "version": APP_VERSION,
        "configured": bool(SYNC_CODE),
    }

@app.post("/sync/push")
def push(body: PushBody, x_psl_sync_code: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_psl_sync_code)
    if len(body.records) > 10000:
        raise HTTPException(status_code=413, detail="too_many_records")

    accepted = 0
    now = int(time.time() * 1000)

    with LOCK, _connect() as con:
        for rec in body.records:
            if rec.store not in ALLOWED_STORES or not rec.key:
                continue

            payload = json.dumps(rec.payload, ensure_ascii=False, separators=(",", ":"))
            current = con.execute(
                "SELECT client_updated_at FROM records WHERE store_name=? AND record_key=?",
                (rec.store, rec.key),
            ).fetchone()

            if current is None:
                con.execute(
                    """
                    INSERT INTO records(store_name, record_key, payload, client_updated_at, server_updated_at)
                    VALUES(?,?,?,?,?)
                    """,
                    (rec.store, rec.key, payload, int(rec.ts or 0), now),
                )
                accepted += 1
            elif int(rec.ts or 0) >= int(current["client_updated_at"] or 0):
                con.execute(
                    """
                    UPDATE records
                    SET payload=?, client_updated_at=?, server_updated_at=?
                    WHERE store_name=? AND record_key=?
                    """,
                    (payload, int(rec.ts or 0), now, rec.store, rec.key),
                )
                accepted += 1
        con.commit()

    return {"ok": True, "accepted": accepted, "serverTime": now}

@app.get("/sync/pull")
def pull(
    since: int = 0,
    x_psl_sync_code: str | None = Header(default=None),
) -> dict[str, Any]:
    _auth(x_psl_sync_code)
    since = max(0, int(since or 0))

    with _connect() as con:
        rows = con.execute(
            """
            SELECT store_name, record_key, payload, client_updated_at, server_updated_at
            FROM records
            WHERE server_updated_at > ?
            ORDER BY server_updated_at ASC
            LIMIT 20000
            """,
            (since,),
        ).fetchall()

    records = []
    server_time = int(time.time() * 1000)
    for row in rows:
        records.append(
            {
                "store": row["store_name"],
                "key": row["record_key"],
                "payload": json.loads(row["payload"]),
                "ts": int(row["client_updated_at"] or 0),
                "serverUpdatedAt": int(row["server_updated_at"] or 0),
            }
        )

    return {"ok": True, "records": records, "serverTime": server_time}

@app.get("/sync/stats")
def stats(x_psl_sync_code: str | None = Header(default=None)) -> dict[str, Any]:
    _auth(x_psl_sync_code)
    with _connect() as con:
        rows = con.execute(
            """
            SELECT store_name, COUNT(*) AS count
            FROM records
            GROUP BY store_name
            ORDER BY store_name
            """
        ).fetchall()
    return {"ok": True, "stores": [{"store": r["store_name"], "count": r["count"]} for r in rows]}
