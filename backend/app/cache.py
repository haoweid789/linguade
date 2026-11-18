"""缓存层：华为云 Redis（未配置 REDIS_URL 时降级为进程内缓存，保证本地零依赖可跑）"""
import json
import time
from typing import Any, Optional

from .config import settings

try:
    import redis.asyncio as aioredis
except ImportError:
    aioredis = None

_memory: dict[str, tuple[float, str]] = {}
_client = None

if settings.redis_url and aioredis:
    _client = aioredis.from_url(settings.redis_url, decode_responses=True)

TTL_DEFAULT = 600


async def get(key: str) -> Optional[Any]:
    if _client:
        try:
            v = await _client.get(key)
            return json.loads(v) if v else None
        except Exception:
            # 华为云 Redis 暂不可达时回落进程内缓存，避免业务请求 500
            pass
    item = _memory.get(key)
    if item and item[0] > time.time():
        return json.loads(item[1])
    if item:
        _memory.pop(key, None)
    return None


async def set(key: str, value: Any, ttl: int = TTL_DEFAULT) -> None:
    payload = json.dumps(value, ensure_ascii=False)
    if _client:
        try:
            await _client.set(key, payload, ex=ttl)
            return
        except Exception:
            # 写入失败时继续写进程内缓存，保持与未配置 Redis 时一致的可用性
            pass
    _memory[key] = (time.time() + ttl, payload)


async def delete(key: str) -> None:
    if _client:
        try:
            await _client.delete(key)
        except Exception:
            pass
    _memory.pop(key, None)
