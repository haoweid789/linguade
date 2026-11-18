# -*- coding: utf-8 -*-
"""B5 AI 练习契约测试：后端 5 端点形状（TestClient mock 模式）+ 前端 e2e。"""
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_initial_assessment_shape(client):
    r = client.post("/api/ai/practice/initial-assessment", json={"seed": 42, "count": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["source"] == "mock"
    assert len(body["items"]) == 5
    for it in body["items"]:
        assert "skill" in it and "type" in it


def test_recommend_sorted_by_acc(client):
    r = client.post("/api/ai/practice/recommend", json={
        "weakPoints": [{"key": "v:A", "acc": 80, "total": 10}, {"key": "v:B", "acc": 30, "total": 10}],
        "count": 5,
    })
    assert r.status_code == 200
    items = r.json()["items"]
    assert items[0]["skill"] == "v:B"      # 最弱优先
    assert items[0]["acc"] == 30


def test_save_and_report(client):
    r1 = client.post("/api/ai/practice/save", json={
        "sessionId": "t1", "items": [{"id": "p0", "type": "word_recall", "answer": "die", "ms": 1200}]
    })
    assert r1.status_code == 200
    assert r1.json()["sessionId"] == "t1"
    assert r1.json()["answered"] == 1
    r2 = client.post("/api/ai/practice/report", json={"sessionId": "t1"})
    assert r2.status_code == 200
    body = r2.json()
    assert body["template"] is True
    assert "accuracy" in body["sections"]


def test_report_llm_status_reflects_config(client):
    """无 LLM 配置时 report 返回 LLM 未配置说明。"""
    from backend.app.config import settings
    r = client.post("/api/ai/practice/report", json={"sessionId": "t2"})
    body = r.json()
    if not settings.llm_base_url:
        assert "未配置" in body["advice"]
    else:
        assert "就绪" in body["advice"]