"""视觉 OCR / 智能批改适配层（路线 A：多模态 LLM 一体化）

一次调用同时完成「图像转录 + 批改」，避免维护「转录服务 + 批改服务」两套依赖：
  - grammar ：手写/打印德语句子 → 转录 → 语法错误定位与中文讲解
  - exercise：练习册/作业照片   → 转录 → 对错判定与讲解
  - essay   ：作文照片           → 转录 → 四维评分与升格建议

设计要点（对应 docs/ocr-research.md 第 7 节）：
  1. 与现有三层降级同构：本文件是 L1（后端）；L2 为浏览器直连视觉模型；L3 为本地提示（手写体明确告知需 AI 通道）。
  2. 零训练、零新推理依赖：只走 OpenAI 兼容 /chat/completions 的 image_url，不往 2C4G 的 ECS 上塞 PyTorch。
  3. 防幻觉：prompt 强制 confidence 字段 + 无法辨认处标记 [难以辨认]，并要求回传 transcript 供用户校对。
  4. 隐私：图像仅在用户主动提交时进入内存，处理完即丢弃，不落盘；同图同模式结果走缓存。

可扩展点（路线 C，比赛叙事）：在 grade() 入口前插入华为云 OCR（RecognizeHandwriting）先转录，
再以纯文本调用 LLM 批改；对印刷体练习册效果通常更稳。
"""
import base64
import hashlib
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from . import cache, hwcloud, llm
from .config import settings

router = APIRouter(prefix="/api/ocr", tags=["ocr"])

MAX_BYTES = 6 * 1024 * 1024          # 6MB 兜底上限（前端已压缩）
ALLOWED_PREFIX = "image/"

SYS_PROMPTS = {
    "grammar": (
        "你是德语语法批改专家。用户上传的是手写或打印的德语文本照片。\n"
        "任务：1) 逐字转录图片中的德语原文；2) 找出语法/拼写/标点错误，给出修改与中文讲解。\n"
        "只输出 JSON（不要任何解释文字）：\n"
        '{"transcript":"识别出的德语原文","confidence":0.0-1.0,'
        '"corrections":[{"orig":"原文片段","fixed":"修改后片段","type":"错误类型","explain":"中文讲解(<=40字)"}],'
        '"comments":"整体点评(中文)","suggestions":["改进建议(中文)"]}\n'
        "若某处无法辨认，请在 transcript 中用 [难以辨认] 标记并降低 confidence，切勿凭空补全。"
    ),
    "exercise": (
        "你是德语练习批改老师。用户上传的是练习册/作业照片（可能同时含题目与手写作答）。\n"
        "任务：1) 转录题目与作答；2) 判定作答对错；3) 给出正确答案与中文讲解。\n"
        "只输出 JSON：\n"
        '{"transcript":"题目与作答的完整转录","confidence":0.0-1.0,'
        '"items":[{"question":"题目","answer":"用户作答","verdict":"正确|部分正确|错误",'
        '"correct":"正确答案","explain":"中文讲解"}],'
        '"score":{"overall":0-100},"comments":"中文总评","suggestions":["改进建议"]}\n'
        "无法辨认处用 [难以辨认] 标记，不要猜测。"
    ),
    "essay": (
        "你是 Telc/TestDaF 德语写作阅卷专家。用户上传的是手写作文照片。\n"
        "任务：1) 逐句转录作文；2) 按四维评分并给出逐句批注与升格建议。\n"
        "只输出 JSON：\n"
        '{"transcript":"作文全文转录","confidence":0.0-1.0,'
        '"score":{"overall":0-100,"task":0-100,"coherence":0-100,"vocab":0-100,"grammar":0-100},'
        '"corrections":[{"orig":"原文片段","fixed":"修改后片段","type":"错误类型","explain":"中文讲解"}],'
        '"comments":"中文总评","suggestions":["升格建议"],"sample":"针对本题的德语示范段落"}\n'
        "无法辨认处用 [难以辨认] 标记，不要编造内容。"
    ),
}

MODE_NAMES = {"grammar": "语法纠错", "exercise": "练习批改", "essay": "写作批改"}


def _safe_json(txt: str):
    """剥离 ``` 包裹并截取首个 JSON 对象（与 ai.py 同策略）"""
    if not txt:
        return None
    s = txt.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    start = s.find("{")
    if start < 0:
        return None
    end = s.rfind("}")
    if end <= start:
        return None
    try:
        return json.loads(s[start:end + 1])
    except json.JSONDecodeError:
        return None


async def _grade_text(text: str, mode: str, meta: dict | None) -> dict:
    """华为云 OCR 已转录：纯文本交给大模型批改。"""
    user_text = "请批改下面的德语文本。"
    if meta:
        if meta.get("hint"):
            user_text += " 参考信息：" + str(meta["hint"])[:200] + "。"
        if meta.get("level"):
            user_text += " 学习者水平：%s。" % str(meta["level"])[:16]
    messages = [
        {"role": "system", "content": SYS_PROMPTS[mode] +
         "\n你收到的是 OCR 转录文本（可能有识别错误），只批改文本，不要臆造图片内容。"},
        {"role": "user", "content": user_text + "\n\n文本：\n" + text},
    ]
    txt = await llm.chat(messages, temperature=0.2)
    parsed = _safe_json(txt)
    if not isinstance(parsed, dict):
        raise RuntimeError("模型未返回可解析的 JSON")
    parsed["transcript"] = text
    parsed["mode"] = mode
    parsed["source"] = "huawei-ocr+llm"
    return parsed


async def grade(image_bytes: bytes, mime: str, mode: str = "grammar", meta: dict | None = None) -> dict:
    """图像 → 转录 + 批改（结构化 JSON）"""
    if not settings.llm_base_url or not settings.llm_api_key:
        raise RuntimeError("未配置视觉大模型：请设置 LINGUADE_LLM_BASE_URL / LINGUADE_LLM_API_KEY（需支持图片输入）")
    if len(image_bytes) > MAX_BYTES:
        raise RuntimeError("图片过大（%d KB），请压缩后重试" % (len(image_bytes) // 1024))

    mode = mode if mode in SYS_PROMPTS else "grammar"
    if mime in ("image/jpg", ""):
        mime = "image/jpeg"

    cache_key = "ocr:" + hashlib.sha1(image_bytes).hexdigest()[:16] + ":" + mode
    hit = await cache.get(cache_key)
    if hit is not None:
        out = dict(hit)
        out["cached"] = True
        return out

    ocr_note = ""
    if hwcloud.ocr_ready():
        try:
            hw = await hwcloud.recognize_handwriting(image_bytes)
            if hw.get("text", "").strip():
                parsed = await _grade_text(hw["text"], mode, meta)
                parsed.setdefault("confidence", hw.get("confidence"))
                parsed["ocr"] = {"channel": "huawei", "confidence": hw.get("confidence")}
                await cache.set(cache_key, parsed, ttl=86400)
                return parsed
            ocr_note = "华为云 OCR 未识别到文字"
        except Exception as e:  # OCR 故障不阻塞批改，回落视觉大模型
            ocr_note = "华为云 OCR 失败：%s" % e

    data_url = "data:%s;base64,%s" % (mime, base64.b64encode(image_bytes).decode())
    user_text = "请按系统要求处理这张德语图片。"
    if meta:
        if meta.get("hint"):
            user_text += " 参考信息：" + str(meta["hint"])[:200] + "。"
        if meta.get("level"):
            user_text += " 学习者水平：%s。" % str(meta["level"])[:16]

    messages = [
        {"role": "system", "content": SYS_PROMPTS[mode]},
        {"role": "user", "content": [
            {"type": "text", "text": user_text},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]},
    ]

    txt = await llm.chat(messages, temperature=0.2)
    parsed = _safe_json(txt)
    if not isinstance(parsed, dict):
        raise RuntimeError("模型未返回可解析的 JSON")
    parsed["mode"] = mode
    parsed["source"] = "vision-llm"
    if ocr_note:
        parsed["ocr"] = {"channel": "vision-llm", "note": ocr_note}
    parsed.setdefault("confidence", None)
    await cache.set(cache_key, parsed, ttl=86400)
    return parsed


@router.post("/grade")
async def ocr_grade(file: UploadFile = File(...), mode: str = Form("grammar"), meta: str = Form("{}")):
    """拍照/上传 → 识别转录 → 语法纠错 / 练习批改 / 写作批改"""
    data = await file.read()
    mime = file.content_type or "image/png"
    if not mime.startswith(ALLOWED_PREFIX):
        raise HTTPException(415, "不支持的图片类型：%s" % mime)
    try:
        m = json.loads(meta) if meta else {}
    except json.JSONDecodeError:
        m = {}
    try:
        return await grade(data, mime, mode, m)
    except RuntimeError as e:
        raise HTTPException(501, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, "识别/批改失败：%s" % e)