"""账号路由：注册（邀请码）/ 登录 / 登出 / 当前身份。

门禁策略：库里没有任何账号时全站放行（保证本地开发与 e2e 不受影响）；
一旦注册出第一个账号，除公开路径外的 /api/* 都要求登录。
"""
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .models import Account
from .security import (COOKIE_NAME, account_from_request, accounts_exist,
                       check_rate_limit, clear_rate_limit, create_session,
                       hash_password, verify_password)

router = APIRouter(prefix="/api/auth", tags=["auth"])
USERNAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fa5]{3,32}$")

PUBLIC_PATHS = ("/api/health", "/api/auth/state", "/api/auth/register", "/api/auth/login", "/api/auth/me")


async def get_db():
    from .models import SessionLocal
    async with SessionLocal() as s:
        yield s


def _set_cookie(resp: Response, token: str) -> None:
    resp.set_cookie(COOKIE_NAME, token, max_age=settings.session_days * 86400,
                    httponly=True, samesite="lax", path="/", secure=settings.cookie_secure)


def _client_ip(request: Request) -> str:
    """反向代理后 request.client.host 是 nginx 容器 IP；取它会让所有用户共用一个限流桶。
    nginx 会覆盖 X-Real-IP，优先使用；直连开发环境仍回落到 socket 地址。"""
    real = (request.headers.get("x-real-ip") or "").strip()
    if real:
        return real
    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    return fwd or (request.client.host if request.client else "unknown")


def _acc(acc: Account) -> dict:
    return {"username": acc.username, "is_admin": acc.is_admin,
            "open_id": acc.open_id, "diagnosed": bool(acc.diagnosed)}


@router.get("/state")
async def state(db: AsyncSession = Depends(get_db)):
    exists = await accounts_exist(db)
    return {"accounts_exist": exists, "register_open": bool(settings.invite_code) or not exists}


@router.post("/register")
async def register(payload: dict, request: Request, resp: Response, db: AsyncSession = Depends(get_db)):
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    invite = str(payload.get("invite", "")).strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(400, "用户名需 3–32 位，仅限中英文、数字、下划线")
    if len(password) < 8:
        raise HTTPException(400, "密码至少 8 位")

    exists = await accounts_exist(db)
    if settings.invite_code:
        if not secrets.compare_digest(invite, settings.invite_code):
            raise HTTPException(403, "邀请码不正确")
    elif exists:
        raise HTTPException(403, "注册已关闭，请联系站点管理员")

    if (await db.execute(select(Account).where(Account.username == username))).scalar_one_or_none():
        raise HTTPException(409, "用户名已被占用")

    is_admin = (username == settings.admin_user) if settings.admin_user else (not exists)
    acc = Account(username=username, password_hash=hash_password(password),
                  is_admin=is_admin, open_id="u" + secrets.token_hex(8))
    db.add(acc)
    await db.commit()
    await db.refresh(acc)

    _set_cookie(resp, await create_session(db, acc))
    return {"ok": True, **_acc(acc)}


@router.post("/login")
async def login(payload: dict, request: Request, resp: Response, db: AsyncSession = Depends(get_db)):
    ip = _client_ip(request)
    check_rate_limit(ip)
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", ""))
    acc = (await db.execute(select(Account).where(Account.username == username))).scalar_one_or_none()
    if not acc or not verify_password(password, acc.password_hash):
        raise HTTPException(401, "用户名或密码不正确")
    clear_rate_limit(ip)
    _set_cookie(resp, await create_session(db, acc))
    return {"ok": True, **_acc(acc)}


@router.post("/logout")
async def logout(request: Request, resp: Response, db: AsyncSession = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        from .models import AuthSession
        await db.execute(AuthSession.__table__.delete().where(AuthSession.token == token))
        await db.commit()
    resp.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me")
async def me(request: Request, db: AsyncSession = Depends(get_db)):
    acc = await account_from_request(request, db)
    if not acc:
        return {"ok": True, "authenticated": False}
    return {"ok": True, "authenticated": True, **_acc(acc)}


@router.post("/diagnosed")
async def mark_diagnosed(request: Request, db: AsyncSession = Depends(get_db)):
    """入学诊断完成标记：以服务端为准，换浏览器/换设备都不会被要求重考"""
    acc = await account_from_request(request, db)
    if not acc:
        raise HTTPException(401, "请先登录")
    if not acc.diagnosed:
        acc.diagnosed = True
        await db.commit()
    return {"ok": True, "diagnosed": True}


@router.post("/diagnosed/reset")
async def reset_diagnosed(request: Request, db: AsyncSession = Depends(get_db)):
    """允许已登录用户主动重测；仅重置当前账号的诊断门禁。"""
    acc = await account_from_request(request, db)
    if not acc:
        raise HTTPException(401, "请先登录")
    if acc.diagnosed:
        acc.diagnosed = False
        await db.commit()
    return {"ok": True, "diagnosed": False}
