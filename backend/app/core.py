"""业务路由：同步 / 队列 / 作答 / 错题 / 统计"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import cache
from .models import AnswerLog, StudySession, SyncSnapshot, User, WrongItem
from .schemas import AnswerIn, SyncPayload
from .security import account_from_request

router = APIRouter(prefix="/api", tags=["core"])


async def get_db():
    from .models import SessionLocal
    async with SessionLocal() as s:
        yield s


async def owner_open_id(request: Request, claimed: str, db: AsyncSession) -> str:
    """已登录时以账号的 open_id 为准，避免客户端传别人的 id 越权读写"""
    acc = await account_from_request(request, db)
    return acc.open_id if acc else claimed


async def get_or_create_user(db: AsyncSession, open_id: str, profile: dict | None = None) -> User:
    u = (await db.execute(select(User).where(User.open_id == open_id))).scalar_one_or_none()
    if not u:
        u = User(open_id=open_id)
        db.add(u)
    if profile:
        for k in ("name", "exam", "level", "daily_min"):
            if k in profile:
                setattr(u, k, profile[k])
        if profile.get("ability"):
            u.ability = profile["ability"]
    await db.commit()
    return u


# ---------- 数据同步（前端「同步到学习云」） ----------
@router.post("/sync")
async def sync(payload: SyncPayload, request: Request, db: AsyncSession = Depends(get_db)):
    open_id = await owner_open_id(request, payload.open_id, db)
    user = await get_or_create_user(db, open_id, payload.profile)
    n = 0
    for rec in payload.log[-500:]:
        db.add(AnswerLog(user_id=user.id, module=rec.get("type", "unknown"),
                         item=str(rec.get("item", ""))[:120], ok=bool(rec.get("ok")),
                         ms=int(rec.get("ms", 0)), detail=rec))
        n += 1
    # 全量快照 upsert：供换设备时 GET /api/sync 恢复（每设备仅保留最新一份）
    if payload.snapshot:
        snap = (await db.execute(
            select(SyncSnapshot).where(SyncSnapshot.open_id == open_id))).scalar_one_or_none()
        if snap:
            # 防御：空档推送不得覆盖云端已有丰富快照（设备清数据后误触发的“真空同步”）
            # 真正的重置走 DELETE /api/sync 显式清空
            incoming = payload.snapshot if isinstance(payload.snapshot, dict) else {}
            existing = snap.data if isinstance(snap.data, dict) else {}

            def _has_progress(d: dict) -> bool:
                if not d:
                    return False
                if d.get("diagnosed"):
                    return True
                if int(d.get("xp") or 0) > 0:
                    return True
                if isinstance(d.get("cards"), dict) and d["cards"]:
                    return True
                if isinstance(d.get("log"), list) and d["log"]:
                    return True
                if isinstance(d.get("wordbank"), list) and d["wordbank"]:
                    return True
                if isinstance(d.get("wrong"), list) and d["wrong"]:
                    return True
                return False

            if _has_progress(existing) and not _has_progress(incoming):
                await db.commit()
                return {
                    "ok": False,
                    "detail": "已拒绝空快照覆盖云端学习进度：请先在新设备上用「从云端恢复」拉取，再同步。",
                    "open_id": open_id,
                }
            snap.data = payload.snapshot
        else:
            db.add(SyncSnapshot(open_id=open_id, data=payload.snapshot))
    await db.commit()
    await cache.set(f"profile:{open_id}",
                    {"ability": payload.ability, "profile": payload.profile}, 86400)
    return {"ok": True, "user_id": user.id, "imported": n, "open_id": open_id}


@router.get("/sync")
async def pull_sync(request: Request, open_id: str = Query(min_length=6, max_length=64),
                    db: AsyncSession = Depends(get_db)):
    """拉取最近一次同步快照（前端「从云端恢复」）"""
    open_id = await owner_open_id(request, open_id, db)
    snap = (await db.execute(
        select(SyncSnapshot).where(SyncSnapshot.open_id == open_id))).scalar_one_or_none()
    if not snap:
        raise HTTPException(404, "云端暂无该设备的学习快照，请先在其他设备执行同步")
    return {"ok": True, "open_id": open_id, "snapshot": snap.data,
            "updated_at": snap.updated_at.isoformat() if snap.updated_at else None}


@router.delete("/sync")
async def drop_sync(request: Request, open_id: str = Query(min_length=6, max_length=64),
                    db: AsyncSession = Depends(get_db)):
    """清空该账号的云端档案（前端「清空重置」调用），使入学诊断可以重新进行"""
    open_id = await owner_open_id(request, open_id, db)
    user = (await db.execute(select(User).where(User.open_id == open_id))).scalar_one_or_none()
    if user:
        for model in (AnswerLog, WrongItem, StudySession):
            await db.execute(model.__table__.delete().where(model.user_id == user.id))
        await db.delete(user)
    await db.execute(SyncSnapshot.__table__.delete().where(SyncSnapshot.open_id == open_id))
    await db.commit()
    return {"ok": True, "cleared": open_id}


# ---------- 题库 / 自适应队列 ----------
@router.get("/queue")
async def queue(request: Request, open_id: str = Query(...), size: int = 20,
                db: AsyncSession = Depends(get_db)):
    from .models import Word
    open_id = await owner_open_id(request, open_id, db)
    user = await get_or_create_user(db, open_id)
    # 简化版调度：优先返回低等级高频词，真实 SM-2 调度在前端引擎完成（离线优先架构）
    rows = (await db.execute(select(Word).order_by(Word.level, Word.id).limit(size))).scalars().all()
    return {"user_id": user.id, "items": [
        {"de": w.de, "art": w.art, "zh": w.zh, "pos": w.pos, "lv": w.level,
         "ex": w.example, "exzh": w.example_zh} for w in rows]}


# ---------- 作答上报 ----------
@router.post("/answer")
async def answer(rec: AnswerIn, request: Request, db: AsyncSession = Depends(get_db)):
    open_id = await owner_open_id(request, rec.open_id, db)
    user = await get_or_create_user(db, open_id)
    db.add(AnswerLog(user_id=user.id, module=rec.module, item=rec.item[:120],
                     ok=rec.ok, ms=rec.ms, detail=rec.detail))
    await db.commit()
    return {"ok": True}


# ---------- 错题 ----------
@router.post("/wrong")
async def add_wrong(request: Request, open_id: str = Query(...), item: dict = {}, db: AsyncSession = Depends(get_db)):
    open_id = await owner_open_id(request, open_id, db)
    user = await get_or_create_user(db, open_id)
    module = item.get("module", "unknown")
    type_ = item.get("type", "综合")
    wrong = item.get("wrong", "")
    # 同源错题合并计数:已有未掌握记录则 times+1,避免重复堆积
    exist = (await db.execute(
        select(WrongItem).where(WrongItem.user_id == user.id,
                                WrongItem.module == module,
                                WrongItem.type == type_,
                                WrongItem.wrong == wrong,
                                WrongItem.mastered.is_(False))
        .order_by(WrongItem.id.desc()).limit(1))).scalar_one_or_none()
    if exist:
        exist.times += 1
        if item.get("right"):
            exist.right = item["right"]
        if item.get("why"):
            exist.why = item["why"]
        w = exist
    else:
        w = WrongItem(user_id=user.id, module=module, type=type_, wrong=wrong,
                      right=item.get("right", ""), why=item.get("why", ""))
        db.add(w)
    await db.commit()
    return {"ok": True, "id": w.id}


@router.get("/wrong")
async def list_wrong(request: Request, open_id: str = Query(...), mastered: Optional[bool] = None,
                     db: AsyncSession = Depends(get_db)):
    open_id = await owner_open_id(request, open_id, db)
    user = (await db.execute(select(User).where(User.open_id == open_id))).scalar_one_or_none()
    if not user:
        return {"items": []}
    q = select(WrongItem).where(WrongItem.user_id == user.id)
    if mastered is not None:
        q = q.where(WrongItem.mastered == mastered)
    rows = (await db.execute(q.order_by(WrongItem.id.desc()).limit(200))).scalars().all()
    return {"items": [{"id": r.id, "module": r.module, "type": r.type, "wrong": r.wrong,
                       "right": r.right, "why": r.why, "times": r.times,
                       "mastered": r.mastered} for r in rows]}


# ---------- 学情统计 ----------
@router.get("/stats/{open_id}")
async def stats(request: Request, open_id: str, days: int = 14, db: AsyncSession = Depends(get_db)):
    open_id = await owner_open_id(request, open_id, db)
    user = (await db.execute(select(User).where(User.open_id == open_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(404, "用户不存在，请先同步")
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    total = (await db.execute(select(func.count()).select_from(AnswerLog)
                              .where(AnswerLog.user_id == user.id,
                                     AnswerLog.created_at >= since))).scalar() or 0
    ok = (await db.execute(select(func.count()).select_from(AnswerLog)
                           .where(AnswerLog.user_id == user.id,
                                  AnswerLog.created_at >= since,
                                  AnswerLog.ok == True))).scalar() or 0  # noqa: E712
    sessions = (await db.execute(select(func.coalesce(func.sum(StudySession.ms), 0))
                                 .where(StudySession.user_id == user.id,
                                        StudySession.created_at >= since))).scalar() or 0
    return {
        "user": {"name": user.name, "level": user.level, "exam": user.exam},
        "ability": user.ability or {},
        "days": days, "answers": total,
        "accuracy": round(ok / total * 100, 1) if total else 0,
        "total_ms": sessions,
    }
