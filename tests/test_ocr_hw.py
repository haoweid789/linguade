"""华为云 OCR 通道：解析与降级（全部 monkeypatch，不联网）。"""
import asyncio
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from app.config import settings  # noqa: E402


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


def _configure_hw(monkeypatch):
    monkeypatch.setattr(settings, "llm_base_url", "https://example.com/v1", raising=False)
    monkeypatch.setattr(settings, "llm_api_key", "test-key", raising=False)
    monkeypatch.setattr(settings, "ocr_base_url", "https://ocr.cn-north-4.myhuaweicloud.com", raising=False)
    monkeypatch.setattr(settings, "ocr_project_id", "proj-1", raising=False)
    monkeypatch.setattr(settings, "ocr_ak", "ak-test", raising=False)
    monkeypatch.setattr(settings, "ocr_sk", "sk-test", raising=False)


def test_recognize_parses_lines(monkeypatch):
    from app import hwcloud

    _configure_hw(monkeypatch)

    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return {"result": [{"words": "Ich lerne Deutsch.", "confidence": 0.9},
                               {"words": "  ", "confidence": None}]}

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return Resp()

    monkeypatch.setattr(hwcloud.httpx, "AsyncClient", Client)
    out = _run(hwcloud.recognize_handwriting(b"\x89PNG"))
    assert out["text"] == "Ich lerne Deutsch."
    assert out["confidence"] == 0.9


def test_grade_uses_huawei_then_llm(monkeypatch):
    from app import ocr

    _configure_hw(monkeypatch)

    async def fake_ocr(*a, **k):
        return {"text": "Ich habe ein Buch.", "confidence": 0.88}

    async def fake_chat(*a, **k):
        return '{"corrections": [], "comments": "ok"}'

    async def no_cache(*a, **k):
        return None

    monkeypatch.setattr(ocr.hwcloud, "recognize_handwriting", fake_ocr)
    monkeypatch.setattr(ocr.llm, "chat", fake_chat)
    monkeypatch.setattr(ocr.cache, "get", no_cache)
    monkeypatch.setattr(ocr.cache, "set", no_cache)
    out = _run(ocr.grade(b"\x89PNG", "image/png"))
    assert out["source"] == "huawei-ocr+llm"
    assert out["transcript"] == "Ich habe ein Buch."
    assert out["ocr"]["channel"] == "huawei"


def test_grade_falls_back_to_vision(monkeypatch):
    from app import ocr

    _configure_hw(monkeypatch)

    async def broken_ocr(*a, **k):
        raise RuntimeError("boom")

    async def fake_chat(*a, **k):
        return '{"transcript": "vision", "corrections": []}'

    async def no_cache(*a, **k):
        return None

    monkeypatch.setattr(ocr.hwcloud, "recognize_handwriting", broken_ocr)
    monkeypatch.setattr(ocr.llm, "chat", fake_chat)
    monkeypatch.setattr(ocr.cache, "get", no_cache)
    monkeypatch.setattr(ocr.cache, "set", no_cache)
    out = _run(ocr.grade(b"\x89PNG", "image/png"))
    assert out["source"] == "vision-llm"
    assert "OCR 失败" in out["ocr"]["note"]
