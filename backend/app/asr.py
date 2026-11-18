"""语音链路适配层
计划书设计：Whisper 德语识别（昇腾 AI 云服务部署）→ 转写文本 → 前端三维评分。
后端职责：把音频转发给已部署的 ASR 推理服务（ASR_BASE_URL），并缓存同句结果。
"""
import base64
import hashlib

import httpx

from . import cache
from .config import settings


async def transcribe(audio_bytes: bytes, fmt: str = "webm", lang: str = "de") -> dict:
    """调用昇腾上的 Whisper 推理服务。服务侧约定接口：
    POST /v1/asr  { "audio": <base64>, "format": "webm", "language": "de" }
    => { "text": "...", "confidence": 0.93 }
    """
    if not settings.asr_base_url:
        raise RuntimeError("ASR 未配置：请设置 LINGUADE_ASR_BASE_URL（昇腾 Whisper 推理服务地址）")
    key = "asr:" + hashlib.sha1(audio_bytes).hexdigest()[:16]
    hit = await cache.get(key)
    if hit:
        return hit
    async with httpx.AsyncClient(timeout=60) as cli:
        headers = {}
        if settings.asr_api_key:
            headers["Authorization"] = "Bearer " + settings.asr_api_key
        r = await cli.post(
            settings.asr_base_url.rstrip("/") + "/v1/asr",
            headers=headers,
            json={"audio": base64.b64encode(audio_bytes).decode(), "format": fmt, "language": lang},
        )
        r.raise_for_status()
        out = r.json()
    await cache.set(key, out, ttl=3600)
    return out
