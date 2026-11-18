"""认证基础件：密码哈希、会话令牌、登录限速。

密码用标准库 scrypt（无额外依赖），格式 scrypt$n$r$p$salt$hash。
会话令牌随机 32 字节，存库并下发 HttpOnly Cookie。
"""
import base64
import hashlib
import secrets
import threading
import time
from datetime import datetime, timedelta

from fastapi import HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import Account, AuthSession

COOKIE_NAME = "ld_session"
_N, _R, _P = 2 ** 14, 8, 1
_FAIL_WINDOW, _FAIL_LIMIT = 60, 5
_fails: dict[str, list[float]] = {}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    b64 = lambda b: base64.b64encode(b).decode()
    return "scrypt$%d$%d$%d$%s$%s" % (_N, _R, _P, b64(salt), b64(dk))


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt_b64),
                            n=int(n), r=int(r), p=int(p), dklen=32)
        return secrets.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


def check_rate_limit(ip: str) -> None:
    now = time.time()
    recent = [t for t in _fails.get(ip, []) if now - t < _FAIL_WINDOW]
    if len(recent) >= _FAIL_LIMIT:
        raise HTTPException(429, "尝试过于频繁，请 1 分钟后再试")
    recent.append(now)
    _fails[ip] = recent


def clear_rate_limit(ip: str) -> None:
    _fails.pop(ip, None)


_AI_DAY = 86400
_AI_MINUTE = 60
_ai_calls: dict[str, list[float]] = {}
_ai_lock = threading.Lock()


def consume_ai_quota(key: str, daily_limit: int, minute_limit: int) -> tuple[bool, str]:
    """按账号滚动窗口限流；单进程内存计数，多 worker/多机时需换 Redis。"""
    now = time.time()
    daily_limit = max(1, daily_limit)
    minute_limit = max(1, minute_limit)
    with _ai_lock:
        calls = [t for t in _ai_calls.get(key, []) if now - t < _AI_DAY]
        if len(calls) >= daily_limit:
            return False, f"AI 调用已达上限（{daily_limit} 次/24 小时），请稍后再试"
        if sum(1 for t in calls if now - t < _AI_MINUTE) >= minute_limit:
            return False, f"AI 请求过于频繁（{minute_limit} 次/分钟），请稍后再试"
        calls.append(now)
        _ai_calls[key] = calls
        if len(_ai_calls) > 2048:
            cutoff = now - _AI_DAY
            for k in [k for k, v in _ai_calls.items() if not v or v[-1] < cutoff]:
                _ai_calls.pop(k, None)
    return True, ""


async def accounts_exist(db: AsyncSession) -> bool:
    return (await db.execute(select(func.count()).select_from(Account))).scalar_one() > 0


async def create_session(db: AsyncSession, account: Account) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(days=settings.session_days)
    db.add(AuthSession(token=token, account_id=account.id, expires_at=expires))
    await db.execute(AuthSession.__table__.delete().where(AuthSession.expires_at < datetime.utcnow()))
    await db.commit()
    return token


async def account_from_request(request: Request, db: AsyncSession) -> Account | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    row = (await db.execute(select(AuthSession).where(AuthSession.token == token))).scalar_one_or_none()
    if not row or row.expires_at < datetime.utcnow():
        return None
    return (await db.execute(select(Account).where(Account.id == row.account_id))).scalar_one_or_none()


async def require_admin(request: Request, db: AsyncSession) -> Account:
    acc = await account_from_request(request, db)
    if not acc:
        raise HTTPException(401, "请先登录")
    if not acc.is_admin:
        raise HTTPException(403, "需要管理员权限")
    return acc
