"""知识追踪（KT）适配层（3.7.0 · 后端可选通道）

通道（环境变量 LINGUADE_KT_CHANNEL）：
  bkt  —— 默认。服务端 BKT 四参数在线更新，参数与前端 engine.js **完全同口径**
          （pInit=0.18 / pTransit=0.16 / pSlip=0.09 / pGuess=0.22）；无模型、无网络。
  dkt  —— 可选。转发到深度知识追踪推理服务（DKT / SAINT+ / AKT 等序列模型）；
          服务不可用或样本不足即回落 bkt。
  off  —— 关闭（返回 501，前端走本地 BKT）。

架构说明：深度模型推理由独立服务承载（本项目后端**不引入 torch 依赖**）；
          前端离线形态始终使用本地 BKT，本通道仅用于「已配后端」时的增强与对照。
"""
import json
import urllib.request

from fastapi import APIRouter, HTTPException

from .config import settings

router = APIRouter(prefix="/api/ai/kt", tags=["kt"])

# 与 src/engine.js 的 BKT 常量保持一字不差
BKT = {"pInit": 0.18, "pTransit": 0.16, "pSlip": 0.09, "pGuess": 0.22}


def bkt_update(p, ok):
    """一次作答后的掌握概率更新（先验 → 后验 → 学习转移）"""
    pSlip, pGuess, pTransit = BKT["pSlip"], BKT["pGuess"], BKT["pTransit"]
    if ok:
        num = p * (1 - pSlip)
        p = num / (num + (1 - p) * pGuess)
    else:
        num = p * pSlip
        p = num / (num + (1 - p) * (1 - pGuess))
    return p + (1 - p) * pTransit


def bkt_predict(history, skill=None):
    """按作答序列推演掌握概率与下一次预测正确率"""
    p = BKT["pInit"]
    for h in history or []:
        p = bkt_update(p, bool(h.get("ok")))
    predict = p * (1 - BKT["pSlip"]) + (1 - p) * BKT["pGuess"]
    return {"skill": skill or "", "n": len(history or []),
            "mastery": round(p * 100), "predict": round(predict * 100),
            "channel": "bkt", "source": "bkt-inline",
            "params": BKT}


def _dkt(history, skill):
    """转发到外部 KT 服务：POST {base}/predict body={skill,history} → 同构 JSON"""
    req = urllib.request.Request(
        settings.kt_base_url.rstrip("/") + "/predict",
        data=json.dumps({"skill": skill, "history": history or []}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=settings.kt_timeout) as r:  # noqa: S310
        return json.loads(r.read().decode("utf-8"))


def channel_status():
    ch = (settings.kt_channel or "bkt").lower()
    external_ready = bool(settings.kt_base_url)
    return {"channel": ch, "external_ready": external_ready,
            "effective": "dkt" if (ch == "dkt" and external_ready) else ("off" if ch == "off" else "bkt")}


def predict(history, skill=None):
    st = channel_status()
    if st["effective"] == "off":
        raise RuntimeError("知识追踪通道已关闭（LINGUADE_KT_CHANNEL=off）")
    if st["effective"] == "dkt":
        try:
            out = _dkt(history, skill)
            out["channel"] = "dkt"
            out["source"] = "external-service"
            return out
        except Exception as e:  # noqa: BLE001  外部服务失败一律回落 BKT
            fb = bkt_predict(history, skill)
            fb["source"] = "fallback"
            fb["message"] = "深度 KT 服务不可用，已回落 BKT：%s" % e
            return fb
    return bkt_predict(history, skill)


@router.post("/predict")
async def kt_predict(payload: dict):
    """知识追踪预测：{ skill, history:[{ok}] } → { mastery, predict, channel }"""
    skill = str(payload.get("skill") or "")
    hist = payload.get("history") or []
    if len(str(payload.get("open_id") or "")) < 6:
        raise HTTPException(422, "open_id 为必填（设备标识，>=6 字符）")
    if not skill.strip():
        raise HTTPException(422, "skill 为必填")
    if not isinstance(hist, list):
        raise HTTPException(422, "history 必须是数组")
    for h in hist:
        if not isinstance(h, dict) or "ok" not in h:
            raise HTTPException(422, "history 每项须含 ok 字段")
    try:
        import asyncio
        return await asyncio.to_thread(predict, hist, skill)
    except RuntimeError as e:
        raise HTTPException(501, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, "知识追踪预测失败：%s" % e)