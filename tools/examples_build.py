# -*- coding: utf-8 -*-
"""LinguaDE · 给 2000 词补例句

优先级：
  1) Tatoeba 德中句对（CC BY 2.0 FR）：德语例句 + 中文翻译，最理想
  2) kaikki / English Wiktionary 德语例句（CC BY-SA 3.0）：只有德语例句，中文留空
  3) 都没有：保持空例句，不伪造

用法：
  python tools/examples_build.py
  python tools/examples_build.py --limit 200   # 调试
"""
import argparse
import gzip
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEX = os.path.join(ROOT, "src", "data", "lexicon-9.js")
PAIRS = os.path.join(ROOT, ".knowledge-cache", "tatoeba_pairs.jsonl")
KAIKKI = os.path.join(ROOT, ".knowledge-cache", "kaikki-german.jsonl.gz")
REPORT = os.path.join(ROOT, "docs", "lexicon-examples-report.md")

WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*")
BAD = re.compile(r"[<>{}|]|https?://|\[[^\]]*\]")


def log(*a):
    print(*a, flush=True)


def clean(s):
    s = re.sub(r"\s+", " ", (s or "").strip())
    return s if not BAD.search(s) else ""


def word_count(s):
    return len(WORD_RE.findall(s or ""))


def stems(word):
    w = (word or "").lower()
    out = {w}
    for suf in ("innen", "ern", "em", "en", "er", "es", "e", "n", "s", "st", "te", "ten", "test", "tet", "t"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            out.add(w[:-len(suf)])
    if w.startswith("ge") and len(w) > 5:
        out.add(w[2:])
    return [x for x in out if len(x) >= 3]


def load_targets():
    rows = []
    for line in io.open(LEX, encoding="utf-8"):
        s = line.strip().rstrip(",")
        if s.startswith('["'):
            try:
                row = json.loads(s)
            except Exception:
                continue
            rows.append(row)
    return rows


def load_pairs():
    out = []
    if not os.path.exists(PAIRS):
        return out
    for line in io.open(PAIRS, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        try:
            j = json.loads(line)
        except Exception:
            continue
        de = clean(j.get("de"))
        zh = clean(j.get("zh"))
        if de and zh and 4 <= word_count(de) <= 20:
            out.append({"de": de, "zh": zh})
    return out


def pair_match(pair, st):
    words = [w.lower() for w in WORD_RE.findall(pair["de"])]
    for w in words:
        for s in st:
            if w == s or (len(s) >= 4 and w.startswith(s)):
                return True
    return False


def load_kaikki_map(words):
    """一次扫描 kaikki，返回 {德语词: 德语例句}；只收 5–18 词、无标记的例句。"""
    if not os.path.exists(KAIKKI):
        return {}
    wanted = set(w.lower() for w in words)
    out = {}
    with gzip.open(KAIKKI, "rt", encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("lang_code") != "de":
                continue
            word = (e.get("word") or "").lower()
            if word not in wanted or word in out:
                continue
            for sense in e.get("senses") or []:
                for ex in sense.get("examples") or []:
                    txt = clean(ex.get("text") or ex.get("english"))
                    if txt and 5 <= word_count(txt) <= 18:
                        out[word] = txt
                        break
                if word in out:
                    break
            if len(out) >= len(wanted):
                break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    rows = load_targets()
    pairs = load_pairs()
    # 预先按德语词建立句对索引，避免每个词扫全量
    pair_index = {}
    for p in pairs:
        for w in set(x.lower() for x in WORD_RE.findall(p["de"])):
            for s in stems(w):
                pair_index.setdefault(s, []).append(p)
    tato = 0
    wikt = 0
    none = 0
    changed = 0
    todo = rows[:args.limit] if args.limit else rows
    kaikki = load_kaikki_map([r[0] for r in todo])
    log("kaikki 例句覆盖", len(kaikki), "/", len(todo))
    for i, row in enumerate(todo):
        de = row[0]
        st = stems(de)
        ex, exzh = "", ""
        # Tatoeba：精确词或词干命中
        cands = []
        for s in st:
            cands += pair_index.get(s, [])
        cands = list({(p["de"], p["zh"]): p for p in cands}.values())
        for p in cands:
            if pair_match(p, st):
                ex, exzh = p["de"], p["zh"]
                tato += 1
                break
        if not ex:
            ex = kaikki.get(de.lower(), "")
            if ex:
                wikt += 1
        if ex:
            if row[5] != ex or row[6] != exzh:
                changed += 1
            row[5] = ex
            row[6] = exzh
        else:
            none += 1
        if (i + 1) % 200 == 0:
            log("进度", i + 1, "/", len(todo))
    # 写回 lexicon-9，保留头/尾与格式
    lines = io.open(LEX, encoding="utf-8").read().splitlines(True)
    out = []
    idx = 0
    for line in lines:
        s = line.strip().rstrip(",")
        if s.startswith('["') and idx < len(todo):
            tail = "," if line.rstrip().endswith(",") else ""
            out.append(json.dumps(todo[idx], ensure_ascii=False) + tail + "\n")
            idx += 1
        else:
            out.append(line)
    io.open(LEX, "w", encoding="utf-8").write("".join(out))
    total = len(todo)
    lines = [
        "# 2000 词例句补齐报告",
        "",
        "> 生成时间：2026-10-29",
        "> 范围：`src/data/lexicon-9.js` 的 1428 条机器对齐扩展词。",
        "",
        "## 覆盖",
        "",
        "| 来源 | 条数 | 说明 |",
        "|---|---|---|",
        "| Tatoeba 德中句对（CC BY 2.0 FR） | %d | 德语例句 + 中文翻译 |" % tato,
        "| Wiktionary/kaikki 德语例句（CC BY-SA 3.0） | %d | 只有德语例句，中文留空 |" % wikt,
        "| 暂无例句 | %d | 不伪造，留空待补 |" % none,
        "| **合计** | **%d** | |" % total,
        "",
        "## 边界",
        "",
        "- 例句优先选 4–20 词、无 HTML/URL 的句子；Tatoeba 例句保留中文，Wiktionary 例句不伪造中文翻译。",
        "- 例句匹配使用词形/词干启发式，可能有个别例句不是目标词的原形；单词卡仍标注“机器对齐 · 待校对”。",
        "- 未直接抓取明镜/时代/每日新闻等版权报纸；如需新闻语料，走 Wikinews（CC BY 2.5）或维基百科（CC BY-SA）管线。",
        "",
        "## 复跑",
        "",
        "```bash",
        "python tools/knowledge_ingest.py --all --target 12000",
        "python tools/examples_build.py",
        "```",
    ]
    io.open(REPORT, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    log("完成：Tatoeba", tato, "Wiktionary", wikt, "无例句", none, "变更", changed)
    log("报告", REPORT)


if __name__ == "__main__":
    main()
