"""同步快照归属与越权防护的接口级回归（3.21.0 配套）。

用 httpx ASGITransport 直连 FastAPI，落临时 SQLite。覆盖：
  1. 登录 → POST /api/sync upsert → GET 拉回同一份快照
  2. 归属强制：登录 A 后带 B 的 open_id 请求，服务端一律按 A 的 open_id 处理（防越权读写）
  3. 有账号后匿名访问 /api/sync 必须 401
  4. DELETE /api/sync 清空云端档案后 GET 404
运行：python -m pytest tests/test_sync_api.py -q
"""
import asyncio
import os
import pathlib
import sys
import tempfile
import threading

_DB = pathlib.Path(tempfile.gettempdir()) / "linguade_sync_test.db"
if _DB.exists():
    _DB.unlink()
os.environ["LINGUADE_DATABASE_URL"] = "sqlite+aiosqlite:///" + _DB.as_posix()
os.environ["LINGUADE_INVITE_CODE"] = "test-invite"
os.environ["LINGUADE_ADMIN_USER"] = "owner"

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402

settings.database_url = os.environ["LINGUADE_DATABASE_URL"]
settings.invite_code = "test-invite"
settings.admin_user = "owner"

from app.main import app  # noqa: E402


def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _run(coro):
    """与 e2e 同会话时的 asyncio.run 必炸坑：线程内独立跑事件循环"""
    box = {}

    def target():
        try:
            box["out"] = asyncio.run(coro)
        except BaseException as e:  # noqa: BLE001
            box["err"] = e

    t = threading.Thread(target=target, daemon=True)
    t.start()
    t.join()
    if "err" in box:
        raise box["err"]
    return box.get("out")


async def _flow():
    from app.models import SessionLocal, init_db

    await init_db()

    async with _client() as a, _client() as b, _client() as anon:
        # 两个账号（首账号成为管理员，与本文件 settings 一致）
        r = await a.post("/api/auth/register", json={
            "username": "owner", "password": "secret123", "invite": "test-invite"})
        assert r.status_code == 200
        oid_a = r.json()["open_id"]

        r = await b.post("/api/auth/register", json={
            "username": "learner2", "password": "secret456", "invite": "test-invite"})
        assert r.status_code == 200
        oid_b = r.json()["open_id"]

        # 匿名（有账号库）必须被拦
        r = await anon.get("/api/sync", params={"open_id": oid_a})
        assert r.status_code == 401, "有账号后匿名拉取必须 401"
        r = await anon.post("/api/sync", json={"open_id": oid_a, "snapshot": {"xp": 1}})
        assert r.status_code == 401, "有账号后匿名推送必须 401"

        # A 推一份快照，GET 拉回同一份
        r = await a.post("/api/sync", json={
            "open_id": "x" * 16, "profile": {"name": "A"},
            "snapshot": {"xp": 100, "diagnosed": True, "log": [{"t": 1, "type": "vocab", "item": "Haus", "ok": True}]}})
        assert r.status_code == 200 and r.json()["ok"] is True
        assert r.json()["open_id"] == oid_a, "登录态下服务端应忽略客户端自报的 open_id"

        r = await a.get("/api/sync", params={"open_id": oid_a})
        assert r.status_code == 200 and r.json()["snapshot"]["xp"] == 100

        # B 也推一份不同的快照
        r = await b.post("/api/sync", json={
            "open_id": "y" * 16, "profile": {"name": "B"}, "snapshot": {"xp": 999, "diagnosed": True}})
        assert r.status_code == 200

        # 归属强制：A 带 B 的 open_id 读/写，服务端一律落回 A 自己的数据
        r = await a.get("/api/sync", params={"open_id": oid_b})
        assert r.status_code == 200 and r.json()["snapshot"]["xp"] == 100, "登录 A 读 B 的 open_id 必须强制回 A 的快照"
        r = await a.post("/api/sync", json={
            "open_id": oid_b, "snapshot": {"xp": 12345, "diagnosed": True}})
        assert r.status_code == 200 and r.json()["open_id"] == oid_a, "登录 A 写 B 的 open_id 必须强制写进 A 的档案"
        r = await b.get("/api/sync", params={"open_id": oid_b})
        assert r.json()["snapshot"]["xp"] == 999, "A 的越权写入不得污染 B 的快照"

        # 学情统计同样按账号归属
        r = await a.get(f"/api/stats/{oid_b}")
        assert r.status_code == 200, "统计接口也应按登录态归属返回 A 的数据"

        # 清空云端档案：DELETE 后 GET 404
        r = await a.delete("/api/sync", params={"open_id": oid_a})
        assert r.status_code == 200 and r.json()["ok"] is True
        r = await a.get("/api/sync", params={"open_id": oid_a})
        assert r.status_code == 404


def test_sync_ownership_flow():
    from app.models import engine

    _run(_flow())
    _run(engine.dispose())
    try:
        _DB.unlink()
    except OSError:   # Windows 上引擎句柄释放略滞后，临时文件清不掉可忽略
        pass

def test_sync_empty_snapshot_rejection():
    """空快照不得覆盖云端非空快照：真空设备误同步时学为守护"""
    import os as _os, pathlib as _p, sys as _s
    _s.path.insert(0, str(_p.Path(__file__).resolve().parents[1] / "backend"))
    os.environ["LINGUADE_DATABASE_URL"] = os.environ["LINGUADE_DATABASE_URL"]  # earlier module set it

    async def _flow2():
        import httpx
        from app.main import app
        from app.models import SessionLocal, init_db
        await init_db()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            # Fresh account.
            r = await c.post("/api/auth/register", json={
                "username": "owner2", "password": "secret123", "invite": "test-invite"})
            assert r.status_code == 200, r.text
            oid = r.json()["open_id"]
            # A rich snapshot.
            r = await c.post("/api/sync", json={
                "open_id": oid,
                "snapshot": {"diagnosed": True, "xp": 50, "log": [{"t": 1}], "cards": {"Haus": {}}, "wordbank": [], "wrong": []},
                "profile": {"name": "A"}, "ability": {}, "log": []})
            assert r.status_code == 200 and r.json()["ok"] is True, r.text
            # Vacuum snapshot attempt.
            r = await c.post("/api/sync", json={
                "open_id": oid,
                "snapshot": {"diagnosed": False, "xp": 0, "log": [], "cards": {}, "wordbank": [], "wrong": []},
                "profile": {"name": "A"}, "ability": {}, "log": []})
            assert r.status_code == 200 and r.json()["ok"] is False, "空快照覆盖应被拒绝"
            # Cloud still intact.
            r = await c.get("/api/sync", params={"open_id": oid})
            assert r.json()["snapshot"]["xp"] == 50
            r = await c.get("/api/sync", params={"open_id": oid})
            assert r.json()["snapshot"]["diagnosed"] is True

    _run(_flow2())
