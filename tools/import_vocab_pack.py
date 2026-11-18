# -*- coding: utf-8 -*-
"""把「德语词汇资料包 v4」的定稿合并批次写入 src/data/lexicon-11.js。

数据源：tools/data/vocab_pack_v4.json
  - 由资料包 8000 个字幕词形归并、去重、人工复核后的 517 条新词元；
  - 字段：de / genus / pos / cefr / zh / ex_de / ex_zh / src_key / pack。
复跑：
  python tools/import_vocab_pack.py
"""
import io
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "data", "vocab_pack_v4.json")
OUT = os.path.join(ROOT, "src", "data", "lexicon-11.js")

POS_ENUM = {"n", "v", "adj", "adv", "prep", "art", "num", "pron", "conj", "phrase", "part", "interj"}
CEFR_ENUM = {"A1", "A2", "B1", "B2", "C1", "C2"}
GENUS_ENUM = {"der", "die", "das", "-"}

HEADER = """/* LinguaDE 词库 Part 11 · 高频扩展（%d 条）
   来源：德语词汇资料包 v4（8000 词）
        - 词频主干：FrequencyWords 德语字幕词频（CC BY-SA 4.0）
        - 中文释义：资料包 v4 人工精校（8000/8000）
        - 词形/词性/性别：kaikki.org / Wiktionary German（CC BY-SA 3.0）+ german_exam.db
   处理：8000 个字幕词形归并为原形；剔除人名、OCR 噪音、纯英文词、粗口与重复词形；
        名词大写并补性；CEFR 优先用 Goethe A1–B1 官方词表，其余按字幕词频派生 B2–C2
        （非官方认定）；例句优先取 Tatoeba/考试库德中句对，配不到的人工补写。
   本文件数据衍生自 Wiktionary（CC BY-SA 3.0）与 FrequencyWords（CC BY-SA 4.0）。
   复跑：python tools/import_vocab_pack.py
*/
window.LD_LEX_MACHINE_FROM_11 = (window.LD_LEX || []).length;
window.LD_LEX = (window.LD_LEX || []).concat([
"""

TAIL = """]);

window.LD_LEX_MACHINE = new Set([...(window.LD_LEX_MACHINE || []),
  ...(window.LD_LEX || []).slice(window.LD_LEX_MACHINE_FROM_11).map(x => String(x[0]).toLowerCase())]);
"""


def js(v):
    return json.dumps(str(v), ensure_ascii=False)


def main():
    data = json.load(io.open(SRC, encoding="utf-8"))
    errors = []
    seen = set()
    for i, w in enumerate(data):
        for f in ("de", "genus", "pos", "cefr", "zh", "ex_de", "ex_zh"):
            if not str(w.get(f, "")).strip():
                errors.append("第 %d 条缺字段 %s" % (i + 1, f))
        if w["pos"] not in POS_ENUM:
            errors.append("%s: 非法 pos %s" % (w.get("de"), w.get("pos")))
        if w["cefr"] not in CEFR_ENUM:
            errors.append("%s: 非法 cefr %s" % (w.get("de"), w.get("cefr")))
        if w["genus"] not in GENUS_ENUM:
            errors.append("%s: 非法 genus %s" % (w.get("de"), w.get("genus")))
        if w["genus"] == "-" and w["pos"] == "n":
            errors.append("%s: 名词缺性别" % w.get("de"))
        if w["genus"] != "-" and w["pos"] != "n":
            errors.append("%s: 非名词带性别" % w.get("de"))
        key = (w["de"].lower(), w["pos"])
        if key in seen:
            errors.append("%s: 重复词条" % w.get("de"))
        seen.add(key)
    if errors:
        print("数据校验失败：")
        for e in errors:
            print("  -", e)
        return 1

    lines = [HEADER % len(data)]
    for w in data:
        row = [w["de"], w["genus"], w["zh"], w["pos"], w["cefr"], w["ex_de"], w["ex_zh"]]
        lines.append("[" + ",".join(js(x) for x in row) + "],\n")
    lines.append(TAIL)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write("".join(lines))
    print("已写 %s：%d 条" % (os.path.relpath(OUT, ROOT), len(data)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
