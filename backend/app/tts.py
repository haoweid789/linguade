"""发音合成（TTS）适配层：给词表/例句补发音音频，前端音频列直接消费。

双通道可插拔（在华为云接口之外新增「语言 API Key」通道；tools/tts_generate.py 是批量脚本版）：
  siliconflow  硅基流动 POST /v1/audio/speech（Bearer 语言 API Key）——德语可用；
               HeyGen 音色为 UUID voice_id，留空直接走 CosyVoice2 兜底音色。
               heygen/heygen-voice-1-turbo 平台标注免费至 2026-11-30，下架后兜底通道继续可用。
  hwcloud      华为云 SIS RunTts（POST /v1/{project_id}/tts，音频 base64 于 result.data）。
               AK/SK 为账号级 IAM 凭证，直接复用 OCR 的 ocr_ak/ocr_sk/ocr_project_id，
               签名复用 hwcloud.sign；官方音色表目前仅中英文，德语内容请走 siliconflow。
  voxcpm       自建 vLLM-Omni / Nano-vLLM 部署的 OpenBMB VoxCPM2（POST /v1/audio/speech，
               OpenAI 兼容接口）。
               零商业凭据：只需服务地址；德语支持由模型自带（30 语言，不需 language tag）。
               本地自建默认不带 Bearer（有鉴权网关才配 voxcpm_api_key）。
               默认按按钮/词卡发音策略控制 Real-Time 延迟：4000 字符以内、wav 48kHz。
  off（默认）  后端不参与：POST /api/tts 返回 501，前端自动回落浏览器 TTS（SpeechUtil.say）。
"""
import base64
import hashlib
import json
from urllib.parse import quote

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from . import cache, hwcloud
from .config import settings

router = APIRouter(prefix="/api", tags=["tts"])

MAX_CHARS = {"siliconflow": 5000, "hwcloud": 500, "voxcpm": 4000}
FORMATS = {"siliconflow": ("mp3", "wav", "pcm", "opus"), "hwcloud": ("wav", "mp3", "pcm"),
           "voxcpm": ("wav", "mp3")}
MIME = {"mp3": "audio/mpeg", "wav": "audio/wav", "pcm": "audio/x-raw", "opus": "audio/ogg"}
SF_FALLBACK_MODEL = "FunAudioLLM/CosyVoice2-0.5B"
SF_FALLBACK_VOICE = SF_FALLBACK_MODEL + ":anna"


def tts_ready() -> bool:
    ch = settings.tts_channel
    if ch == "siliconflow":
        return bool(settings.siliconflow_api_key)
    if ch == "hwcloud":
        return bool(settings.tts_sis_endpoint and settings.ocr_project_id
                    and settings.ocr_ak and settings.ocr_sk)
    if ch == "voxcpm":
        return bool(settings.voxcpm_base_url)
    return False


def channel_status() -> dict:
    """与 phoneme / kt 的 health 汇报同构。"""
    return {"channel": settings.tts_channel, "ready": tts_ready()}


def _candidates() -> list:
    """siliconflow 的（模型, 音色）候选序列：配了 voice_id 先走所配模型，失败降级 CosyVoice2。"""
    cands = []
    if settings.siliconflow_tts_voice:
        cands.append((settings.siliconflow_tts_model, settings.siliconflow_tts_voice))
    cands.append((SF_FALLBACK_MODEL, SF_FALLBACK_VOICE))
    return cands[:2] if len(cands) == 2 and cands[0] != cands[1] else cands[:1]


async def _sf_post(url: str, body: dict, timeout: float) -> bytes:
    async with httpx.AsyncClient(timeout=timeout) as cli:
        r = await cli.post(url, headers={
            "Authorization": "Bearer " + settings.siliconflow_api_key,
            "Content-Type": "application/json",
        }, json=body)
    if r.status_code >= 400:
        raise RuntimeError("siliconflow HTTP %s：%s" % (r.status_code, r.text[:160]))
    audio = r.content
    if audio[:1] == b"{" or len(audio) < 100:
        raise RuntimeError("siliconflow 返回不是音频流：%s"
                           % audio[:160].decode("utf-8", "replace"))
    return audio


async def _synthesize_sf(text: str, fmt: str) -> tuple:
    url = settings.siliconflow_base_url.rstrip("/") + "/v1/audio/speech"
    last = ""
    for model, voice in _candidates():
        body = {"model": model, "input": text, "voice": voice,
                "response_format": fmt, "speed": 1.0}
        if fmt != "opus":            # opus 固定 48kHz，接口不收 sample_rate
            body["sample_rate"] = 44100
        try:
            return await _sf_post(url, body, timeout=60), model
        except RuntimeError as e:
            last = str(e)
    raise RuntimeError(last)


async def _synthesize_voxcpm(text: str, fmt: str) -> tuple:
    """VoxCPM2（vLLM-Omni / Nano-vLLM OpenAI 兼容接口），零凭据默认无 Bearer。"""
    url = settings.voxcpm_base_url.rstrip("/") + "/v1/audio/speech"
    body = {"model": settings.voxcpm_model or "openbmb/VoxCPM2",
            "input": text, "voice": settings.voxcpm_voice or "default",
            "response_format": fmt}
    headers = {"Content-Type": "application/json"}
    if settings.voxcpm_api_key:
        headers["Authorization"] = "Bearer " + settings.voxcpm_api_key
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post(url, headers=headers, json=body)
    if r.status_code >= 400:
        raise RuntimeError("voxcpm HTTP %s：%s" % (r.status_code, r.text[:160]))
    audio = r.content
    # 返回可能是 wav/mp3 二进制，或 JSON 包音频 base64（部分网关形态）
    if audio[:1] == b"{":
        try:
            doc = r.json()
        except ValueError:
            raise RuntimeError("voxcpm 返回不是音频流：%s" % audio[:160].decode("utf-8", "replace")) from None
        b64 = (doc.get("data") or (doc.get("audio") if isinstance(doc.get("audio"), str) else None)
               or doc.get("b64"))
        if not b64:
            raise RuntimeError("voxcpm 返回 JSON 但缺少音频载体：%s" % str(doc)[:160])
        audio = base64.b64decode(b64)
    if len(audio) < 100:
        raise RuntimeError("voxcpm 返回为空或过短（%d bytes）" % len(audio))
    return audio, settings.voxcpm_model or "openbmb/VoxCPM2"


async def _synthesize_sis(text: str, fmt: str) -> tuple:
    url = settings.tts_sis_endpoint.rstrip("/") + "/v1/" + quote(settings.ocr_project_id) + "/tts"
    payload = json.dumps({"text": text[:MAX_CHARS["hwcloud"]], "config": {
        "audio_format": fmt,
        "sample_rate": "16000",
        "property": settings.tts_sis_property,
    }}).encode()
    headers = hwcloud.sign("POST", url, {"Content-Type": "application/json"},
                           payload, settings.ocr_ak, settings.ocr_sk)
    async with httpx.AsyncClient(timeout=60) as cli:
        r = await cli.post(url, headers=headers, content=payload)
    try:
        doc = r.json()
    except ValueError:
        raise RuntimeError("SIS 返回不是 JSON（HTTP %s）：%s" % (r.status_code, r.text[:120])) from None
    if doc.get("error_code"):
        raise RuntimeError("SIS.%s：%s" % (doc["error_code"], doc.get("error_msg")))
    b64 = (doc.get("result") or {}).get("data")
    if not b64:
        raise RuntimeError("SIS 响应缺少 result.data：%s" % str(doc)[:160])
    return base64.b64decode(b64), settings.tts_sis_property


async def synthesize(text: str, fmt: str = "mp3") -> dict:
    """文本 → {audio: bytes, format, model, cached}。同句同配置结果走缓存（音频 base64 存储）。"""
    ch = settings.tts_channel
    if ch not in MAX_CHARS:
        raise RuntimeError("TTS 未启用：请设置 LINGUADE_TTS_CHANNEL=siliconflow / hwcloud / voxcpm")
    fmt = fmt if fmt in FORMATS[ch] else ("mp3" if ch == "siliconflow" else "wav")
    if len(text) > MAX_CHARS[ch]:
        raise RuntimeError("文本超过 %s 通道 %d 字符上限（当前 %d）" % (ch, MAX_CHARS[ch], len(text)))

    key = "tts:" + hashlib.sha1("|".join(
        [ch, text, fmt, settings.siliconflow_base_url,
         settings.siliconflow_tts_model, settings.siliconflow_tts_voice,
         settings.tts_sis_property, settings.voxcpm_base_url, settings.voxcpm_model,
         settings.voxcpm_voice]).encode()).hexdigest()[:16]
    hit = await cache.get(key)
    if hit:
        return {"audio": base64.b64decode(hit["b64"]), "format": hit["format"],
                "model": hit["model"], "cached": True}

    if ch == "siliconflow":
        audio, model = await _synthesize_sf(text, fmt)
    elif ch == "voxcpm":
        audio, model = await _synthesize_voxcpm(text, fmt)
    else:
        audio, model = await _synthesize_sis(text, fmt)
    await cache.set(key, {"b64": base64.b64encode(audio).decode(),
                          "format": fmt, "model": model}, ttl=86400)
    return {"audio": audio, "format": fmt, "model": model, "cached": False}


class TtsReq(BaseModel):
    text: str
    fmt: str = "mp3"


@router.post("/tts")
async def tts(req: TtsReq):
    """文本 → 发音音频。未启用/超限返回 501（前端回落浏览器 TTS），空文本 422，上游故障 502。"""
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(422, "text 不能为空")
    try:
        out = await synthesize(text, req.fmt)
    except RuntimeError as e:
        raise HTTPException(501, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, "合成失败：%s" % e)
    return Response(content=out["audio"], media_type=MIME.get(out["format"], "application/octet-stream"),
                    headers={"Cache-Control": "public, max-age=86400",
                             "X-TTS-Model": out["model"],
                             "X-TTS-Cached": "1" if out["cached"] else "0"})
