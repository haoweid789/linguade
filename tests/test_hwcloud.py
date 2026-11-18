"""华为云 AK/SK 签名单元测试（纯本地，不发请求）。"""
import pathlib
import sys
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "backend"))


def _api():
    # 延迟导入：避免抢先加载 app.config，影响 test_auth_api 依赖环境变量的初始化顺序
    from app.hwcloud import _canonical_query, sign
    return _canonical_query, sign


def test_query_sorted_and_encoded():
    canonical_query, _ = _api()
    assert canonical_query("b=2&a=1&c=x y") == "a=1&b=2&c=x%20y"
    assert canonical_query("") == ""


def _headers(body=b'{"image":"abc"}'):
    _, sign = _api()
    return sign(
        "POST",
        "https://ocr.cn-north-4.myhuaweicloud.com/v2/proj-1/ocr/handwriting",
        {"Content-Type": "application/json"},
        body, "AKID", "SKID",
        now=datetime(2026, 10, 28, 12, 0, 0, tzinfo=timezone.utc),
    )


def test_sign_headers():
    h = _headers()
    assert h["X-Sdk-Date"] == "20261028T120000Z"
    assert h["Host"] == "ocr.cn-north-4.myhuaweicloud.com"
    assert h["Authorization"].startswith(
        "SDK-HMAC-SHA256 Access=AKID, "
        "SignedHeaders=content-type;host;x-sdk-date, Signature=")


def test_signature_is_stable_and_body_sensitive():
    assert _headers()["Authorization"] == _headers()["Authorization"]
    assert _headers(b"{}")["Authorization"] != _headers()["Authorization"]
