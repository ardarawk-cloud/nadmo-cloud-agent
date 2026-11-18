from __future__ import annotations

import os
import json
import sqlite3
import secrets
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import Request, HTTPException, Depends, status
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

DB_PATH = os.getenv("KAI_CORE_DB_PATH", "/data/kai-core.sqlite3")
OWNER_TOKEN = os.getenv("KAI_CORE_OWNER_TOKEN", "")
ALLOWED_ORIGINS = [x.strip() for x in os.getenv("KAI_CORE_ALLOWED_ORIGINS", "").split(",") if x.strip()]

def require_owner(request: Request) -> None:
    if not OWNER_TOKEN:
        raise HTTPException(status_code=503, detail="owner_token_not_configured")
    token = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not secrets.compare_digest(token, OWNER_TOKEN):
        raise HTTPException(status_code=401, detail="unauthorized")

def db_connect():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.execute("CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)")
    db.commit()
    return db

def persist():
    with db_connect() as db:
        db.execute("INSERT INTO snapshots(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body", (json.dumps(STATE),))
        db.commit()

@asynccontextmanager
async def lifespan(app: FastAPI):
    with db_connect() as db:
        row = db.execute("SELECT body FROM snapshots WHERE id=1").fetchone()
    if row:
        restored = json.loads(row[0])
        for key in ("goals", "tasks", "approvals", "events", "agents", "kai"):
            if key in restored:
                STATE[key] = restored[key]
    yield

app = FastAPI(title="ACC KAI Core", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

AgentStatus = Literal[
    "IDLE",
    "PLANNING",
    "MOVING",
    "WORKING",
    "REVIEWING",
    "WAITING_DEPENDENCY",
    "WAITING_APPROVAL",
    "DONE",
    "ERROR",
]

class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    division: str
    priority: Literal["LOW", "NORMAL", "HIGH", "URGENT"] = "NORMAL"
    target: str | None = None
    deadline: str | None = None
    success_criteria: str | None = None
    notes: str | None = None

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    agent_id: str
    division: str
    goal_id: str | None = None
    priority: Literal["LOW", "NORMAL", "HIGH", "URGENT"] = "NORMAL"

class ApprovalResolve(BaseModel):
    decision: Literal["APPROVE", "REJECT", "REVISE", "HOLD"]
    note: str | None = None

STATE: dict[str, Any] = {
    "mode": "CONTROL_PLANE_ONLY",
    "owner": {"id": "arda", "name": "Arda", "role": "OWNER"},
    "kai": {
        "id": "kai-prime",
        "name": "KAI",
        "role": "ACC CORE AI",
        "status": "IDLE",
    },
    "agents": {},
    "goals": [],
    "tasks": [],
    "approvals": [],
    "events": [],
}

SOCKETS: set[WebSocket] = set()

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

async def emit(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    event = {
        "id": str(uuid4()),
        "type": event_type,
        "timestamp": now_iso(),
        "payload": payload,
    }
    STATE["events"].insert(0, event)
    STATE["events"] = STATE["events"][:200]

    dead: list[WebSocket] = []
    for ws in SOCKETS:
        try:
            await ws.send_json(event)
        except Exception:
            dead.append(ws)
    for ws in dead:
        SOCKETS.discard(ws)
    persist()
    return event

@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "acc-kai-core",
        "version": app.version,
        "time": now_iso(),
    }

@app.get("/state", dependencies=[Depends(require_owner)])
async def get_state() -> dict[str, Any]:
    return STATE

@app.get("/events", dependencies=[Depends(require_owner)])
async def get_events(limit: int = 50) -> list[dict[str, Any]]:
    return STATE["events"][: max(1, min(limit, 200))]

@app.post("/goals", dependencies=[Depends(require_owner)])
async def create_goal(body: GoalCreate) -> dict[str, Any]:
    goal = {
        "id": str(uuid4()),
        "status": "ROUTING",
        "created_at": now_iso(),
        **body.model_dump(),
    }
    STATE["goals"].insert(0, goal)
    STATE["kai"]["status"] = "PLANNING"
    await emit("goal.created", goal)
    await emit(
        "kai.status.changed",
        {"status": "ROUTING", "reason": f"Routing goal {goal['id']}"},
    )
    return goal

@app.post("/tasks", dependencies=[Depends(require_owner)])
async def create_task(body: TaskCreate) -> dict[str, Any]:
    task = {
        "id": str(uuid4()),
        "status": "CREATED",
        "progress": 0,
        "created_at": now_iso(),
        **body.model_dump(),
    }
    STATE["tasks"].insert(0, task)
    await emit("task.created", task)
    return task

@app.post("/tasks/{task_id}/start", dependencies=[Depends(require_owner)])
async def start_task(task_id: str) -> dict[str, Any]:
    for task in STATE["tasks"]:
        if task["id"] == task_id:
            task["status"] = "WAITING_DEPENDENCY"
            task["started_at"] = now_iso()
            await emit("task.started", task)
            await emit(
                "agent.status.changed",
                {
                    "agent_id": task["agent_id"],
                    "status": "WAITING_DEPENDENCY",
                    "division": task["division"],
                    "task_id": task_id,
                },
            )
            return task
    return {"error": "task_not_found"}

@app.post("/tasks/{task_id}/complete", dependencies=[Depends(require_owner)])
async def complete_task(task_id: str) -> dict[str, Any]:
    raise HTTPException(status_code=409, detail="executor_evidence_required")
    for task in STATE["tasks"]:
        if task["id"] == task_id:
            task["status"] = "WAITING_APPROVAL"
            task["progress"] = 100
            task["completed_at"] = now_iso()
            approval = {
                "id": str(uuid4()),
                "task_id": task_id,
                "status": "WAITING_OWNER",
                "created_at": now_iso(),
            }
            STATE["approvals"].insert(0, approval)
            await emit("task.completed", task)
            await emit("approval.requested", approval)
            return {"task": task, "approval": approval}
    return {"error": "task_not_found"}

@app.post("/approvals/{approval_id}", dependencies=[Depends(require_owner)])
async def resolve_approval(
    approval_id: str, body: ApprovalResolve
) -> dict[str, Any]:
    for approval in STATE["approvals"]:
        if approval["id"] == approval_id:
            approval["status"] = body.decision
            approval["note"] = body.note
            approval["resolved_at"] = now_iso()
            await emit("approval.resolved", approval)
            return approval
    return {"error": "approval_not_found"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    token = websocket.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not OWNER_TOKEN or not secrets.compare_digest(token, OWNER_TOKEN):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    SOCKETS.add(websocket)
    await websocket.send_json(
        {
            "id": str(uuid4()),
            "type": "system.connected",
            "timestamp": now_iso(),
            "payload": {
                "service": "acc-kai-core",
                "mode": STATE["mode"],
            },
        }
    )
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        SOCKETS.discard(websocket)
