"""音素级发音评估适配层（3.7.0 · 后端可选通道）

定位：把「声学级音素评估」做成**可插拔通道**——默认走零依赖的规则通道；
配好外部声学服务后一键切换；不可用即回落，绝不阻塞主流程。

通道（环境变量 LINGUADE_PHONEME_CHANNEL）：
  rule     —— 默认。服务端规则式 G2P（与前端 src/phonetics.js 同一套规则）+
              音素序列 Levenshtein 对齐 + 最小对立对提示。无模型、无网络。
  acoustic —— 可选。转发到外部音素/发音评估推理服务（搭载 GOP 或音素识别模型），
              返回逐音素置信度与错音定位；未配置或调用失败即回落 rule。
  off      —— 关闭（调用返回 501，前端走本地规则）。

架构说明：本模块**不加载任何声学模型**（保持后端镜像轻量、零 PyTorch 依赖）；
          声学推理由独立服务承载（本项目不内置），符合「离线单文件 + 后端可选」的红线。
"""
import json
import urllib.request

from fastapi import APIRouter, HTTPException

from .config import settings

router = APIRouter(prefix="/api/ai/phoneme", tags=["phoneme"])

# ---------------------------------------------------------------- 规则式 G2P
# 与前端 src/phonetics.js 保持同一套规则（最长匹配优先）
RULES = [
    ("sch", "ʃ"), ("tsc", "tʃ"), ("tion", "tsioːn"),
    ("eu", "ɔʏ"), ("äu", "ɔʏ"), ("ei", "aɪ"), ("ai", "aɪ"), ("au", "aʊ"),
    ("aa", "aː"), ("ee", "eː"), ("oo", "oː"), ("ie", "iː"),
    ("ah", "aː"), ("eh", "eː"), ("oh", "oː"), ("uh", "uː"), ("ih", "iː"),
    ("äh", "ɛː"), ("öh", "øː"), ("üh", "yː"),
    ("sp", "ʃp"), ("st", "ʃt"), ("ch", "ç"), ("ck", "k"), ("ph", "f"),
    ("th", "t"), ("tz", "ts"), ("ts", "ts"), ("ng", "ŋ"), ("nk", "ŋk"),
    ("qu", "kv"), ("pf", "pf"),
    ("a", "a"), ("e", "ɛ"), ("i", "ɪ"), ("o", "ɔ"), ("u", "ʊ"), ("y", "ʏ"),
    ("ä", "ɛ"), ("ö", "œ"), ("ü", "ʏ"),
    ("b", "b"), ("c", "k"), ("d", "d"), ("f", "f"), ("g", "ɡ"), ("h", ""),
    ("j", "j"), ("k", "k"), ("l", "l"), ("m", "m"), ("n", "n"), ("p", "p"),
    ("r", "ʁ"), ("s", "z"), ("t", "t"), ("v", "f"), ("w", "v"), ("x", "ks"),
    ("z", "ts"), ("ß", "s"),
]

# L2 德语高频最小对立对（键为两音素排序后拼接）
PAIRS = {
    "uː|yː": "ü 是「圆唇前元音」：舌位像发 i，但嘴唇要收圆——常见把它读成 u。",
    "ʊ|ʏ": "ü 短音 [ʏ] 与 u 短音 [ʊ] 混淆：先把舌头往前抬，再保持圆唇。",
    "oː|øː": "ö 是「圆唇前元音」：舌位像 e，嘴唇收圆。",
    "ɔ|œ": "ö 短音 [œ] 与 o 短音 [ɔ] 混淆：舌位更靠前。",
    "eː|ɛː": "长 ä [ɛː] 与长 e [eː] 常混：ä 开口更大、舌位更低。",
    "ç|ʃ": "ch 在 i/e/ä/ö/ü 后读软音 [ç]（近「希」），不是 [ʃ]（「施」）。",
    "ç|x": "ch 有两个音：a/o/u/au 后读 [x]（近「喝」），其余读 [ç]。",
    "s|ʃ": "s 词首元音前读浊音 [z]，sch 才读 [ʃ]。",
    "s|z": "德语词首 s（接元音）读浊音 [z]，如 Sohn。",
    "ts|s": "德语 z 读 [ts]（如 Zeit），不读 [s]。",
    "f|v": "德语 v 多读 [f]（如 Vater），外来词才读 [v]。",
    "k|ɡ": "g 词尾会「清化」读 [k]（如 Tag）。",
    "t|d": "d 词尾清化为 [t]（如 Kind）。",
    "n|ŋ": "ng 读鼻音 [ŋ]（如 singen），不发 [n]+[ɡ]。",
    "aɪ|iː": "ei 读 [aɪ]、ie 读 [iː]——两者最常被读反（mein ≠ Miene）。",
    "ʁ|ɐ": "词尾 -er 弱化为 [ɐ]（近「阿」），不是清晰的 [ʁ]。",
}
DERIV_SKIP = ("h",)


def _post_fix(phones, word):
    """德语特例修正：ch 双音位、词尾弱化、词首浊化"""
    out = list(phones)
    for i, p in enumerate(out):
        if p == "ç":
            before = out[i - 1] if i else ""
            if before in ("a", "ɔ", "ʊ") or before == "aʊ":
                out[i] = "x"
    if word.endswith("er") and len(out) >= 2 and out[-1] == "ʁ":
        out[-1] = "ɐ"
    if word.endswith("ig") and out and out[-1] == "k":
        out[-1] = "ç"
    if word.endswith("en") and out and out[-1] == "n":
        out.insert(len(out) - 1, "ə")
    if word.endswith("e") and out and out[-1] == "ɛ":
        out[-1] = "ə"
    if word.startswith("s") and out and out[0] == "z" and not (len(word) > 1 and word[1] in "aeiouäöü"):
        out[0] = "s"
    return [p for p in out if p]


def word_phones(word):
    s = "".join(c for c in (word or "").lower() if c.isalpha() or c in "äöüß")
    out, i = [], 0
    while i < len(s):
        hit = None
        for g, p in RULES:
            if s.startswith(g, i):
                hit = (g, p)
                break
        if hit:
            if hit[1]:
                out.append(hit[1])
            i += len(hit[0])
        else:
            out.append(s[i])
            i += 1
    return _post_fix(out, s)


def to_phones(text):
    """文本 → 音素序列（" " 作为词边界标记，便于对齐时不跨词错配）"""
    cleaned = []
    for ch in (text or "").lower():
        cleaned.append(" " if ch in ".,!?;:\"„“”()" else ch)
    words = "".join(cleaned).split()
    seq = []
    for k, w in enumerate(words):
        if k:
            seq.append(" ")
        seq.extend(word_phones(w))
    return seq


def _align(a, b):
    m, n = len(a), len(b)
    d = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(m + 1):
        d[i][0] = i
    for j in range(n + 1):
        d[0][j] = j
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                          d[i - 1][j - 1] + (0 if a[i - 1] == b[j - 1] else 1))
    ops, i, j = [], m, n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and a[i - 1] == b[j - 1] and d[i][j] == d[i - 1][j - 1]:
            ops.append({"op": "match", "t": a[i - 1], "a": b[j - 1]}); i -= 1; j -= 1
        elif i > 0 and j > 0 and d[i][j] == d[i - 1][j - 1] + 1:
            ops.append({"op": "sub", "t": a[i - 1], "a": b[j - 1]}); i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i - 1][j] + 1:
            ops.append({"op": "del", "t": a[i - 1], "a": ""}); i -= 1
        else:
            ops.append({"op": "ins", "t": "", "a": b[j - 1]}); j -= 1
    return ops[::-1]


def _key(t, a):
    return "|".join(sorted([t, a]))


def compare(ref, hyp):
    """规则通道：参考/识别文本 → 音素级诊断（与前端 phonetics.js 同口径）"""
    a, b = to_phones(ref), to_phones(hyp)
    real = lambda x: x != " "
    n_ref = sum(1 for x in a if real(x))
    n_hyp = sum(1 for x in b if real(x))
    if not n_ref or not n_hyp:
        return None
    ops = _align(a, b)
    errs = [o for o in ops if o["op"] != "match" and (real(o["t"]) or real(o["a"]))]
    per = len(errs) / max(1, n_ref)

    seen, pairs = set(), []
    for o in errs:
        t = o["t"] if real(o["t"]) else "∅"
        aa = o["a"] if real(o["a"]) else "∅"
        k = t + ">" + aa
        if k in seen:
            continue
        seen.add(k)
        pairs.append({"t": t, "a": aa, "hint": PAIRS.get(_key(t, aa))})

    sounds = [{"t": o["t"], "a": o["a"],
               "st": "ok" if o["op"] == "match"
                     else ("warn" if PAIRS.get(_key(o["t"] if real(o["t"]) else "∅",
                                                  o["a"] if real(o["a"]) else "∅")) else "bad")}
              for o in ops if real(o["t"]) or real(o["a"])]

    advice = []
    for p in pairs[:3]:
        arrow = "漏读" if p["t"] == "∅" else ("未读出" if p["a"] == "∅" else "%s → %s" % (p["t"], p["a"]))
        advice.append("[%s] %s" % (arrow, p["hint"]) if p["hint"]
                      else "[%s] 该音素与标准发音不一致，放慢跟读比对。" % arrow)
    if not advice:
        advice.append("音素层面未发现明显错读，重点打磨连贯与语调。")

    return {"per": round(per * 100), "nRef": n_ref, "nErr": len(errs),
            "pairs": pairs, "sounds": sounds[:24], "advice": advice}


# ---------------------------------------------------------------- 声学通道
def _acoustic(ref, hyp, meta):
    """转发到外部声学评估服务：约定 POST {base}/assess  body={ref,hyp,meta} → 同构 JSON"""
    base = settings.phoneme_base_url.rstrip("/")
    req = urllib.request.Request(
        base + "/assess",
        data=json.dumps({"ref": ref, "hyp": hyp, "meta": meta or {}}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=settings.phoneme_timeout) as r:  # noqa: S310
        return json.loads(r.read().decode("utf-8"))


def channel_status():
    """当前音素通道状态（供 /api/health 与前端展示）"""
    ch = (settings.phoneme_channel or "rule").lower()
    external_ready = bool(settings.phoneme_base_url)
    return {"channel": ch, "external_ready": external_ready,
            "effective": "acoustic" if (ch == "acoustic" and external_ready) else ("off" if ch == "off" else "rule")}


def assess(ref, hyp, meta=None):
    st = channel_status()
    if st["effective"] == "off":
        raise RuntimeError("音素通道已关闭（LINGUADE_PHONEME_CHANNEL=off）")
    if st["effective"] == "acoustic":
        try:
            out = _acoustic(ref, hyp, meta)
            out["channel"] = "acoustic"
            out["source"] = "external-service"
            return out
        except Exception as e:  # noqa: BLE001  外部服务失败一律回落规则通道
            fallback = compare(ref, hyp) or {}
            fallback["channel"] = "rule"
            fallback["source"] = "fallback"
            fallback["message"] = "声学服务不可用，已回落规则通道：%s" % e
            return fallback
    out = compare(ref, hyp)
    if out is None:
        raise RuntimeError("未能从文本得到有效音素序列（ref/hyp 至少一方为空）")
    out["channel"] = "rule"
    out["source"] = "rule-g2p"
    return out


@router.post("/assess")
async def phoneme_assess(payload: dict):
    """音素级发音评估：{ ref, hyp, meta } → { per, pairs, sounds, advice, channel }"""
    ref = str(payload.get("ref") or "")
    hyp = str(payload.get("hyp") or "")
    if len(str(payload.get("open_id") or "")) < 6:
        raise HTTPException(422, "open_id 为必填（设备标识，>=6 字符）")
    if not ref.strip() or not hyp.strip():
        raise HTTPException(422, "ref 与 hyp 均为必填且不能为空")
    try:
        return await __import__("asyncio").to_thread(assess, ref, hyp, payload.get("meta") or {})
    except RuntimeError as e:
        raise HTTPException(501, str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, "音素评估失败：%s" % e)