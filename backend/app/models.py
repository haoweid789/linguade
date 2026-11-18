"""数据层：SQLAlchemy async engine + ORM 模型
表结构对应前端学习档案：用户 / 词库 / 作答流水 / 错题本 / 学习会话"""
from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer,
                        String, Text, func)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .config import settings

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    open_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)  # 前端生成的设备标识
    name: Mapped[str] = mapped_column(String(64), default="学习者")
    exam: Mapped[str] = mapped_column(String(16), default="TestDaF")
    level: Mapped[str] = mapped_column(String(8), default="B1")
    daily_min: Mapped[int] = mapped_column(Integer, default=30)
    ability: Mapped[dict] = mapped_column(JSON, default=dict)      # 六维能力画像
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Word(Base):
    """题库：A1–B1 德语词汇（含例句），由 scripts/import_lexicon.py 从前端 JSON 导入"""
    __tablename__ = "words"
    id: Mapped[int] = mapped_column(primary_key=True)
    de: Mapped[str] = mapped_column(String(64), index=True)
    art: Mapped[str] = mapped_column(String(8), default="-")
    zh: Mapped[str] = mapped_column(String(128))
    pos: Mapped[str] = mapped_column(String(12), default="n")
    level: Mapped[str] = mapped_column(String(4), index=True)      # A1/A2/B1/B2
    example: Mapped[str] = mapped_column(Text, default="")
    example_zh: Mapped[str] = mapped_column(Text, default="")


class AnswerLog(Base):
    """逐题作答流水：驱动自适应引擎与学情分析"""
    __tablename__ = "answer_logs"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    module: Mapped[str] = mapped_column(String(24))                # vocab/grammar/chat/speech/interview...
    item: Mapped[str] = mapped_column(String(128), default="")
    ok: Mapped[bool] = mapped_column(Boolean)
    ms: Mapped[int] = mapped_column(Integer, default=0)            # 作答耗时
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)


class WrongItem(Base):
    __tablename__ = "wrong_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    module: Mapped[str] = mapped_column(String(24))
    type: Mapped[str] = mapped_column(String(24), default="综合")
    wrong: Mapped[str] = mapped_column(Text)
    right: Mapped[str] = mapped_column(Text, default="")
    why: Mapped[str] = mapped_column(Text, default="")
    times: Mapped[int] = mapped_column(Integer, default=0)
    mastered: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class StudySession(Base):
    __tablename__ = "study_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    module: Mapped[str] = mapped_column(String(24))
    ms: Mapped[int] = mapped_column(Integer, default=0)
    count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class SyncSnapshot(Base):
    """云端学习快照：每设备一份，POST /api/sync upsert，GET /api/sync 拉取恢复"""
    __tablename__ = "sync_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    open_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


class Account(Base):
    """站点账号：登录凭证 + 稳定的 open_id（换设备也能接回原学习数据）"""
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    open_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # 入学诊断是否已完成：以服务端为准，避免换浏览器/换账号跳过测试
    diagnosed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuthSession(Base):
    """登录会话：随机 token 存库，通过 HttpOnly Cookie 下发，过期自动失效"""
    __tablename__ = "sessions"
    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AppSetting(Base):
    """站点级配置（管理员面板写入），启动时覆盖 config.settings 单例"""
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(48), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())


def _migrate(conn):
    """轻量迁移：create_all 不会给已有表补列，这里只为 accounts.diagnosed 补一次"""
    try:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(accounts)")}
        if cols and "diagnosed" not in cols:
            conn.exec_driver_sql("ALTER TABLE accounts ADD COLUMN diagnosed BOOLEAN DEFAULT 0")
    except Exception:
        try:
            conn.exec_driver_sql("ALTER TABLE accounts ADD COLUMN IF NOT EXISTS diagnosed BOOLEAN DEFAULT FALSE")
        except Exception:
            pass


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_migrate)
