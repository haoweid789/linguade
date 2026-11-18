"""大模型适配层：OpenAI 兼容 / Azure OpenAI / 自定义完整地址
带 Redis 结果缓存与超时降级；另提供 SSE 流式生成器。"""
import json
import re
import time

import httpx

from . import cache
from .config import settings

TIMEOUT = 45.0
STYLES = ("openai", "azure", "custom")


def build_request() -> tuple[str, str, dict]:
    """按接口类型生成 (style, url, headers)。

    openai：Bearer；base 自动补 /chat/completions，已含该路径则原样使用。
    azure ：api-key；{endpoint}/openai/deployments/{model}/chat/completions?api-version=…
    custom：Bearer；完整地址原样请求，不补路径（华为云 MaaS 部署地址 / 自建网关）。
    """
    style = (settings.llm_api_style or "openai").strip().lower()
    if style not in STYLES:
        style = "openai"
    base = (settings.llm_base_url or "").strip()
    key = settings.llm_api_key or ""
    model = settings.llm_model or ""
    headers = {"Content-Type": "application/json"}
    if style == "azure":
        endpoint = base.rstrip("/")
        ver = (settings.llm_api_version or "2024-02-15-preview").strip()
        url = f"{endpoint}/openai/deployments/{model}/chat/completions?api-version={ver}"
        headers["api-key"] = key
    elif style == "custom":
        url = base
        headers["Authorization"] = f"Bearer {key}"
    else:
        url = base.rstrip("/")
        if "/chat/completions" not in url:
            url += "/chat/completions"
        headers["Authorization"] = f"Bearer {key}"
    return style, url, headers


def _payload(messages: list[dict], temperature: float, stream: bool) -> dict:
    return {"model": settings.llm_model, "messages": messages,
            "temperature": temperature, "stream": stream}


async def chat(messages: list[dict], temperature: float = 0.7,
               cache_key: str | None = None, cache_ttl: int = 300,
               timeout: float | None = None) -> str:
    if not settings.llm_base_url or not settings.llm_api_key:
        raise RuntimeError("LLM 未配置：请设置 LINGUADE_LLM_BASE_URL / LINGUADE_LLM_API_KEY")
    if cache_key:
        hit = await cache.get(cache_key)
        if hit is not None:
            return hit
    _, url, headers = build_request()
    async with httpx.AsyncClient(timeout=timeout or TIMEOUT) as cli:
        r = await cli.post(url, headers=headers, json=_payload(messages, temperature, False))
        r.raise_for_status()
        txt = r.json()["choices"][0]["message"]["content"].strip()
    if cache_key:
        await cache.set(cache_key, txt, cache_ttl)
    return txt


async def chat_stream(messages: list[dict], temperature: float = 0.7):
    """流式对话：逐块产出增量文本（供 SSE 端点使用）"""
    if not settings.llm_base_url or not settings.llm_api_key:
        raise RuntimeError("LLM 未配置：请设置 LINGUADE_LLM_BASE_URL / LINGUADE_LLM_API_KEY")
    _, url, headers = build_request()
    async with httpx.AsyncClient(timeout=TIMEOUT) as cli:
        async with cli.stream("POST", url, headers=headers,
                              json=_payload(messages, temperature, True)) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    delta = json.loads(data)["choices"][0].get("delta", {}).get("content")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if delta:
                    yield delta


def _style_hint(style: str) -> str:
    if style == "azure":
        return "Azure：服务地址填资源 Endpoint，模型名填 deployment 名，API 版本默认 2024-02-15-preview"
    if style == "custom":
        return "自定义：地址原样请求，不会自动补 /chat/completions；适合华为云 MaaS 部署地址或自建网关"
    return "OpenAI 兼容：地址可填到 /v1，也可直接填完整 /chat/completions 地址"


def _safe_error(e: Exception) -> str:
    s = str(e)
    s = re.sub(r"\?[^ \"]+", "?…", s)      # 去掉查询串里可能存在的 token
    return s[:400]


async def test_connection() -> dict:
    """真实调用一次模型，返回可诊断结果；不返回密钥与完整 URL。"""
    style, _, _ = build_request()
    model = settings.llm_model or ""
    hint = _style_hint(style)
    if not settings.llm_base_url or not settings.llm_api_key:
        return {"ok": False, "stage": "config", "style": style, "model": model,
                "message": "服务地址或 API Key 未填齐", "hint": hint}
    t0 = time.perf_counter()
    try:
        reply = await chat(
            [{"role": "system", "content": "This is a connection test. Reply with the single word OK."},
             {"role": "user", "content": "ping"}],
            temperature=0, cache_key=None, timeout=20,
        )
        return {
            "ok": True, "stage": "ok", "style": style, "model": model,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "reply": (reply or "").strip()[:120], "hint": hint,
        }
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = (e.response.text or "").strip()[:400]
        except Exception:
            pass
        return {
            "ok": False, "stage": "request", "style": style, "model": model,
            "http_status": e.response.status_code,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "message": f"HTTP {e.response.status_code}" + (f" · {detail}" if detail else ""),
            "hint": hint,
        }
    except Exception as e:
        return {
            "ok": False, "stage": "request", "style": style, "model": model,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "message": _safe_error(e), "hint": hint,
        }


def grammar_prompt(sentence: str) -> list[dict]:
    return [
        {"role": "system", "content": (
            "你是德语语法纠错引擎。输入一句德语，输出严格的 JSON 数组（不要任何解释文字），每项："
            '{"type":"错误类型","wrong":"原文错误片段","fix":"修改后片段","why":"中文讲解(不超过40字)"}。'
            "若无错误返回 []。")},
        {"role": "user", "content": sentence},
    ]
