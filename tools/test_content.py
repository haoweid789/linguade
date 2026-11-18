# -*- coding: utf-8 -*-
"""LinguaDE · 内容管线产物校验（3.5.0-d）

依据 docs/content-scaling-plan.md §四.5：内容管线单独加校验（schema + 授权字段非空 + 抽样回归），
避免「内容扩散了，但字段与授权悄悄坏掉」。

校验项：
  1) dist/content-pack-speech.json  —— pack/items schema；**有音频的条目必须带 audioLicense**（授权红线）
  1b) dist/content-pack-audio.json —— 真人录音包：逐条许可/署名 + 文件存在 + 内联 base64 与文件字节一致
  2) dist/content-pack-reading.json  —— pack/items schema；每篇含 id/paras/tfng/mcq/words；来源与授权非空
  3) src/data/lexicon-*.js           —— 词条格式统一（[de, art, zh, pos, lvl, ex, exzh]）且 zh 非空
  4) tools/lexicon_enrich.py --selftest —— 质检红线自检（zh 缺失/非法词性/例句不含词）

用法：python tools/test_content.py    （退出码 0 = 通过）
"""
import base64
import io
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPEECH = os.path.join(ROOT, "dist", "content-pack-speech.json")
READING = os.path.join(ROOT, "dist", "content-pack-reading.json")
AUDIO = os.path.join(ROOT, "dist", "content-pack-audio.json")
DATA_DIR = os.path.join(ROOT, "src", "data")


try:
    from lexicon_govern import (REGISTER_VULGAR, REGISTER_ENUM, register_for,
                                example_banned)
except Exception:                                    # 工具单独跑时兜底，红线不失效
    REGISTER_ENUM = ("", "vulgar", "colloquial")
    REGISTER_VULGAR = {
        "wichser", "ficken", "hurensohn", "kacke", "scheiße", "scheisse", "arsch", "arschloch",
        "fotze", "schlampe", "luder", "drecksack", "mistsack", "trottel", "blödmann", "spasti",
        "pisse", "pisen", "bumsen", "vögeln", "schweinehund", "vollidiot", "vollpfosten", "locher",
    }
    REGISTER_VULGAR_STEMS = (
        "fick", "wichs", "hurensohn", "arsch", "fotze", "schlampe", "drecksack", "mistsack",
        "mistkerl", "miststück", "scheißkerl", "scheißdreck", "schweinehund", "vollidiot", "vollpfosten",
    )
    REGISTER_COLLOQUIAL_STEMS = ("quatsch", "penner", "pennen", "labern", "zocken", "besoffen", "pleite", "zoff", "verarsch")
    import re as _re
    _EDGE = r"(?:^|[^a-zäöüß])"
    _VUL = _re.compile("|".join(_EDGE + s for s in sorted(REGISTER_VULGAR_STEMS)), _re.I)
    _COL = _re.compile("|".join(_EDGE + s for s in sorted(REGISTER_COLLOQUIAL_STEMS)), _re.I)

    def register_for(word):
        w = str(word or "").lower()
        if w in REGISTER_VULGAR or _VUL.search(w):
            return "vulgar"
        if any(s in w for s in REGISTER_COLLOQUIAL_STEMS) or _COL.search(w):
            return "colloquial"
        return ""

    _BANNED = _re.compile(
        r"((?:^|[^a-zäöüß])(?:fick|wichs|arsch|fotze|hurensohn|scheiß|scheiss|kack|begierde|busen|brustwarze|"
        r"sex|porno|prostitui|vergewalt|erschie|töt|waffe|leiche|selbstmord|nazi|hitler|bombe))|"
        r"(性交|性欲|乳房|阴茎|阴道|鸡巴|强奸|妓女|尸体|自杀|开枪|炸弹|纳粹|拉屎|大便)", _re.I)

    def example_banned(de, zh):
        return bool(_BANNED.search(str(de or ""))) or bool(_BANNED.search(str(zh or "")))


def _read_json(p):
    return json.load(io.open(p, encoding="utf-8"))


def check_speech(errs):
    if not os.path.exists(SPEECH):
        errs.append("缺少 dist/content-pack-speech.json（跑 python tools/content_pipeline.py --all）")
        return 0
    d = _read_json(SPEECH)
    if d.get("pack") != "speech":
        errs.append("speech 包 pack 字段错误：%s" % d.get("pack"))
    items = d.get("items") or []
    if not items:
        errs.append("speech 包为空")
    if d.get("count") not in (None, len(items)):
        errs.append("speech 包 count(%s) 与 items(%d) 不一致" % (d.get("count"), len(items)))
    bad_audio = [x for x in items if x.get("hasAudio") and not (x.get("audioLicense") or "").strip()]
    if bad_audio:
        errs.append("speech 包有 %d 条音频缺 audioLicense（授权红线）" % len(bad_audio))
    no_de = [x for x in items if not (x.get("de") or "").strip()]
    if no_de:
        errs.append("speech 包有 %d 条缺 de 文本" % len(no_de))
    return len(items)


def check_reading(errs):
    if not os.path.exists(READING):
        errs.append("缺少 dist/content-pack-reading.json（跑 python tools/reading_pipeline.py --all）")
        return 0
    d = _read_json(READING)
    if d.get("pack") != "reading":
        errs.append("reading 包 pack 字段错误：%s" % d.get("pack"))
    items = d.get("items") or []
    if not items:
        errs.append("reading 包为空")
    for x in items:
        pid = x.get("id") or "?"
        if not isinstance(x.get("paras"), list) or len(x["paras"]) < 3:
            errs.append("阅读条目 %s 段落数不足" % pid)
        for k in ("tfng", "mcq", "words", "headings", "headingAns"):
            if not isinstance(x.get(k), list) or not x[k]:
                errs.append("阅读条目 %s 缺少题型字段 %s" % (pid, k))
        if not (x.get("src") or "").strip() or not (x.get("srcUrl") or "").strip():
            errs.append("阅读条目 %s 缺来源/链接（授权可追溯性）" % pid)
        if x.get("lv") not in ("A2", "B1", "B2"):
            errs.append("阅读条目 %s 等级非法：%s" % (pid, x.get("lv")))
    return len(items)


def check_lexicon(errs):
    """词库红线：释义非空、等级/词形/语域枚举合法、词形标签必须有原形、粗口必须标注。"""
    rows = []
    for fn in sorted(os.listdir(DATA_DIR)):
        if not re.match(r"lexicon-\d+\.js$", fn):
            continue
        for line in io.open(os.path.join(DATA_DIR, fn), encoding="utf-8"):
            s = line.strip().rstrip(",")
            if not s.startswith("["):
                continue
            try:
                row = json.loads(s)
            except Exception:
                continue
            if len(row) >= 7:
                rows.append((fn, row))
    words = {row[0].lower() for _, row in rows}
    for fn, row in rows:
        de, art, zh, pos, lvl = row[0], row[1], row[2], row[3], row[4]
        formOf, formKind, reg = (list(row) + ["", "", ""])[7:10]
        if not str(zh).strip():
            errs.append("%s 中词条 %s 缺中文释义（红线）" % (fn, de))
        if lvl not in ("A1", "A2", "B1", "B2", "C1", "C2"):
            errs.append("%s 中词条 %s 等级非法：%s" % (fn, de, lvl))
        if formKind not in ("", "plural", "participle"):
            errs.append("%s 中词条 %s 词形类型非法：%s" % (fn, de, formKind))
        if reg not in REGISTER_ENUM:
            errs.append("%s 中词条 %s 语域非法：%s" % (fn, de, reg))
        if formKind and not formOf:
            errs.append("%s 中词条 %s 标了词形类型却没有原形" % (fn, de))
        # 词形闸门：原形必须在词库内，否则卡片会写出「X 是 Y 的过去分词」而 Y 根本学不到
        if formOf and formOf.lower() not in words:
            errs.append("%s 中词条 %s 的词形原形 %s 不在词库" % (fn, de, formOf))
        # 语域红线：命中粗口（词头或词干）却没标注，说明有人往可学词池里加了不该学的词
        if register_for(de) == "vulgar" and reg != "vulgar":
            errs.append("%s 中词条 %s 是粗口/辱骂词但未标注 register（红线）" % (fn, de))
        # 例句红线：词条可以收录粗口，例句与例句中文不可以（旧红线只比词头，看不见这一层）
        if example_banned(row[5] if len(row) > 5 else "", row[6] if len(row) > 6 else "", de, zh):
            errs.append("%s 中词条 %s 的例句含性描写/暴力/排泄内容，需清空：%s" %
                        (fn, de, str(row[5] if len(row) > 5 else "")[:48]))
    if len(rows) < 400:
        errs.append("词库总条数异常：%d" % len(rows))
    return len(rows)


def check_lexicon_pack(errs):
    """独立词库册内容包（tools/lexicon_enrich.py --pack 产物）：存在则校验 schema 与红线；
       尚未生成（未跑 LLM 富化）时不视为错误。"""
    p = os.path.join(ROOT, "dist", "content-pack-lexicon.json")
    if not os.path.exists(p):
        return 0
    d = _read_json(p)
    if d.get("pack") != "lexicon":
        errs.append("lexicon 包 pack 字段错误：%s" % d.get("pack"))
    items = d.get("items") or []
    if d.get("count") not in (None, len(items)):
        errs.append("lexicon 包 count(%s) 与 items(%d) 不一致" % (d.get("count"), len(items)))
    for x in items:
        if not (x.get("de") or "").strip():
            errs.append("lexicon 包有条目缺 de")
        if not (x.get("zh") or "").strip():
            errs.append("lexicon 包词条 %s 缺中文释义（红线）" % x.get("de"))
        if x.get("lvl") not in ("A1", "A2", "B1", "B2", "C1", "C2"):
            errs.append("lexicon 包词条 %s 等级非法：%s" % (x.get("de"), x.get("lvl")))
    return len(items)


def check_lexicon_selftest(errs):
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "lexicon_enrich.py"), "--selftest"],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        errs.append("lexicon_enrich --selftest 未通过：%s" % (r.stdout or r.stderr)[-200:])


def check_audio_pack(errs):
    """真人录音包（tools/fetch_audio.py 产物）：授权红线 + 文件与内联 base64 一致性"""
    if not os.path.exists(AUDIO):
        return 0
    d = _read_json(AUDIO)
    if d.get("pack") != "speech":
        errs.append("audio 包 pack 字段应为 speech：%s" % d.get("pack"))
    for f in ("license", "source", "sourceUrl"):
        if not (d.get(f) or "").strip():
            errs.append("audio 包缺 %s（provenance 红线）" % f)
    items = d.get("items") or []
    if d.get("count") != len(items):
        errs.append("audio 包 count(%s) 与 items(%d) 不一致" % (d.get("count"), len(items)))
    n_b64 = 0
    for x in items:
        sid = str(x.get("id") or "")
        if x.get("hasAudio") and not (x.get("audioLicense") or "").strip():
            errs.append("audio 包句 %s 有录音但缺 audioLicense（授权红线）" % sid)
        if "nc" in (x.get("audioLicense") or "").lower().replace("by-nc", "nc"):
            errs.append("audio 包句 %s 许可含 NC，不该进产品：%s" % (sid, x.get("audioLicense")))
        if not (x.get("audioBy") or "").strip():
            errs.append("audio 包句 %s 缺录音贡献者（CC BY 需署名）" % sid)
        rel = x.get("audioFile") or ""
        p = os.path.join(ROOT, "dist", rel.replace("/", os.sep)) if rel else ""
        if not p or not os.path.exists(p):
            errs.append("audio 包句 %s 指向的录音文件不存在：%s" % (sid, rel))
            continue
        size = os.path.getsize(p)
        if size < 2000:
            errs.append("audio 包句 %s 录音文件异常小：%d 字节" % (sid, size))
        b64 = x.get("audioB64") or ""
        if b64:
            n_b64 += 1
            try:
                raw = base64.b64decode(b64)
            except Exception:
                errs.append("audio 包句 %s 的 audioB64 不是合法 base64" % sid)
                continue
            if len(raw) != size:
                errs.append("audio 包句 %s 内联音频(%d) 与文件(%d) 字节数不一致" % (sid, len(raw), size))
        if int(x.get("audioBytes") or 0) != size:
            errs.append("audio 包句 %s 的 audioBytes(%s) 与实际文件(%d) 不一致" % (sid, x.get("audioBytes"), size))
    if d.get("inlineAudio") not in (None, n_b64):
        errs.append("audio 包 inlineAudio(%s) 与实际内联条数(%d) 不一致" % (d.get("inlineAudio"), n_b64))
    return len(items)


def main():
    errs = []
    s = check_speech(errs)
    r = check_reading(errs)
    l = check_lexicon(errs)
    lp = check_lexicon_pack(errs)
    a = check_audio_pack(errs)
    check_lexicon_selftest(errs)
    print("内容产物：跟读包 %d 条 · 阅读包 %d 篇 · 词库 %d 词 · 词库册包 %d 词 · 真人录音包 %d 条" % (s, r, l, lp, a))
    if errs:
        print("校验未通过：")
        for e in errs[:30]:
            print("  - " + e)
        if len(errs) > 30:
            print("  ...（共 %d 条）" % len(errs))
        return 1
    print("校验通过：内容包 schema / 授权字段 / 题型完整性 / 词库红线 全部一致")
    return 0


if __name__ == "__main__":
    sys.exit(main())