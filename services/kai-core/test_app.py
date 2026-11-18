import importlib.util
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

MODULE = Path(__file__).with_name("app.py")


def make_app(tmp_path, monkeypatch):
    monkeypatch.setenv("KAI_CORE_OWNER_TOKEN", "test-secret-not-for-production")
    monkeypatch.setenv("KAI_CORE_DB_PATH", str(tmp_path / "state.sqlite3"))
    monkeypatch.setenv("KAI_CORE_ALLOWED_ORIGINS", "https://hq.nadmo.id")
    spec = importlib.util.spec_from_file_location("kai_core_test_instance", MODULE)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod.app


def test_auth_and_persistence(tmp_path, monkeypatch):
    app = make_app(tmp_path, monkeypatch)
    with TestClient(app, base_url="https://hq.nadmo.id") as client:
        assert client.get("/state").status_code == 401
        assert client.post("/auth/login", json={"token": "wrong"}).status_code == 401
        login = client.post("/auth/login", json={"token": "test-secret-not-for-production"})
        assert login.status_code == 200
        assert "httponly" in login.headers["set-cookie"].lower()
        headers = {"origin": "https://hq.nadmo.id"}
        goal = client.post("/goals", json={"title": "Audit ACC", "division": "TECH & INFRA"}, headers=headers)
        assert goal.status_code == 200
        assert client.post("/goals", json={"title": "CSRF", "division": "TECH & INFRA"},
                           headers={"origin": "https://attacker.example"}).status_code == 403
        assert len(client.get("/state").json()["goals"]) == 1
        task = client.post("/tasks", json={"title": "Do real work", "agent_id": "head-tech", "division": "TECH & INFRA"}, headers=headers).json()
        assert client.post(f"/tasks/{task['id']}/complete", headers=headers).status_code == 409

    app2 = make_app(tmp_path, monkeypatch)
    with TestClient(app2, base_url="https://hq.nadmo.id") as client:
        client.post("/auth/login", json={"token": "test-secret-not-for-production"})
        assert len(client.get("/state").json()["goals"]) == 1
        assert len(client.get("/state").json()["tasks"]) == 1
