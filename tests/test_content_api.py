"""学习语料库（MERLIN 写作样本 / Tatoeba 授权录音）接口回归测试。

只读内置的 backend/data/learning_content.sqlite，不依赖外网，也不需要登录。
运行：python -m pytest tests/test_content_api.py -q
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.content import router  # noqa: E402

_app = FastAPI()
_app.include_router(router)
client = TestClient(_app)


def test_writing_samples_filter_and_attribution():
    r = client.get("/api/content/writing", params={"level": "B1", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == len(body["items"]) == 5
    for item in body["items"]:
        assert item["level"] == "B1"
        assert item["text"].strip()
        assert item["attribution"] and item["source_url"]
        assert item["text_license"] == "CC BY-SA 4.0"
        assert item["audio_url"] == ""


def test_writing_rejects_invalid_params_and_ignores_offset():
    assert client.get("/api/content/writing", params={"level": "X9"}).status_code == 422
    assert client.get("/api/content/writing", params={"limit": 99}).status_code == 422
    assert client.get("/api/content/writing", params={"offset": 5}).status_code == 200


def test_listening_assets_and_audio_stream():
    r = client.get("/api/content/listening", params={"limit": 3})
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 3
    for item in items:
        assert item["audio_license"].startswith("CC BY")
        assert item["attribution"]
    audio = client.get(items[0]["audio_url"])
    assert audio.status_code == 200
    assert audio.headers["content-type"] == "audio/mpeg"
    assert audio.content[:3] == b"ID3" or audio.content[:2] in (b"\xff\xfb", b"\xff\xf3")


def test_audio_unknown_asset_is_404():
    assert client.get("/api/content/audio", params={"asset_id": "nope"}).status_code == 404
    # 写作条目没有音频，也不能通过音频接口取到
    wid = client.get("/api/content/writing", params={"limit": 1}).json()["items"][0]["asset_id"]
    assert client.get("/api/content/audio", params={"asset_id": wid}).status_code == 404
