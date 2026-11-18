# -*- coding: utf-8 -*-
"""LinguaDE · 开放知识库接入（Tatoeba 德中双语）

来源与许可：
  · Tatoeba 德语-中文句对：https://tatoeba.org/ ，CC BY 2.0 FR
  · 频率表：hermitdave/FrequencyWords（de_50k.txt），CC BY-SA 4.0
  · 仅使用开放授权语料；不抓取歌德/TestDaF 真题或 CC BY-NC 词表。

用途：
  1) 为 AI 出题提供「开放语料 grounding」（不是把句子直接当题卖）
  2) 生成 dist/content-pack-pairs.json，可被部署版一键导入
  3) docs/knowledge-ingest-report.md 记录数量、等级分布、来源与许可

用法：
  python tools/knowledge_ingest.py --all --target 160
  python tools/knowledge_ingest.py --pack-only
  python tools/knowledge_ingest.py --all --target 400     # 增量刷新（seen 去重）
"""
import argparse
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, ".knowledge-cache")
CACHE_JSONL = os.path.join(CACHE_DIR, "tatoeba_pairs.jsonl")
SEEN_JSON = os.path.join(CACHE_DIR, "seen.json")
FREQ = os.path.join(ROOT, ".content-cache", "de_50k.txt")
OUT_PACK = os.path.join(ROOT, "dist", "content-pack-pairs.json")
REPORT = os.path.join(ROOT, "docs", "knowledge-ingest-report.md")
API = "https://api.tatoeba.org/unstable/sentences"
LICENSE = "CC BY 2.0 FR"
UA = "LinguaDE-knowledge-ingest/1.0 (educational; Tatoeba CC BY 2.0 FR)"

WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*")
STOP = set(("der die das den dem des ein eine einen einem einer eines und oder aber weil dass ich du er sie es wir ihr mich dich sich mir dir uns euch mein dein sein unser euer nicht kein keine mit von zu im am an auf für aus bei nach vor über unter durch gegen ohne um ist bin bist sind seid war waren habe hast hat haben hatte hatten wird werden wurde wurden").split())


def log(*a):
    print(*a, flush=True)


def load_freq():
    rank = {}
    if not os.path.exists(FREQ):
        return rank
    i = 0
    for line in io.open(FREQ, encoding="utf-8"):
        p = line.split()
        if len(p) >= 2:
            i += 1
            rank[p[0].lower()] = i
    return rank


FREQ_RANK = load_freq()


def level_of(de):
    words = [w.lower() for w in WORD_RE.findall(de)]
    ranks = sorted(FREQ_RANK[w] for w in words if w in FREQ_RANK and w not in STOP)
    if ranks:
        # 用较难的一端估计句子等级，避免“高频词 + 一个生词”被误判为简单
        p80 = ranks[min(len(ranks) - 1, int(len(ranks) * 0.8))]
        if p80 <= 1200:
            return "A2"
        if p80 <= 3000:
            return "B1"
        if p80 <= 8000:
            return "B2"
        if p80 <= 18000:
            return "C1"
        return "C2"
    n = len(words)
    return "A2" if n <= 8 else "B1" if n <= 13 else "B2" if n <= 18 else "C1"


def http_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=35) as r:
        return json.loads(r.read().decode("utf-8"))


def load_cache():
    items = []
    if os.path.exists(CACHE_JSONL):
        for line in io.open(CACHE_JSONL, encoding="utf-8"):
            line = line.strip()
            if not line:
                continue
            try:
                items.append(json.loads(line))
            except Exception:
                continue
    return items


def save_cache(items):
    os.makedirs(CACHE_DIR, exist_ok=True)
    with io.open(CACHE_JSONL, "w", encoding="utf-8") as f:
        for it in items:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")


def load_seen():
    try:
        return set(json.loads(io.open(SEEN_JSON, encoding="utf-8").read()))
    except Exception:
        return set()


def save_seen(seen):
    with io.open(SEEN_JSON, "w", encoding="utf-8") as f:
        f.write(json.dumps(sorted(seen), ensure_ascii=False))


def ok_pair(de, zh):
    if not de or not zh:
        return False
    n = len(WORD_RE.findall(de))
    if n < 4 or n > 22:
        return False
    if len(zh) < 4 or len(zh) > 120:
        return False
    if re.search(r"[<>{}|]|https?://", de + zh):
        return False
    if de.count("?") + de.count("!") > 2:
        return False
    return True


def fetch(target, max_pages):
    os.makedirs(CACHE_DIR, exist_ok=True)
    items = load_cache()
    seen = load_seen()
    for it in items:
        seen.add(str(it.get("id")))
    pages = 0
    added = 0
    while added < target and pages < max_pages:
        pages += 1
        qs = urllib.parse.urlencode({
            "lang": "deu", "trans:lang": "cmn", "sort": "random", "limit": 100
        })
        url = API + "?" + qs
        try:
            data = http_json(url)
        except Exception as e:
            log("  抓取失败（保留已有缓存）：", e)
            break
        rows = data.get("data") or []
        log("  第 %d 页：%d 句" % (pages, len(rows)))
        for row in rows:
            sid = str(row.get("id") or "")
            if not sid or sid in seen:
                continue
            de = (row.get("text") or "").strip()
            trans = [t for t in (row.get("translations") or []) if t.get("lang") == "cmn"]
            trans.sort(key=lambda t: (not t.get("is_direct"), bool(t.get("is_unapproved"))))
            if not trans:
                continue
            zh = (trans[0].get("text") or "").strip()
            if not ok_pair(de, zh):
                continue
            item = {
                "id": sid, "de": de, "zh": zh, "level": level_of(de),
                "license": LICENSE, "source": "Tatoeba",
                "url": "https://tatoeba.org/de/sentences/show/" + sid
            }
            items.append(item)
            seen.add(sid)
            added += 1
            if added >= target:
                break
        time.sleep(0.25)
    save_cache(items)
    save_seen(seen)
    log("  本次新增 %d 条，缓存共 %d 条" % (added, len(items)))
    return items


def pack(items):
    os.makedirs(os.path.join(ROOT, "dist"), exist_ok=True)
    by_level = {}
    for it in items:
        by_level[it["level"]] = by_level.get(it["level"], 0) + 1
    data = {
        "pack": "pairs",
        "version": "3.10.0",
        "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "Tatoeba",
        "sourceUrl": "https://tatoeba.org/",
        "license": LICENSE,
        "note": "德语-中文双语开放语料，用于 AI 出题 grounding 与句读练习；使用时保留 Tatoeba 署名与许可。",
        "count": len(items),
        "levels": by_level,
        "items": items,
    }
    with io.open(OUT_PACK, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    write_report(data)
    log("  内容包：", OUT_PACK, "(%d 条)" % len(items))


def write_report(data):
    lines = [
        "# 开放知识库接入报告 · Tatoeba 德中双语",
        "",
        "> 生成时间：%s · 来源：Tatoeba · 许可：%s" % (data["generatedAt"], data["license"]),
        "> 用途：为 AI 出题提供开放语料 grounding；条目保留 Tatoeba 句 ID、原文链接与许可。",
        "",
        "## 数量与等级分布",
        "",
        "| 等级 | 条数 |",
        "|---|---|",
    ]
    for k in ["A2", "B1", "B2", "C1", "C2"]:
        lines.append("| %s | %d |" % (k, data["levels"].get(k, 0)))
    lines += [
        "| **合计** | **%d** |" % data["count"],
        "",
        "## 来源与许可",
        "",
        "- Tatoeba 德语句与其中文翻译：CC BY 2.0 FR；每条带 `https://tatoeba.org/de/sentences/show/<id>`。",
        "- 频率表：hermitdave/FrequencyWords（CC BY-SA 4.0），仅用于等级估计，不随包分发。",
        "- 不使用歌德/TestDaF 真题、CC BY-NC 词表或来源不明的爬取题库。",
        "",
        "## 刷新",
        "",
        "```bash",
        "python tools/knowledge_ingest.py --all --target 160",
        "python tools/knowledge_ingest.py --all --target 400   # 增量，seen 去重",
        "```",
        "",
        "## 已知边界",
        "",
        "- 句对是句子级语料，不是完整文章；阅读长文仍由 Wikipedia 阅读管线提供。",
        "- 等级为频率启发式估计，不是官方 CEFR 标注。",
        "- AI 生成题目必须另行校验，不能把开放语料原句直接当考试题。",
    ]
    with io.open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--pack-only", action="store_true")
    ap.add_argument("--target", type=int, default=160)
    ap.add_argument("--max-pages", type=int, default=8)
    args = ap.parse_args()
    if args.pack_only:
        items = load_cache()
    elif args.all:
        items = fetch(max(0, args.target), max(1, args.max_pages))
    else:
        items = load_cache()
    pack(items)


if __name__ == "__main__":
    main()
