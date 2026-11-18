"""AI 相关路由：语法纠错 / 场景对话 / 语音转写 / 面试评估
全部支持「无 LLM 配置」时返回 501 + 明确提示，由前端本地规则引擎兜底。"""
import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from . import cache, llm, asr
from .auth import get_db
from .config import settings
from .schemas import (ChatTurn, CorrectReq, InterviewEvalReq, TranslateReq,
                      InitialAssessmentIn, RecommendIn, SaveIn, ReportIn)
from .security import account_from_request, accounts_exist, consume_ai_quota


async def ai_quota_guard(request: Request, db: AsyncSession = Depends(get_db)):
    if not await accounts_exist(db):
        return None
    acc = await account_from_request(request, db)
    if not acc:
        raise HTTPException(401, "请先登录")
    allowed, message = consume_ai_quota(acc.open_id, settings.ai_daily_limit, settings.ai_minute_limit)
    if not allowed:
        raise HTTPException(429, message)
    return acc


router = APIRouter(prefix="/api/ai", tags=["ai"], dependencies=[Depends(ai_quota_guard)])


@router.post("/ping")
async def ping():
    """兼容已缓存前端与外部巡检：真实调用一次模型，不返回密钥。"""
    return await llm.test_connection()


@router.post("/correct")
async def correct(req: CorrectReq):
    """德语句法纠错：LLM 为主、规则为辅的其中「主」通道"""
    if not settings.llm_base_url:
        return JSONResponse({"source": "none", "issues": [],
                             "message": "后端未配置大模型，前端将使用本地规则引擎"})
    key = "corr:" + hashlib.sha1(req.text.encode()).hexdigest()[:16]
    hit = await cache.get(key)
    if hit is not None:
        return hit
    try:
        txt = await llm.chat(llm.grammar_prompt(req.text), temperature=0.2)
        issues = _safe_json(txt)
        out = {"source": "llm", "issues": issues if isinstance(issues, list) else []}
        await cache.set(key, out, 3600)
        return out
    except Exception as e:  # LLM 故障时降级
        return JSONResponse({"source": "fallback", "issues": [], "message": str(e)},
                            status_code=200)


@router.post("/translate")
async def translate(req: TranslateReq):
    """对话室中文输入：中文 → 自然德语。无模型时明确 501，由前端提示，不伪造译文。"""
    if not settings.llm_base_url:
        raise HTTPException(501, "后端未配置大模型，中文翻译不可用；请在前端配置直连大模型")
    key = "tr:" + hashlib.sha1(req.text.encode()).hexdigest()[:16]
    hit = await cache.get(key)
    if hit is not None:
        return hit
    sys_prompt = ("你是面向中国德语学习者的翻译引擎。把用户的中文翻译成自然、口语化的德语，"
                  "只输出德语译文，不要解释、不要加引号或代码块。若原文已是德语则原样返回；不要编造原文没有的信息。")
    try:
        txt = await llm.chat([{"role": "system", "content": sys_prompt},
                              {"role": "user", "content": req.text}], temperature=0.2)
        out = {"text": (txt or "").strip()}
        if not out["text"]:
            raise RuntimeError("模型未返回译文")
        await cache.set(key, out, 86400)
        return out
    except Exception as e:
        raise HTTPException(502, f"翻译失败：{e}")


@router.post("/chat")
async def chat(turn: ChatTurn):
    if not settings.llm_base_url:
        raise HTTPException(501, "后端未配置大模型，请在前端使用本地对话引擎")
    sys_prompt = _compose_prompt(turn.scene_id, turn.persona)
    messages = [{"role": "system", "content": sys_prompt}] + turn.history[-8:] + \
               [{"role": "user", "content": turn.text}]
    try:
        txt = await llm.chat(messages, temperature=0.8,
                             cache_key=None)
        return {"reply": txt}
    except Exception as e:
        raise HTTPException(502, f"大模型调用失败：{e}")


@router.post("/chat/stream")
async def chat_stream(turn: ChatTurn):
    """场景对话（SSE 流式）：逐块返回 {"delta": "..."}，以 [DONE] 结束"""
    if not settings.llm_base_url:
        raise HTTPException(501, "后端未配置大模型，请在前端使用本地对话引擎")
    sys_prompt = _compose_prompt(turn.scene_id, turn.persona)
    messages = [{"role": "system", "content": sys_prompt}] + turn.history[-8:] + \
               [{"role": "user", "content": turn.text}]

    async def gen():
        try:
            async for chunk in llm.chat_stream(messages, temperature=0.8):
                yield "data: " + json.dumps({"delta": chunk}, ensure_ascii=False) + "\n\n"
        except Exception as e:  # 流中断时把错误也作为一条事件送出，前端据此降级
            yield "data: " + json.dumps({"error": str(e)}, ensure_ascii=False) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.post("/speech/transcribe")
async def speech_transcribe(file: UploadFile = File(...)):
    """Whisper 转写（昇腾部署）。返回文本后由前端完成三维评分。"""
    data = await file.read()
    try:
        out = await asr.transcribe(data, fmt=(file.filename or "a.webm").split(".")[-1])
        return out
    except RuntimeError as e:
        raise HTTPException(501, str(e))


@router.post("/interview/evaluate")
async def interview_evaluate(req: InterviewEvalReq):
    if not settings.llm_base_url:
        raise HTTPException(501, "后端未配置大模型，请在前端使用本地评估引擎")
    sys_prompt = (
        "你是 APS 审核与德国高校面试评估专家。依据问答记录输出严格 JSON："
        '{"total":0-100,"vocab":分数,"grammar":分数,"logic":分数,"delivery":分数,'
        '"strengths":["中文短语"],"risks":["中文短语"],"advice":["中文建议"],'
        '"rewrite":"针对最弱一题的德语改写示范"}，不要输出 JSON 以外内容。')
    body = "\n\n".join(f"Q{i+1}: {it.get('q','')}\nA{i+1}: {it.get('a','')}"
                       for i, it in enumerate(req.items))
    try:
        txt = await llm.chat([{"role": "system", "content": sys_prompt},
                              {"role": "user", "content": body}], temperature=0.3)
        parsed = _safe_json(txt)
        return parsed if isinstance(parsed, dict) else {"total": 0}
    except Exception as e:
        raise HTTPException(502, f"评估失败：{e}")


def _safe_json(txt: str):
    s = txt.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    l, b = s.find("["), s.find("{")
    start = l if (l >= 0 and (b < 0 or l < b)) else b
    if start < 0:
        return None
    open_c = s[start]
    close_c = "]" if open_c == "[" else "}"
    end = s.rfind(close_c)
    try:
        return json.loads(s[start:end + 1])
    except json.JSONDecodeError:
        return None


SCENE_PROMPTS = {
    "aps": "你是德国 APS 审核官，用德语向中国理工科学生提问。每次只问一个问题，难度 B1；对学生回答中的语法错误，先给出正确说法再用中文解释。回答格式：德语回复 --- 中文点评。",
    "zulassung": "你是德国大学语言中心教师，用德语进行入学口试（A2–B1），语速慢、句子短，并温和纠正学生的语法错误。格式：德语回复 --- 中文点评。",
    "uni": "你是大学秘书处工作人员，用语正式（Sie），帮助学生办理注册、选课与考试咨询。格式：德语回复 --- 中文点评。",
    "wohnung": "你是德国房东，用日常德语介绍房源、谈租金与合同。格式：德语回复 --- 中文点评。",
    "campus": "你是德国大学生，用非正式德语（du）与新同学聊天，口语化。格式：德语回复 --- 中文点评。",
}

# 对话室人设：与前端 src/modules/chat.js 的 PERSONAS 一一对应，作为场景提示词的风格叠加
PERSONA_PROMPTS = {
    "strict": "人设：严谨外教。用 Sie 正式称呼，语法有错先纠正再继续，每次只问一个问题，难度 B1–B2。",
    "buddy": "人设：日常语伴。用 du 非正式称呼，像朋友一样闲聊，句子短、口语化，顺便温和指出明显错误。",
    "slow": "人设：慢速入门。只用 A1–A2 的短句，一次一个信息点，语速慢；先给正确说法，再用中文解释关键词。",
    "travel": "人设：旅行德语。围绕问路、点餐、住宿、交通等真实旅行情境，给出可直接使用的实用表达。",
}


def _compose_prompt(scene_id: str, persona: str = "") -> str:
    base = SCENE_PROMPTS.get(scene_id, SCENE_PROMPTS["aps"])
    extra = PERSONA_PROMPTS.get((persona or "").strip(), "")
    return base + ("\n" + extra if extra else "")


# ---------- B5 AI 练习契约（aiPractice 5 端点） ----------
# 契约对齐小站 aiPractice：initial-assessment → recommend → session(前端组装) → save → report。
# 服务端只组「考点清单」（skill 键 + 题型 id）；题目内容由前端按 skill 从词库取。
# 题型注册表镜像（与 src/core/exercise.js 交叉引用；改一处需同步另一处）：
#   select_genus/conjugate/select_case/translate_de_zh/translate_zh_de/listen_choice/
#   listen_gap/listen_full/listen_dialog/speak_repeat/speak_shadow/word_recall/
#   match_pairs/spell_word/read_cloze/read_comprehension/write_sentence/char_trace/
#   article_table/quick_quiz

SKILL_POOL = {
    "assessment": ["v:Haus", "v:Zeit", "art:der", "verb:sein", "prep:in", "gender:Kind", "v:Arbeit", "v:Jahr"],
    "vocab": ["v:{w}"], "grammar": ["art:{w}", "verb:{w}", "prep:{w}", "gender:{w}"],
    "listening": ["hear:{w}"], "mixed": ["v:{w}", "art:{w}", "hear:{w}"],
}


def _draw_skills(kind: str, count: int, seed: int, weak: list[dict]) -> list[dict]:
    """确定性抽考点：assessment 按 seed 轮转；recommend 按弱点 acc 升序。"""
    items = []
    if kind == "recommend" and weak:
        ranked = sorted(weak, key=lambda x: float(x.get("acc", 100)))[:count]
        for w in ranked:
            items.append({"skill": w.get("key", ""), "type": "word_recall", "acc": w.get("acc", 0)})
        return items
    pool = SKILL_POOL.get(kind, SKILL_POOL["assessment"])
    for i in range(count):
        items.append({"skill": pool[(seed + i) % len(pool)], "type": "word_recall", "acc": None})
    return items


@router.post("/practice/initial-assessment")
async def initial_assessment(req: InitialAssessmentIn):
    """诊断出题：返回考点清单（确定性 mock；配置 LLM 不改变此端点形状）。"""
    return {"source": "mock", "seed": req.seed,
            "items": _draw_skills("assessment", req.count, req.seed, [])}


@router.post("/practice/recommend")
async def recommend(req: RecommendIn):
    """弱点推荐：按 acc 升序取考点。"""
    return {"source": "mock",
            "items": _draw_skills("recommend", req.count, 0, req.weakPoints)}


@router.post("/practice/save")
async def save(req: SaveIn):
    """作答保存 + 客观题判分（前端传 items 含正确答案由前端判；此处只汇总统计与降级标记）。"""
    total = len(req.items)
    graded = sum(1 for it in req.items if it.answer)
    subjective = [it.id for it in req.items if it.type == "write_sentence"]
    out = {"sessionId": req.sessionId, "total": total, "answered": graded,
           "subjective": subjective, "graded": graded > 0}
    if subjective and not settings.llm_base_url:
        out["llmGrade"] = {"graded": False, "reason": "no-llm"}
    return out


@router.post("/practice/report")
async def report(req: ReportIn):
    """报告：模板化汇总（无 LLM 也返回基础统计结构；LLM 增强留下一批次）。"""
    return {"sessionId": req.sessionId, "template": True,
            "sections": ["accuracy", "speed", "weakness-update"],
            "advice": "基于本次作答的模板化建议（LLM 增强通道未配置）" if not settings.llm_base_url else "LLM 报告通道就绪"}
