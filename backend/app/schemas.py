"""Pydantic 请求 / 响应模型"""
from typing import Optional

from pydantic import BaseModel, Field


class SyncPayload(BaseModel):
    open_id: str = Field(min_length=6, max_length=64)
    profile: dict = {}
    ability: dict = {}
    log: list[dict] = []
    snapshot: dict = {}   # 全量学习快照（前端剔除凭据后上传，供跨设备恢复）


class ChatTurn(BaseModel):
    open_id: str
    scene_id: str = "aps"
    history: list[dict] = []
    text: str = Field(min_length=1, max_length=2000)
    persona: str = ""            # 对话室人设：strict / buddy / slow / travel（可选）


class TranslateReq(BaseModel):
    text: str = Field(min_length=1, max_length=500)


class CorrectReq(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class AnswerIn(BaseModel):
    open_id: str
    module: str
    item: str = ""
    ok: bool
    ms: int = 0
    detail: dict = {}


class InterviewEvalReq(BaseModel):
    open_id: str
    items: list[dict]  # [{q, a}]


class PhonemeAssessReq(BaseModel):
    """音素级发音评估（3.7.0 可选通道）：默认 rule，配好后走 acoustic"""
    open_id: str = Field(min_length=6, max_length=64)
    ref: str = Field(min_length=1, max_length=2000)
    hyp: str = Field(min_length=1, max_length=2000)
    meta: dict = {}


class KTPredictReq(BaseModel):
    """知识追踪预测（3.7.0 可选通道）：默认 bkt，配好后走 dkt"""
    open_id: str = Field(min_length=6, max_length=64)
    skill: str = Field(min_length=1, max_length=120)
    history: list[dict] = []   # [{ok: bool}, ...]


# ---------- B5 AI 练习契约（aiPractice 5 端点，对齐小站 aiPractice） ----------

class InitialAssessmentIn(BaseModel):
    seed: int = 0
    count: int = Field(default=5, ge=1, le=20)


class RecommendIn(BaseModel):
    weakPoints: list[dict] = []          # [{key, acc, total}]（前端 Engine.weakPoints 摘要）
    count: int = Field(default=10, ge=1, le=40)


class PracticeItemIn(BaseModel):
    id: str
    type: str                            # B3 注册表题型 id
    answer: str = ""                     # 客观题作答（选项文本）
    text: str = ""                       # 主观题作答（write_sentence）
    ms: int = 0


class SaveIn(BaseModel):
    sessionId: str
    items: list[PracticeItemIn] = []


class ReportIn(BaseModel):
    sessionId: str
