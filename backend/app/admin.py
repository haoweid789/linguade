"""管理员路由：站点级配置读写。

写入后立即覆盖 config.settings 单例，llm.py 每次调用都实时读取，因此全站即时生效、无需重启。
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import llm
from .config import settings
from .hwcloud import ocr_ready
from .models import AppSetting
from .security import require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"])

EDITABLE = ("llm_base_url", "llm_api_key", "llm_model", "llm_api_style", "llm_api_version",
            "asr_base_url", "asr_api_key",
            "ocr_base_url", "ocr_project_id", "ocr_ak", "ocr_sk")
SECRETS = ("llm_api_key", "asr_api_key", "ocr_ak", "ocr_sk")


async def get_db():
    from .models import SessionLocal
    async with SessionLocal() as s:
        yield s


def _mask(secret: str) -> str:
    if not secret:
        return ""
    return "••••••••" + secret[-4:] if len(secret) > 4 else "••••"


def _active() -> dict:
    return {
        "llm": bool(settings.llm_base_url and settings.llm_api_key),
        "llm_style": settings.llm_api_style,
        "asr": bool(settings.asr_base_url),
        "ocr_hw": ocr_ready(),
    }


async def apply_saved_settings(db: AsyncSession) -> None:
    """把库里的配置覆盖到 settings 单例（启动时调用一次；PUT 之后也调用）"""
    rows = (await db.execute(select(AppSetting))).scalars().all()
    for row in rows:
        if row.key in EDITABLE:
            setattr(settings, row.key, row.value)


@router.get("/settings")
async def read_settings(request: Request, db: AsyncSession = Depends(get_db)):
    await require_admin(request, db)
    return {
        "llm_base_url": settings.llm_base_url,
        "llm_api_key": _mask(settings.llm_api_key),
        "llm_key_set": bool(settings.llm_api_key),
        "llm_model": settings.llm_model,
        "llm_api_style": settings.llm_api_style,
        "llm_api_version": settings.llm_api_version,
        "asr_base_url": settings.asr_base_url,
        "asr_api_key": _mask(settings.asr_api_key),
        "asr_key_set": bool(settings.asr_api_key),
        "ocr_base_url": settings.ocr_base_url,
        "ocr_project_id": settings.ocr_project_id,
        "ocr_ak": _mask(settings.ocr_ak),
        "ocr_sk": _mask(settings.ocr_sk),
        "ocr_keys_set": bool(settings.ocr_ak and settings.ocr_sk),
        "active": _active(),
    }


@router.put("/settings")
async def write_settings(payload: dict, request: Request, db: AsyncSession = Depends(get_db)):
    await require_admin(request, db)
    changed = {}
    for key in EDITABLE:
        if key not in payload:
            continue
        value = str(payload[key] or "").strip()
        if key in SECRETS and not value:
            continue  # 留空表示不修改，避免把已保存的密钥清掉
        changed[key] = value
    if not changed:
        raise HTTPException(400, "没有需要保存的配置")

    existing = {r.key: r for r in (await db.execute(select(AppSetting))).scalars().all()}
    for key, value in changed.items():
        if key in existing:
            existing[key].value = value
        else:
            db.add(AppSetting(key=key, value=value))
    await db.commit()
    await apply_saved_settings(db)
    return {"ok": True, "saved": sorted(changed.keys()), "active": _active()}


@router.post("/llm-test")
async def test_llm(request: Request, db: AsyncSession = Depends(get_db)):
    """真实调用一次大模型，返回可诊断的结果；密钥不出后端。"""
    await require_admin(request, db)
    return await llm.test_connection()
