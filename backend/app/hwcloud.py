"""华为云 AK/SK 签名与手写文字识别。

不引入华为 SDK：签名算法为公开的 SDK-HMAC-SHA256，仅用标准库实现，
避免为一个可选通道把镜像体积变大。
"""
import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from urllib.parse import quote, urlsplit

import httpx

from .config import settings


def _pct(value: str) -> str:
    return quote(str(value), safe="-_.~")


def _canonical_query(query: str) -> str:
    pairs = []
    for part in (query or "").split("&"):
        if not part:
            continue
        k, _, v = part.partition("=")
        pairs.append((_pct(k), _pct(v)))
    pairs.sort()
    return "&".join(k + "=" + v for k, v in pairs)


def _canonical_headers(headers: dict) -> tuple[str, str]:
    norm = {k.lower().strip(): str(v).strip() for k, v in headers.items()}
    items = sorted(norm.items())
    canon = "".join(k + ":" + v + "\n" for k, v in items)
    return canon, ";".join(k for k, _ in items)


def sign(method: str, url: str, headers: dict, body: bytes,
         ak: str, sk: str, now: datetime | None = None) -> dict:
    """返回补上 X-Sdk-Date 与 Authorization 的请求头副本。"""
    u = urlsplit(url)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")
    h = {k: v for k, v in headers.items() if k.lower() != "x-sdk-date"}
    h["X-Sdk-Date"] = stamp
    if not any(k.lower() == "host" for k in h):
        h["Host"] = u.netloc
    canon_headers, signed = _canonical_headers(h)
    path = "/".join(_pct(seg) for seg in (u.path or "/").split("/"))
    payload_hash = hashlib.sha256(body or b"").hexdigest()
    canon_req = "\n".join([method.upper(), path, _canonical_query(u.query),
                           canon_headers, signed, payload_hash])
    to_sign = "SDK-HMAC-SHA256\n" + stamp + "\n" + \
              hashlib.sha256(canon_req.encode()).hexdigest()
    sig = hmac.new(sk.encode(), to_sign.encode(), hashlib.sha256).hexdigest()
    h["Authorization"] = ("SDK-HMAC-SHA256 Access=%s, SignedHeaders=%s, Signature=%s"
                          % (ak, signed, sig))
    return h


def ocr_ready() -> bool:
    return bool(settings.ocr_base_url and settings.ocr_project_id
                and settings.ocr_ak and settings.ocr_sk)


async def recognize_handwriting(image_bytes: bytes, timeout: float = 30.0) -> dict:
    """调用 OCR 手写文字识别，返回 {text, confidence}。失败抛 RuntimeError。"""
    if not ocr_ready():
        raise RuntimeError("华为云 OCR 未配置（需要 Endpoint / Project ID / AK / SK）")
    url = "%s/v2/%s/ocr/handwriting" % (
        settings.ocr_base_url.rstrip("/"), _pct(settings.ocr_project_id))
    payload = json.dumps({
        "image": base64.b64encode(image_bytes).decode(),
        "detect_direction": True,
    }).encode()
    headers = sign("POST", url, {"Content-Type": "application/json"},
                   payload, settings.ocr_ak, settings.ocr_sk)
    async with httpx.AsyncClient(timeout=timeout) as cli:
        r = await cli.post(url, headers=headers, content=payload)
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or data.get("error_code"):
        reason = data.get("error_msg") or data.get("error_code") or r.text[:160]
        raise RuntimeError("华为云 OCR 返回 %s：%s" % (r.status_code, reason))
    items = data.get("result") or []
    lines = [str(it.get("words") or "").strip() for it in items]
    text = "\n".join(line for line in lines if line)
    scores = [it.get("confidence") for it in items
              if isinstance(it.get("confidence"), (int, float))]
    return {"text": text,
            "confidence": round(sum(scores) / len(scores), 3) if scores else None}
