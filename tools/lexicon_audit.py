# -*- coding: utf-8 -*-
"""LinguaDE · 词库体检

只读检查 src/data/lexicon-*.js，输出分级分布、例句覆盖与匹配率、繁体字、
重复词形与疑似非词元（复数 / 分词）清单。用于发布前验收与词库治理前后对比。

用法：
  python tools/lexicon_audit.py            # 人读报告
  python tools/lexicon_audit.py --json     # 机器可读
  python tools/lexicon_audit.py --strict   # 例句匹配按词性严格判定（默认）
"""
import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
FILES = ["lexicon-%d.js" % i for i in range(1, 12)]
MACHINE_START = 572          # lexicon-1..8 共 572 条人工词条
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

STR_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
GERMAN_WORD = re.compile(r"[A-Za-zÄÖÜäöüßÉÈÀÊéèàêôùû][A-Za-zÄÖÜäöüßÉÈÀÊéèàêôùû-]*")
try:
    from opencc import OpenCC
    _t2s = OpenCC("t2s").convert
except Exception:
    _t2s = None

try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from import_german_exam_db import (form_sets as _fmatch, sentence_hit as _sentence_hit,
                                       verb_stems as _verb_stems, sent_pack as _sent_pack,
                                       inflected_tokens as _inflected,
                                       DEFAULT_DB as _EXAM_DB)
except Exception:
    _fmatch = _sentence_hit = _verb_stems = _inflected = _sent_pack = None
    _EXAM_DB = ""

_FORMS = None


def db_forms():
    """源库里已登记的词形（复数 / 3.sing / Präteritum / Partizip II / 比较级）。
    没有它，体检器认不出 sieht、muss、fuhr、erschossen 这类真词形，
    会把好例句报成「不含词形」；缺库时自动退回纯规则模式。"""
    global _FORMS
    if _FORMS is None:
        _FORMS = {}
        path = (_EXAM_DB or "").replace("\\", "/")
        if path and os.path.exists(path):
            import sqlite3
            con = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
            q = ("SELECT lemma, plural, verb_praesens_3sg, verb_praeteritum, verb_partizip2,"
                 " komparativ, superlativ FROM v_word UNION ALL "
                 "SELECT word, plural, verb_3sg, verb_past, verb_pp, comparative, superlative "
                 "FROM dict_entry")
            for r in con.execute(q):
                key = (r[0] or "").strip().lower()
                if not key:
                    continue
                bucket = _FORMS.setdefault(key, [])
                for f in r[1:]:
                    f = (f or "").strip()
                    if f and f not in bucket:
                        bucket.append(f)
            con.close()
    return _FORMS


def parse_entries(path):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line.startswith("["):
                continue
            fields = [json.loads('"%s"' % s) for s in STR_RE.findall(line)]
            if len(fields) >= 7:
                out.append(fields)
    return out


def load():
    entries = []
    for name in FILES:
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            continue
        entries.extend(parse_entries(path))
    return entries


def word_forms(word, pos):
    """词条在例句中可能出现的屈折形式（按词性），用于严格匹配。
    有导入器时复用同一套生成器，保证体检口径与选句口径一致。"""
    if _inflected:
        return _inflected(word, pos)
    w = (word or "").lower()
    forms = {w}
    if pos == "n":
        for suf in ("s", "es", "e", "en", "n", "er", "ern", "ners"):
            forms.add(w + suf)
        if "ä" in w or "ö" in w or "ü" in w:
            forms.add(w.replace("a", "ä").replace("o", "ö").replace("u", "ü"))
    elif pos == "v":
        stems = _verb_stems(w) if _verb_stems else {w[:-2] if w.endswith("en") else w}
        for stem in stems:
            if len(stem) < 3:
                continue
            forms.update(stem + s for s in ("e", "st", "t", "en", "te", "test", "ten", "tet", "end", "ung"))
            forms.add("ge" + stem + "t")
            forms.add("ge" + stem + "en")
        forms.add(w)
    elif pos == "adj":
        forms.update(w + s for s in ("e", "en", "er", "es", "em"))
    elif pos == "adv":
        forms.add(w)
    return forms


def example_hits(ex, word, pos):
    raw = GERMAN_WORD.findall(ex or "")
    tl = [t.lower() for t in raw]
    tokens = set(tl)
    if tokens & word_forms(word, pos):
        return True
    if _fmatch and raw:
        # 与导入器同一套匹配：可分动词（er stellt ein）与词组词条（Schritt für Schritt）
        single, multi, sep = _fmatch(word, pos, db_forms().get(word.lower(), []))
        toks, soft, ends, early, _n = _sent_pack(ex or "")
        return _sentence_hit(pos, toks, soft, ends, early, single, multi, sep)
    return False


def loose_hits(ex, word):
    w = (word or "").lower()
    stem = w[:-1] if len(w) > 4 and w[-1] in "e" else w
    return any(t.lower().startswith(stem) for t in GERMAN_WORD.findall(ex or ""))


def traditional_chars(text):
    """用 OpenCC 判断是否含繁体（逐字近似；转换后不一致即含繁体）。"""
    if not text or _t2s is None:
        return []
    if _t2s(text) == text:
        return []
    return ["繁"]



def audit(entries):
    all_words = {e[0].lower() for e in entries}
    by_level = {lv: 0 for lv in LEVELS}
    m_by_level = {lv: 0 for lv in LEVELS}
    empty, strict_ok, loose_ok = 0, 0, 0
    m_empty, m_with, m_strict = 0, 0, 0
    non_strict = []
    trad = []
    dup = {}
    labeled_plural = 0
    labeled_part = 0
    for i, e in enumerate(entries):
        de, art, zh, pos, lv, ex, exzh = e[:7]
        kind = e[8] if len(e) >= 9 else ""
        if kind.startswith("plural"):
            labeled_plural += 1
        elif kind == "participle":
            labeled_part += 1
        by_level[lv] = by_level.get(lv, 0) + 1
        if i >= MACHINE_START:
            m_by_level[lv] = m_by_level.get(lv, 0) + 1
        if not ex:
            empty += 1
            if i >= MACHINE_START:
                m_empty += 1
        else:
            if i >= MACHINE_START:
                m_with += 1
            if example_hits(ex, de, pos):
                strict_ok += 1
                if i >= MACHINE_START:
                    m_strict += 1
            else:
                non_strict.append(e)
            if loose_hits(ex, de):
                loose_ok += 1
        if traditional_chars(zh) or traditional_chars(exzh):
            trad.append(e)
        dup.setdefault(de.lower(), []).append(i)
    with_ex = len(entries) - empty
    return {
        "total": len(entries),
        "byLevel": by_level,
        "machineByLevel": m_by_level,
        "withExample": with_ex,
        "emptyExample": empty,
        "strictMatch": strict_ok,
        "looseMatch": loose_ok,
        "nonStrict": non_strict,
        "machineWithExample": m_with,
        "machineEmpty": m_empty,
        "machineStrictRate": round(m_strict / m_with * 100, 1) if m_with else 0,
        "traditional": trad,
        "duplicates": {k: v for k, v in dup.items() if len(v) > 1},
        "labeledPlural": labeled_plural,
        "labeledParticiple": labeled_part,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--limit", type=int, default=12)
    args = ap.parse_args()
    entries = load()
    r = audit(entries)
    if args.json:
        r["nonStrict"] = r["nonStrict"][:args.limit]
        r["traditional"] = r["traditional"][:args.limit]
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return
    print("词库总量：%d" % r["total"])
    print("分级分布：")
    for lv in LEVELS:
        print("  %-2s 全库 %4d · 机器词条 %4d" % (lv, r["byLevel"].get(lv, 0), r["machineByLevel"].get(lv, 0)))
    print("例句：有 %d · 空 %d" % (r["withExample"], r["emptyExample"]))
    print("机器词条例句：有 %d · 空 %d · 字面含词形 %d%%" % (
        r["machineWithExample"], r["machineEmpty"], int(r["machineStrictRate"])))
    print("繁体释义：%d 条" % len(r["traditional"]))
    print("重复词形：%d 组" % len(r["duplicates"]))
    print("已标注词形：复数 %d · 分词 %d" % (r["labeledPlural"], r["labeledParticiple"]))
    def show(title, rows, fmt):
        if not rows:
            return
        print("\n%s（前 %d）：" % (title, min(args.limit, len(rows))))
        for row in rows[:args.limit]:
            print("  " + fmt(row))
    show("例句不含词条（字面启发式，人类词条的屈折会误报）", r["nonStrict"], lambda e: "%s [%s] :: %s" % (e[0], e[4], e[5]))
    show("繁体释义", r["traditional"], lambda e: "%s :: %s / %s" % (e[0], e[2], e[6]))


if __name__ == "__main__":
    main()
