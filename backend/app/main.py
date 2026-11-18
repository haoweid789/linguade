"""LinguaDE 后端入口
启动： uvicorn app.main:app --reload --port 8000
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from . import hwcloud
from . import kt as kt_mod
from . import phoneme as phoneme_mod
from .admin import apply_saved_settings
from .admin import router as admin_router
from .ai import router as ai_router
from .auth import PUBLIC_PATHS
from .auth import router as auth_router
from .config import settings
from .core import router as core_router
from .content import router as content_router
from .kt import router as kt_router
from .models import SessionLocal, init_db
from .ocr import router as ocr_router
from .phoneme import router as phoneme_router
from .security import account_from_request, accounts_exist
from .tts import router as tts_router
from . import tts as tts_mod


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with SessionLocal() as db:
        await apply_saved_settings(db)
    yield


class AuthGate(BaseHTTPMiddleware):
    """有账号后，除公开路径外的 /api/* 一律要求登录；空库放行以兼容本地开发与 e2e。"""

    async def dispatch(self, request, call_next):
        path = request.url.path
        if (not path.startswith("/api") or request.method == "OPTIONS" or path in PUBLIC_PATHS
                or (request.method == "GET" and path.startswith("/api/content/"))):
            return await call_next(request)
        async with SessionLocal() as db:
            if not await accounts_exist(db):
                return await call_next(request)
            acc = await account_from_request(request, db)
        if not acc:
            return JSONResponse({"detail": "请先登录"}, status_code=401)
        return await call_next(request)


app = FastAPI(title=settings.app_name, version="3.18.9", lifespan=lifespan)

app.add_middleware(AuthGate)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(core_router)
app.include_router(content_router)
app.include_router(ai_router)
app.include_router(ocr_router)
app.include_router(phoneme_router)
app.include_router(kt_router)
app.include_router(tts_router)


@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "database": settings.database_url.split("://")[0],   # sqlite / postgresql
        "redis": bool(settings.redis_url),
        "llm": bool(settings.llm_base_url and settings.llm_api_key),
        "llm_model": settings.llm_model if (settings.llm_base_url and settings.llm_api_key) else "",
        "llm_style": settings.llm_api_style if (settings.llm_base_url and settings.llm_api_key) else "",
        "asr": bool(settings.asr_base_url),
        "ocr": bool(hwcloud.ocr_ready() or (settings.llm_base_url and settings.llm_api_key)),
        "ocr_huawei": hwcloud.ocr_ready(),
        # 可选通道状态（3.7.0）：默认 rule / bkt 均为零依赖本地实现
        "phoneme": phoneme_mod.channel_status(),
        "kt": kt_mod.channel_status(),
        "tts": tts_mod.channel_status(),
    }
