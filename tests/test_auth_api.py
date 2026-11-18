"""账号 / 权限 / 管理员配置的接口级回归测试。

用 httpx 的 ASGITransport 直连 FastAPI 应用，落一个临时 SQLite，不依赖外网。
运行：python -m pytest tests/test_auth_api.py -q
"""
import asyncio
import os
import pathlib
import sys
import tempfile

_DB = pathlib.Path(tempfile.gettempdir()) / "linguade_auth_test.db"
if _DB.exists():
    _DB.unlink()
os.environ["LINGUADE_DATABASE_URL"] = "sqlite+aiosqlite:///" + _DB.as_posix()
os.environ["LINGUADE_INVITE_CODE"] = "test-invite"
os.environ["LINGUADE_ADMIN_USER"] = "owner"
os.environ.pop("LINGUADE_LLM_BASE_URL", None)
os.environ.pop("LINGUADE_LLM_API_KEY", None)

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

import httpx  # noqa: E402

from app.config import settings  # noqa: E402

# 其他测试模块可能已先导入 app.config；显式赋值保证与本文件的环境变量一致
settings.database_url = os.environ["LINGUADE_DATABASE_URL"]
settings.invite_code = "test-invite"
settings.admin_user = "owner"
settings.llm_base_url = ""
settings.llm_api_key = ""
settings.asr_base_url = ""
settings.asr_api_key = ""
settings.ocr_base_url = ""
settings.ocr_project_id = ""
settings.ocr_ak = ""
settings.ocr_sk = ""

from app.main import app  # noqa: E402


def _client():
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _flow():
    from app.admin import apply_saved_settings
    from app.models import SessionLocal, init_db

    await init_db()

    async with _client() as owner:
        r = await owner.get("/api/auth/state")
        assert r.status_code == 200 and r.json()["accounts_exist"] is False

        r = await owner.post("/api/auth/register", json={
            "username": "owner", "password": "secret123", "invite": "bad-code"})
        assert r.status_code == 403, "邀请码错误必须被拒"

        r = await owner.post("/api/auth/register", json={
            "username": "owner", "password": "secret123", "invite": "test-invite"})
        assert r.status_code == 200
        body = r.json()
        assert body["is_admin"] is True, "admin_user 指定用户名应成为管理员"
        owner_open_id = body["open_id"]
        assert "ld_session" in owner.cookies

        # 诊断状态以服务端为准：新账号未完成 → 完成后置位
        assert (await owner.get("/api/auth/me")).json()["diagnosed"] is False
        assert (await owner.post("/api/auth/diagnosed")).status_code == 200
        assert (await owner.get("/api/auth/me")).json()["diagnosed"] is True

        # 有账号后：未登录访问业务接口必须 401，公开接口仍可访问
        async with _client() as anon:
            assert (await anon.get("/api/health")).status_code == 200
            r = await anon.get("/api/queue", params={"open_id": "u-anonymous"})
            assert r.status_code == 401, "登录门禁未生效"
            r = await anon.post("/api/sync", json={"open_id": "u-anonymous"})
            assert r.status_code == 401

        # 管理员可读配置，Key 必须打码
        r = await owner.get("/api/admin/settings")
        assert r.status_code == 200
        r = await owner.put("/api/admin/settings", json={
            "llm_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "llm_api_key": "sk-secret-9876", "llm_model": "qwen-plus"})
        assert r.status_code == 200 and r.json()["active"]["llm"] is True

        r = await owner.get("/api/admin/settings")
        assert "sk-secret-9876" not in r.text, "接口不得回显完整 Key"
        assert r.json()["llm_key_set"] is True

        r = await owner.get("/api/health")
        assert r.json()["llm"] is True, "保存后应即时生效"

        # 华为云 OCR（AK/SK + Project ID）与语音可选 Key
        r = await owner.put("/api/admin/settings", json={
            "ocr_base_url": "https://ocr.cn-north-4.myhuaweicloud.com",
            "ocr_project_id": "proj-1234",
            "ocr_ak": "AKTEST1234", "ocr_sk": "SKTEST5678",
            "asr_base_url": "http://127.0.0.1:9/v1/asr", "asr_api_key": "asr-key-0001"})
        assert r.status_code == 200 and r.json()["active"]["ocr_hw"] is True

        r = await owner.get("/api/admin/settings")
        for secret in ("AKTEST1234", "SKTEST5678", "asr-key-0001"):
            assert secret not in r.text, "接口不得回显完整密钥"
        assert r.json()["ocr_keys_set"] is True and r.json()["asr_key_set"] is True

        # 留空表示不修改，不能把已保存的密钥清掉
        await owner.put("/api/admin/settings", json={"ocr_ak": "", "asr_api_key": ""})
        r = await owner.get("/api/admin/settings")
        assert r.json()["ocr_keys_set"] is True and r.json()["asr_key_set"] is True

        h = (await owner.get("/api/health")).json()
        assert h["ocr_huawei"] is True and h["ocr"] is True
        assert h["asr"] is True

        # 写入后重启（清空内存再加载）仍应保留
        settings.llm_api_key = ""
        settings.llm_base_url = ""
        async with SessionLocal() as db:
            await apply_saved_settings(db)
        assert settings.llm_api_key == "sk-secret-9876"
        assert settings.llm_base_url.startswith("https://dashscope")

        # 普通用户：不能进管理员接口，也不能读写别人的 open_id
        async with _client() as guest:
            r = await guest.post("/api/auth/register", json={
                "username": "guest", "password": "secret123", "invite": "test-invite"})
            assert r.status_code == 200 and r.json()["is_admin"] is False
            guest_open_id = r.json()["open_id"]
            assert (await guest.get("/api/admin/settings")).status_code == 403

            r = await guest.post("/api/sync", json={
                "open_id": owner_open_id, "profile": {"name": "冒名"}, "log": [],
                "snapshot": {"profile": {"name": "冒名"}}})
            assert r.status_code == 200
            assert r.json()["open_id"] == guest_open_id, "必须强制绑定登录账号的 open_id"

        # 登录校验
        async with _client() as bad:
            r = await bad.post("/api/auth/login", json={"username": "guest", "password": "wrong-pass"})
            assert r.status_code == 401
            r = await bad.post("/api/auth/login", json={"username": "guest", "password": "secret123"})
            assert r.status_code == 200 and r.json()["username"] == "guest"

        # 登出后会话失效（未登录返回 200 + authenticated=false，避免浏览器控制台 401 噪音）
        assert (await owner.post("/api/auth/logout")).status_code == 200
        me_after_logout = await owner.get("/api/auth/me")
        assert me_after_logout.status_code == 200, (me_after_logout.status_code, me_after_logout.text)
        assert me_after_logout.json()["authenticated"] is False


def _run(coro):
    """全量 e2e 会话里 Playwright 会在主线程残留运行中的事件循环，裸 asyncio.run 会炸
    （单跑本文件不会触发）；此时丢到独立线程的干净 loop 上执行，保证两种跑法行为一致。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    import threading

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


def test_auth_and_admin_flow():
    from app.models import engine

    _run(_flow())
    _run(engine.dispose())
    try:
        _DB.unlink()
    except OSError:   # Windows 上引擎句柄释放略滞后，临时文件清不掉可忽略
        pass
