"""TTS 适配层与 /api/tts 端点回归测试（MockTransport 假上游，零外网、零凭证）。

运行：python -m pytest tests/test_tts.py -q
覆盖：
  - off 通道：端点 501（前端据此回落浏览器 TTS）
  - siliconflow：happy path + 同句缓存命中（上游只打一次）+ heygen 失败自动降级 CosyVoice2
  - hwcloud SIS：AK/SK 签名头与 /v1/{project}/tts 路径断言 + result.data base64 解码
  - voxcpm：零凭据默认无 Bearer、二进制与 JSON 两种载体解析、请求形状断言
  - 边界：空文本 422、超长文本 501
"""
import asyncio
import base64
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

import httpx  # noqa: E402

# 模块导入时捕获原始 AsyncClient：_patch_http 会替换 httpx 模块属性（同一模块对象），
# 本文件自己的 ASGI 客户端必须用这里捕获的原始类，否则 transport 参数重复。
_REAL_CLIENT = httpx.AsyncClient

FAKE_MP3 = b"ID3" + b"\x00" * 300          # 满足「>100 字节且非 JSON」的合法性检查
FAKE_WAV = b"RIFF" + b"\x00" * 300


def _api():
    # 延迟导入：与 test_hwcloud 同策略，避免抢先加载 app.config 影响环境变量初始化顺序
    import app.tts as tts_mod
    from app.config import settings
    return tts_mod, settings


def _run(coro):
    """全量 e2e 会话里可能残留运行中的事件循环（Playwright/greenlet），裸 asyncio.run 会炸；
    此时丢到独立线程的干净 loop 上跑，保证单跑与全量跑行为一致。"""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    import threading

    box = {}

    def target():
        try:
            box["ok"] = asyncio.run(coro)
        except BaseException as e:  # noqa: BLE001
            box["err"] = e

    t = threading.Thread(target=target, daemon=True)
    t.start()
    t.join()
    if "err" in box:
        raise box["err"]
    return box["ok"]


def _patch_http(monkeypatch, handler):
    """把 app.tts 里的 httpx.AsyncClient 换成 MockTransport，返回请求记录列表。"""
    tts_mod, _ = _api()
    calls = []
    real_client = httpx.AsyncClient          # 先捕获原类，factory 内不能走已被替换的入口

    def wrapped(request):
        calls.append(request)
        return handler(request)

    def factory(**kw):
        return real_client(transport=httpx.MockTransport(wrapped), **kw)

    monkeypatch.setattr(tts_mod.httpx, "AsyncClient", factory)
    return calls


def _post(payload):
    tts_mod, _ = _api()
    from fastapi import FastAPI

    async def run():
        app = FastAPI()
        app.include_router(tts_mod.router)
        transport = httpx.ASGITransport(app=app)
        async with _REAL_CLIENT(transport=transport, base_url="http://t") as cli:
            return await cli.post("/api/tts", json=payload)

    return _run(run())


# ---------------------------------------------------------------- off 通道

def test_off_endpoint_501(monkeypatch):
    tts_mod, settings = _api()
    monkeypatch.setattr(settings, "tts_channel", "off")
    r = _post({"text": "Guten Tag"})
    assert r.status_code == 501
    assert "TTS 未启用" in r.json()["detail"]
    assert tts_mod.channel_status() == {"channel": "off", "ready": False}


def test_empty_text_422(monkeypatch):
    _api()
    assert _post({"text": "   "}).status_code == 422


# ---------------------------------------------------------------- siliconflow

def _sf_settings(settings, **kw):
    monkeypatch_kw = dict(tts_channel="siliconflow", siliconflow_api_key="sk-test",
                          siliconflow_tts_voice="", siliconflow_tts_model="heygen/heygen-voice-1-turbo")
    monkeypatch_kw.update(kw)
    for k, v in monkeypatch_kw.items():
        setattr(settings, k, v)


def test_siliconflow_happy_path_and_cache(monkeypatch):
    tts_mod, settings = _api()
    _sf_settings(settings)
    seen_models = []

    def handler(request):
        seen_models.append(json.loads(request.read())["model"])
        return httpx.Response(200, content=FAKE_MP3)

    calls = _patch_http(monkeypatch, handler)
    out1 = _run(tts_mod.synthesize("Guten Tag", "mp3"))
    out2 = _run(tts_mod.synthesize("Guten Tag", "mp3"))
    assert out1["audio"] == FAKE_MP3 and out1["model"] == "FunAudioLLM/CosyVoice2-0.5B"
    assert out2["cached"] is True and out2["audio"] == out1["audio"]
    assert len(calls) == 1                       # 第二次命中缓存，上游只打一次
    assert seen_models == ["FunAudioLLM/CosyVoice2-0.5B"]   # 未配 voice_id 直接走兜底模型

    r = _post({"text": "Guten Tag"})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.headers["x-tts-model"] == "FunAudioLLM/CosyVoice2-0.5B"
    assert r.headers["x-tts-cached"] == "1"


def test_siliconflow_fallback_on_error(monkeypatch):
    tts_mod, settings = _api()
    _sf_settings(settings, siliconflow_tts_voice="04629c0a-f1ff-4ad3-8cf1-a4568d53ee71")
    bodies = []

    def handler(request):
        model = json.loads(request.read())["model"]
        bodies.append(model)
        if model.startswith("heygen"):
            return httpx.Response(503, text='{"message":"model leaving"}')
        return httpx.Response(200, content=FAKE_MP3)

    calls = _patch_http(monkeypatch, handler)
    out = _run(tts_mod.synthesize("Wie geht es Ihnen?", "mp3"))
    assert out["model"] == "FunAudioLLM/CosyVoice2-0.5B"      # heygen 503 → 自动降级成功
    assert bodies[0].startswith("heygen") and bodies[1] == "FunAudioLLM/CosyVoice2-0.5B"
    assert len(calls) == 2


def test_siliconflow_length_limit(monkeypatch):
    tts_mod, settings = _api()
    _sf_settings(settings)
    _patch_http(monkeypatch, lambda request: httpx.Response(200, content=FAKE_MP3))
    r = _post({"text": "a" * 5001})
    assert r.status_code == 501
    assert "5000" in r.json()["detail"]


# ---------------------------------------------------------------- hwcloud SIS

def _sis_settings(settings):
    settings.tts_channel = "hwcloud"
    settings.tts_sis_endpoint = "https://sis.cn-north-4.myhuaweicloud.com"
    settings.ocr_project_id = "proj-1"
    settings.ocr_ak = "AKID"
    settings.ocr_sk = "SKID"


def test_sis_sign_and_decode(monkeypatch):
    tts_mod, settings = _api()
    _sis_settings(settings)
    _patch_http(monkeypatch, lambda request: httpx.Response(
        200, json={"result": {"data": base64.b64encode(FAKE_WAV).decode()}}))

    out = _run(tts_mod.synthesize("Hallo", "wav"))
    assert out["audio"] == FAKE_WAV and out["format"] == "wav"


def test_sis_request_shape(monkeypatch):
    tts_mod, settings = _api()
    _sis_settings(settings)
    captured = {}

    def handler(request):
        captured["auth"] = request.headers.get("authorization", "")
        captured["path"] = request.url.path
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, json={"result": {"data": base64.b64encode(FAKE_WAV).decode()}})

    _patch_http(monkeypatch, handler)
    _run(tts_mod.synthesize("Hallo Welt, wie bitte?", "wav"))   # 独立句子：内存缓存跨测试存活
    assert captured["auth"].startswith("SDK-HMAC-SHA256 Access=AKID, ")
    assert captured["path"] == "/v1/proj-1/tts"
    assert captured["body"]["config"]["audio_format"] == "wav"
    assert captured["body"]["config"]["property"] == "chinese_xiaoyu_common"


def test_sis_error_mapping(monkeypatch):
    tts_mod, settings = _api()
    _sis_settings(settings)
    _patch_http(monkeypatch, lambda request: httpx.Response(
        200, json={"error_code": "SIS.0032", "error_msg": "'audio_format' is invalid"}))
    r = _post({"text": "Auf Wiedersehen", "fmt": "wav"})
    assert r.status_code == 501
    assert "SIS.0032" in r.json()["detail"]


# ---------------------------------------------------------------- voxcpm

def _voxcpm_settings(settings, **kw):
    kwds = dict(tts_channel="voxcpm", voxcpm_base_url="http://127.0.0.1:8000",
                voxcpm_api_key="", voxcpm_model="openbmb/VoxCPM2", voxcpm_voice="")
    kwds.update(kw)
    for k, v in kwds.items():
        setattr(settings, k, v)


def test_voxcpm_ready_without_credentials(monkeypatch):
    tts_mod, settings = _api()
    _voxcpm_settings(settings)
    assert tts_mod.tts_ready() is True        # 零凭据即可（自建服务）
    _voxcpm_settings(settings, voxcpm_base_url="")
    assert tts_mod.tts_ready() is False       # 没配地址不就绪
    assert tts_mod.channel_status() == {"channel": "voxcpm", "ready": False}


def test_voxcpm_request_shape_and_binary(monkeypatch):
    tts_mod, settings = _api()
    _voxcpm_settings(settings)
    captured = {}

    def handler(request):
        captured["url"] = str(request.url)
        captured["auth"] = "Authorization" in request.headers
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, content=FAKE_WAV)

    calls = _patch_http(monkeypatch, handler)
    out = _run(tts_mod.synthesize("Guten Tag, wie geht es dir?", "wav"))
    assert out["audio"] == FAKE_WAV and out["model"] == "openbmb/VoxCPM2"
    assert captured["url"].endswith("/v1/audio/speech")
    assert captured["auth"] is False          # 本地自建默认无 Bearer
    assert captured["body"]["model"] == "openbmb/VoxCPM2"
    assert captured["body"]["voice"] == "default"
    assert captured["body"]["input"] == "Guten Tag, wie geht es dir?"
    assert captured["body"]["response_format"] == "wav"

    r = _post({"text": "Guten Tag, wie geht es dir?", "fmt": "wav"})
    assert r.status_code == 200
    assert r.headers["x-tts-cached"] == "1"   # 同句命中缓存，上游只打一次
    assert len(calls) == 1


def test_voxcpm_json_carrier_and_key(monkeypatch):
    tts_mod, settings = _api()
    _voxcpm_settings(settings, voxcpm_api_key="secret", voxcpm_voice="anna")
    captured = {}

    def handler(request):
        captured["auth"] = request.headers.get("Authorization", "")
        captured["body"] = json.loads(request.read())
        return httpx.Response(200, json={"data": base64.b64encode(FAKE_WAV).decode(),
                                         "sample_rate": 48000})

    _patch_http(monkeypatch, handler)
    out = _run(tts_mod.synthesize("Hallo Welt", "wav"))
    assert out["audio"] == FAKE_WAV
    assert captured["auth"] == "Bearer secret"
    assert captured["body"]["voice"] == "anna"


def test_voxcpm_error_mapping(monkeypatch):
    tts_mod, settings = _api()
    _voxcpm_settings(settings)
    _patch_http(monkeypatch, lambda request: httpx.Response(503, text='{"error":"overloaded"}'))
    r = _post({"text": "Auf Wiedersehen"})
    assert r.status_code == 501
    assert "voxcpm HTTP 503" in r.json()["detail"]
