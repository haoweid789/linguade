#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""LinguaDE · 内容复核批次工具（3.20）

把 A1–A2 机器对齐词条按「结构 + 一致性」规则跑一遍，产出：
  1) src/data/lexicon-review.js —— 通过自动复核的词头集合（供前端标注「AI 辅助 · 自动复核」）
  2) dist/lexicon-review-3.20.json —— 批次统计与未通过项（供人工复核）
  3) docs/content-review-3.20.md —— 人可读的复核说明与待办

注意：自动复核不是人工审校。它只检查词性/冠词/大小写/例句含词/中文非空等
可机检项；语义是否准确仍需要人看。未通过项不会进入已复核集合。

用法：
  python tools/review_batch.py            # 打印统计
  python tools/review_batch.py --write    # 写文件
  python tools/review_batch.py --limit 500 --levels A1,A2
"""
import argparse
import glob
import io
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "src", "data")
OUT_JS = os.path.join(DATA_DIR, "lexicon-review.js")
OUT_JSON = os.path.join(ROOT, "docs", "lexicon-review-3.20.json")
OUT_MD = os.path.join(ROOT, "docs", "content-review-3.20.md")
LINE_RE = re.compile(r"^\s*(\[.*\]),?$")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")
LATIN_WORD_RE = re.compile(r"[A-Za-z]{3,}")
PLACEHOLDER_RE = re.compile(r"TODO|FIXME|待补|待填|占位|\?\?\?")
LEVEL_ORDER = {"A1": 0, "A2": 1, "B1": 2, "B2": 3, "C1": 4, "C2": 5}
NOUN_ARTS = {"der", "die", "das"}
SEP_PREFIXES = (
    "zurück", "zusammen", "weiter", "entgegen", "gegenüber", "herunter", "hinunter",
    "hinauf", "herauf", "herein", "hinein", "vorbei", "voraus", "zurecht", "davon",
    "dazu", "daran", "darauf", "darum", "ab", "an", "auf", "aus", "bei", "ein",
    "mit", "nach", "vor", "zu", "weg", "los", "her", "hin",
)


def norm(s):
    s = str(s or "").lower()
    for a, b in (("ä", "a"), ("ö", "o"), ("ü", "u"), ("ß", "ss")):
        s = s.replace(a, b)
    return s


def verb_stem(de):
    s = str(de or "").lower()
    for p in SEP_PREFIXES:
        if s.startswith(p) and len(s) > len(p) + 2:
            return s[len(p):]
    return s


def read_rows():
    rows = []
    for p in sorted(glob.glob(os.path.join(DATA_DIR, "lexicon-*.js"))):
        name = os.path.basename(p)
        if name == "lexicon-review.js":
            continue
        with io.open(p, encoding="utf-8") as f:
            for line in f:
                m = LINE_RE.match(line.rstrip("\n"))
                if not m:
                    continue
                try:
                    rows.append((name, json.loads(m.group(1))))
                except Exception:
                    continue
    return rows


def reasons_for(f):
    reasons = []
    de = str(f[0] or "").strip()
    art = str(f[1] or "").strip()
    zh = str(f[2] or "").strip()
    pos = str(f[3] or "").strip()
    lv = str(f[4] or "").strip()
    ex = str(f[5] or "").strip()
    exzh = str(f[6] or "").strip()

    if not de:
        reasons.append("词头为空")
    if not zh or not CJK_RE.search(zh):
        reasons.append("中文释义缺失或不是中文")
    if PLACEHOLDER_RE.search(zh):
        reasons.append("中文释义含占位标记")
    if zh and de and de.lower() == zh.lower():
        reasons.append("中文释义未翻译")
    if LATIN_WORD_RE.search(zh):
        reasons.append("中文释义含未翻译的拉丁词")
    if lv not in LEVEL_ORDER:
        reasons.append("等级不在 A1–C2")
    if not exzh or not CJK_RE.search(exzh):
        reasons.append("例句中文缺失")
    if not ex:
        reasons.append("德语句例缺失")
    elif de:
        # 可分动词 / 变位 / 复数变音：归一化后看完整词头、词干或前 3–4 个字符
        nex, full = norm(ex), norm(de)
        stem = norm(verb_stem(de))
        hits = (full in nex, full[:4] in nex, stem[:4] in nex, stem[:3] in nex)
        if not any(hits):
            reasons.append("例句未含词头或词干")
    if pos == "n":
        if art not in NOUN_ARTS:
            reasons.append("名词冠词不是 der/die/das")
        if de and not de[0].isupper():
            reasons.append("名词未大写")
    else:
        if art not in ("-", ""):
            reasons.append("非名词却带冠词")
        if de and de[0].isupper() and de.lower() != de and pos in ("v", "prep", "conj", "part"):
            # 动词/介词/连词应小写；代词敬称（Ihr）、感叹词（Tschüss）、语言名允许大写
            reasons.append("非名词词头大写")
    return reasons


def review(limit=500, levels=("A1", "A2")):
    rows = read_rows()
    machine = [(n, f) for n, f in rows if n in ("lexicon-9.js", "lexicon-10.js", "lexicon-11.js")]
    candidate = [(n, f) for n, f in machine if str(f[4]) in levels]
    candidate.sort(key=lambda x: (LEVEL_ORDER.get(str(x[1][4]), 9), str(x[1][0]).lower()))
    batch = candidate[:limit]
    passed, flagged = [], []
    for name, f in batch:
        rs = reasons_for(f)
        if rs:
            flagged.append({"de": f[0], "art": f[1], "zh": f[2], "pos": f[3], "lv": f[4],
                            "ex": f[5], "reasons": rs})
        else:
            passed.append(f)
    return {
        "totalMachine": len(machine),
        "candidatePool": len(candidate),
        "levels": list(levels),
        "batch": len(batch),
        "passed": len(passed),
        "flagged": len(flagged),
        "passedWords": [str(f[0]) for f in passed],
        "flaggedItems": flagged,
    }


def write_outputs(result):
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    os.makedirs(os.path.dirname(OUT_MD), exist_ok=True)
    words = sorted({w.lower() for w in result["passedWords"]})
    with io.open(OUT_JS, "w", encoding="utf-8", newline="\n") as f:
        f.write("/* LinguaDE 3.20 · AI 辅助自动复核批次（工具生成，勿手改）\n")
        f.write("   只代表通过结构/一致性规则，不代表人工语义校订；\n")
        f.write("   重跑：python tools/review_batch.py --write */\n")
        f.write("window.LD_LEX_REVIEWED = window.LD_LEX_REVIEWED || new Set();\n")
        f.write("window.LD_LEX_AI_REVIEWED = new Set([\n")
        f.write(",\n".join(json.dumps(w, ensure_ascii=False) for w in words))
        f.write("\n]);\n")
    with io.open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    with io.open(OUT_MD, "w", encoding="utf-8", newline="\n") as f:
        f.write("# LinguaDE 3.20 · 内容复核批次报告\n\n")
        f.write("> 由 `python tools/review_batch.py --write` 生成。自动复核不是人工审校：\n")
        f.write("> 它只检查词性/冠词/大小写/例句含词/中文非空等可机检项，语义准确性仍需人看。\n\n")
        f.write("| 指标 | 数值 |\n| --- | --- |\n")
        f.write("| 机器对齐词条总量 | %d |\n" % result["totalMachine"])
        f.write("| %s 候选池 | %d |\n" % ("/".join(result["levels"]), result["candidatePool"]))
        f.write("| 本批复核 | %d |\n" % result["batch"])
        f.write("| 自动复核通过 | %d |\n" % result["passed"])
        f.write("| 转人工复核 | %d |\n\n" % result["flagged"])
        f.write("## 转人工复核清单\n\n")
        if result["flaggedItems"]:
            f.write("| 词头 | 等级 | 释义 | 问题 |\n| --- | --- | --- | --- |\n")
            for it in result["flaggedItems"]:
                f.write("| %s | %s | %s | %s |\n" % (
                    it["de"], it["lv"], it["zh"], "；".join(it["reasons"])))
        else:
            f.write("本批次没有未通过项。\n")
        f.write("\n## 下一步\n\n")
        f.write("1. 人工逐条看「转人工复核」表，修正后重跑本工具；\n")
        f.write("2. 语义确认无误的词条可加入 `LD_LEX_REVIEWED`（人工校订集合），与自动复核区分；\n")
        f.write("3. 自动复核集合只影响词卡标注，不改变首卡人工优先规则。\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--levels", default="A1,A2")
    args = ap.parse_args()
    levels = tuple(x.strip() for x in args.levels.split(",") if x.strip())
    result = review(args.limit, levels)
    print("机器词条 %d · 候选 %d · 批次 %d · 通过 %d · 转人工 %d" % (
        result["totalMachine"], result["candidatePool"], result["batch"],
        result["passed"], result["flagged"]))
    if args.write:
        write_outputs(result)
        print("已写：%s" % OUT_JS)
        print("已写：%s" % OUT_JSON)
        print("已写：%s" % OUT_MD)


if __name__ == "__main__":
    main()
