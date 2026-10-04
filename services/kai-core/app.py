from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(title="ACC KAI Core", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    "mode": "SIMULATION",
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
    return event

@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "acc-kai-core",
        "version": app.version,
        "time": now_iso(),
    }

@app.get("/state")
async def get_state() -> dict[str, Any]:
    return STATE

@app.get("/events")
async def get_events(limit: int = 50) -> list[dict[str, Any]]:
    return STATE["events"][: max(1, min(limit, 200))]

@app.post("/goals")
async def create_goal(body: GoalCreate) -> dict[str, Any]:
    goal = {
        "id": str(uuid4()),
        "status": "ROUTING",
        "created_at": now_iso(),
        **body.model_dump(),
    }
    STATE["goals"].insert(0, goal)
    STATE["kai"]["status"] = "ROUTING"
    await emit("goal.created", goal)
    await emit(
        "kai.status.changed",
        {"status": "ROUTING", "reason": f"Routing goal {goal['id']}"},
    )
    return goal

@app.post("/tasks")
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

@app.post("/tasks/{task_id}/start")
async def start_task(task_id: str) -> dict[str, Any]:
    for task in STATE["tasks"]:
        if task["id"] == task_id:
            task["status"] = "WORKING"
            task["started_at"] = now_iso()
            await emit("task.started", task)
            await emit(
                "agent.status.changed",
                {
                    "agent_id": task["agent_id"],
                    "status": "WORKING",
                    "division": task["division"],
                    "task_id": task_id,
                },
            )
            return task
    return {"error": "task_not_found"}

@app.post("/tasks/{task_id}/complete")
async def complete_task(task_id: str) -> dict[str, Any]:
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

@app.post("/approvals/{approval_id}")
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
