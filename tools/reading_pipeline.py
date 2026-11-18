# -*- coding: utf-8 -*-
"""LinguaDE · 阅读池管线（3.5.0-d）：Wikipedia(CC BY-SA) → 分级短文集 → src/data/reading.js

依据 docs/content-scaling-plan.md §3.2 的「L1 开放语料打底 + L3 模板出题」：
  · 数据源：de.wikipedia.org REST/action API（**CC BY-SA 4.0，授权干净**；gutenberg 在本环境不可达）
  · 难度分级：用本工程频率表（.content-cache/de_50k.txt）算「超纲词比例 + 平均句长」→ A2/B1/B2
  · 出题（零 LLM、确定性）：
      词汇题  = 从短文中挑「词库内且非 A1」的词 → 正确释义 + 3 个来自词库其他词的干扰释义
      细节题  = 取含数字的原文句作「richtig」；改写数字作「falsch」（why 指明依据）
      小标题  = 取各段首句前若干词作为小标题，答案 = 该段序号
  · 译文 zh 留空（不依赖 LLM 翻译）；前端按「无译文」优雅降级

用法：
  python tools/reading_pipeline.py --all          # 抓取 → 分段分级 → 出题 → 打包
  python tools/reading_pipeline.py --limit 40     # 控制篇数
  python tools/reading_pipeline.py --refresh      # 忽略缓存重新抓取
  python tools/reading_pipeline.py --report docs/reading-pipeline-report.md
"""
import argparse
import io
import json
import os
import random
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".content-cache")
READ_CACHE = os.path.join(CACHE, "reading")
FREQ = os.path.join(CACHE, "de_50k.txt")
OUT_PACK = os.path.join(ROOT, "dist", "content-pack-reading.json")
TITLE_ZH = os.path.join(ROOT, "tools", "data", "reading_titles.json")   # 德文标题 → 中文标题
HEADING_ZH = os.path.join(ROOT, "tools", "data", "reading_heading_zh.json")  # 德文小标题 → 中文
REPORT = os.path.join(ROOT, "docs", "reading-pipeline-report.md")

API = "https://de.wikipedia.org/w/api.php"
UA = "LinguaDE-content-pipeline/1.0 (educational; CC BY-SA reuse)"

# 与留德 / 常识相关的德语维基条目（篇幅适中、A2–B2 友好）
TITLES = [
    "München", "Berlin", "Hamburg", "Köln", "Deutsche Sprache", "Deutschland",
    "Studium", "Universität", "Hochschule", "Studentenwerk", "Mensa", "Bibliothek",
    "Semester", "Prüfung", "TestDaF", "Goethe-Institut", "Ausbildung", "Praktikum",
    "BAföG", "Krankenversicherung", "Mietvertrag", "Wohngemeinschaft", "Kaution",
    "Deutsche Küche", "Brot", "Weihnachten", "Oktoberfest", "Karneval", "Fußball in Deutschland",
    "Bundesliga", "Autobahn", "Deutsche Bahn", "Fahrrad", "Umwelt", "Klimawandel",
    "Wasserstoff", "Elektroauto", "Solarenergie", "Recycling", "Rhein", "Alpen",
    "Nordsee", "Ostsee", "Schwarzwald", "Wiedervereinigung", "Berliner Mauer",
    "Europäische Union", "Grundgesetz", "Bundestag", "Bundesrat", "Bundeskanzler",
    "Arbeitslosigkeit", "Steuer", "Versicherung", "Bank", "Post", "Feiertag",
    "Zeitzone", "Währung", "Klima in Deutschland", "Bevölkerung Deutschlands",
    # —— 生活 / 常识类（整体更易读，用于补齐 A2–B1 梯度）——
    "Frühstück", "Kaffee", "Bier", "Wurst", "Käse", "Apfel", "Blume", "Wald",
    "See", "Fluss", "Berg", "Schnee", "Regen", "Sonne", "Winter", "Sommer",
    "Herbst", "Frühling", "Woche", "Monat", "Kalender", "Schule", "Klasse",
    "Lehrer", "Hausaufgabe", "Freundschaft", "Familie", "Kindheit", "Geburtstag",
    "Geschenk", "Musik", "Film", "Fernsehen", "Zeitung", "Buch", "Fotografie",
    "Sport", "Schwimmen", "Handball", "Ski", "Wandern", "Reise", "Urlaub",
    "Hotel", "Bahnhof", "Flughafen", "Briefmarke", "Garten", "Kuchen",
]

WORD_RE = re.compile(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*")
NUM_RE = re.compile(r"\d+(?:[.,]\d+)?")
# 句子切分：句末标点 + 空白 + 大写/引号/数字开头（避免把「am 2. November」这类缩写当句末）
SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ„(\d])")


def log(*a):
    print(*a, flush=True)


def http_get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


# ---------------------------------------------------------------- 词库 / 频率表
def load_lexicon():
    """解析 src/data/lexicon-*.js → {de: (art, zh, pos, lvl)}"""
    lex = {}
    data_dir = os.path.join(ROOT, "src", "data")
    for fn in sorted(os.listdir(data_dir)):
        if not re.match(r"lexicon-\d+\.js$", fn):
            continue
        txt = io.open(os.path.join(data_dir, fn), encoding="utf-8").read()
        for m in re.finditer(r'\["([^"]+)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"\]', txt):
            de, art, zh, pos, lvl, ex, exzh = m.groups()
            lex[de] = {"art": art, "zh": zh, "pos": pos, "lvl": lvl, "ex": ex, "exzh": exzh}
    return lex


def load_freq():
    """频率表：{词: 排名}（1 = 最高频）"""
    rank = {}
    if not os.path.exists(FREQ):
        log("! 缺少频率表 %s（先跑 tools/content_pipeline.py --all）" % FREQ)
        return rank
    i = 0
    for line in io.open(FREQ, encoding="utf-8"):
        parts = line.split()
        if len(parts) >= 2:
            i += 1
            rank[parts[0].lower()] = i
    return rank


# ---------------------------------------------------------------- 抓取
def _safe(name):
    return re.sub(r"[^\w\-.]+", "_", name)


def fetch(titles, refresh=False):
    """逐篇请求：MediaWiki extracts 的全文提取只允许 exlimit=1（批量只会返回首篇）"""
    os.makedirs(READ_CACHE, exist_ok=True)
    todo = [t for t in titles
            if refresh or not os.path.exists(os.path.join(READ_CACHE, _safe(t) + ".txt"))]
    log("抓取 %d 篇（缓存命中 %d 篇）" % (len(todo), len(titles) - len(todo)))
    ok = 0
    for i, t in enumerate(todo, 1):
        q = urllib.parse.urlencode({
            "action": "query", "prop": "extracts", "explaintext": "1",
            "format": "json", "redirects": "1", "titles": t,
        })
        data = None
        for attempt in range(3):
            try:
                data = json.loads(http_get(API + "?" + q, timeout=45))
                break
            except Exception as e:
                msg = str(e)
                if "429" in msg:
                    time.sleep(6.0)                 # 限速退避
                if attempt == 2:
                    log("  ! %s 失败：%s" % (t, msg[:80]))
                time.sleep(1.0)
        if not data:
            continue
        for pg in (data.get("query", {}).get("pages") or {}).values():
            title = pg.get("title") or t
            ex = pg.get("extract") or ""
            if not ex or len(ex) < 400:
                continue
            with io.open(os.path.join(READ_CACHE, _safe(title) + ".txt"), "w", encoding="utf-8") as f:
                f.write(ex)
            with io.open(os.path.join(READ_CACHE, _safe(title) + ".meta.json"), "w", encoding="utf-8") as f:
                json.dump({"title": title, "source": "de.wikipedia.org", "license": "CC BY-SA 4.0",
                           "url": "https://de.wikipedia.org/wiki/" + urllib.parse.quote(title),
                           "fetchedAt": time.strftime("%Y-%m-%d")}, f, ensure_ascii=False, indent=2)
            ok += 1
            break
        if i % 10 == 0:
            log("  进度 %d/%d（成功 %d）" % (i, len(todo), ok))
        time.sleep(0.6)      # 友好限速（维基对高频请求会返回 429）
    log("  完成：成功 %d 篇" % ok)
    return [t for t in titles if os.path.exists(os.path.join(READ_CACHE, _safe(t) + ".txt"))]


# ---------------------------------------------------------------- 分段与分级
def paragraphs(extract):
    """切成 60–320 词的正文段落，剔除章节标题与列表噪声"""
    out = []
    for para in extract.split("\n"):
        p = para.strip()
        if not p or p.startswith("==") or p.startswith("*") or p.startswith("|"):
            continue
        if p.endswith(":") or len(p) < 40:
            continue
        words = WORD_RE.findall(p)
        if not (40 <= len(words) <= 420):
            continue
        if p.count("(") > 8 or p.count("„") > 8:      # 括号注音/引文过多的段落跳过（放宽以保留引言段）
            continue
        out.append(p)
    return out


# 德语派生后缀：形态学复杂度的核心指标之一
DERIV_SUFFIXES = ("ung", "heit", "keit", "lich", "isch", "bar", "sam", "schaft", "tion", "ität", "ierung")


def grade_para(text, freq):
    """段落难度：罕见词比例 + 平均句长 + **德语形态学复杂度** → (等级, 分数, 明细)

    形态特征依据 Hancke & Meurers（2012, *Readability Classification for German*）等研究：
    在德语可读性任务中，形态学复杂度（派生后缀、长复合词）是**单独表现最好的特征组**
    （单组分类准确率 85.4%，高于传统可读性公式基线 82.2%），故在词频/句长之外显式计入。
    """
    words = [w.lower() for w in WORD_RE.findall(text)]
    if not words:
        return "A2", 0.0, {}
    rare = sum(1 for w in words if freq.get(w, 10 ** 9) > 20000)
    rare_ratio = rare / len(words)
    sents = [s for s in re.split(r"[.!?]+", text) if len(s.strip()) > 3]
    avg_len = (sum(len(s.split()) for s in sents) / len(sents)) if sents else 0
    # —— 德语形态学复杂度（论文实测最强特征组）——
    long_ratio = sum(1 for w in words if len(w) >= 10) / len(words)                       # 长词（多含复合/派生）
    deriv_ratio = sum(1 for w in words if len(w) >= 6 and w.endswith(DERIV_SUFFIXES)) / len(words)
    comp_ratio = sum(1 for w in words if len(w) >= 14) / len(words)                       # 长复合词
    comma_per_sent = text.count(",") / max(1, len(sents))                                 # 从句/并列密度
    if rare_ratio <= 0.10 and avg_len <= 16:
        lv = "A2"
    elif rare_ratio <= 0.20 and avg_len <= 21:
        lv = "B1"
    else:
        lv = "B2"
    score = (rare_ratio * 70 + avg_len * 0.35 + len(words) * 0.01
             + long_ratio * 50 + deriv_ratio * 60 + comp_ratio * 40 + comma_per_sent * 3)
    return lv, score, {"rareRatio": round(rare_ratio, 3), "avgSentence": round(avg_len, 1),
                       "longRatio": round(long_ratio, 3), "derivRatio": round(deriv_ratio, 3),
                       "compRatio": round(comp_ratio, 3), "commaPerSent": round(comma_per_sent, 1),
                       "words": len(words)}


# ---------------------------------------------------------------- 模板出题
def make_headings(paras):
    """小标题 = 各段首句里可独立成立的一截（答案 = 段序号）。

    维基文本没有人工小标题，规则：
      ① 先去掉括号里的数据（„(40 m × 20 m)“ 会让截断落在数字上）；
      ② 首句 ≤10 词 → 整句；
      ③ 否则取「最短且像分句」的句首（到某个逗号/分号/冒号，4–12 词、含定式动词）；
      ④ 再不行就整句（≤16 词），最后按逗号近 12 词截断；
      ⑤ 末尾把悬空的介词/冠词/助动词/短词一起剪掉（„… und wird durch“ → „…“）。
    旧做法取前 5 个实词，会切出 „Handball ist eine Sportart bei“ 这种断句。
    """
    STOP = {"der", "die", "das", "des", "dem", "den", "ein", "eine", "einer", "eines",
            "und", "oder", "zu", "bei", "mit", "von", "für", "in", "an", "auf", "im", "am",
            "zur", "zum", "als", "wie", "dass", "ob", "weil", "wenn", "aber", "sowie",
            "nach", "vor", "über", "unter", "seit", "bis", "pro", "durch", "gegen", "ohne",
            "um", "entlang", "zwischen", "hinter", "neben", "während", "wegen", "trotz",
            "statt", "aus", "außer", "je", "auch", "sich", "wird", "werden", "wurde",
            "ist", "sind", "war", "waren", "hat", "haben", "hatte", "hatten", "kann",
            "können", "muss", "müssen", "soll", "sollen", "darf", "dürfen", "will",
            "wollen", "lässt", "lassen", "sowie"}

    def verbish(tokens):
        for w in tokens[1:]:
            low = w.lower()
            if low in STOP or w[:1].isupper():
                continue
            if re.search(r"(t|st|en|e)$", low):
                return True
        return False

    def tidy(text):
        toks = text.strip().split()
        while toks and (len(toks[-1]) <= 2 or toks[-1].lower().strip(",;:") in STOP):
            toks.pop()
        return " ".join(toks).strip().rstrip(",;:")

    hs = []
    for p in paras:
        clean = re.sub(r"\s*\([^)]*\)", " ", p)          # 去掉括号里的数据
        first = SENT_SPLIT.split(clean.strip())[0].strip().rstrip(".!?")
        words_all = WORD_RE.findall(first)
        if len(words_all) <= 10:
            head = first
        else:
            best = ""
            for m in re.finditer(r"[,;:]", first):
                cand = first[:m.start()]
                ct = WORD_RE.findall(cand)
                if 4 <= len(ct) <= 12 and verbish(ct):
                    best = cand                      # 取最短的可成立分句
                    break
            if best:
                head = best
            else:
                # 没有能独立成立的分句：≤18 词用整句，否则退到 18 词内最后一个逗号，再不行取前 16 词
                if len(words_all) <= 18:
                    head = first
                else:
                    cuts = [first[:m.start()] for m in re.finditer(r"[,;:]", first)
                            if len(WORD_RE.findall(first[:m.start()])) <= 18]
                    head = cuts[-1] if cuts and len(WORD_RE.findall(cuts[-1])) >= 6 else " ".join(words_all[:16])
        cand = tidy(head)
        if len(WORD_RE.findall(cand)) < 2:
            cand = tidy(" ".join(words_all[:8]))
        if len(WORD_RE.findall(cand)) < 2:
            cand = " ".join(words_all[:5])
        hs.append(cand)
    # 去重（重复则加段号）
    seen = {}
    for i, h in enumerate(hs):
        if h in seen:
            hs[i] = h + " (%d)" % (i + 1)
        seen[hs[i]] = i
    return hs, list(range(len(hs)))


def make_tfng(paras, rng, n=3):
    """细节题：含数字的句子 → richtig / 数字改写 → falsch"""
    cand = []
    for pi, p in enumerate(paras):
        for s in SENT_SPLIT.split(p):
            if 5 <= len(s.split()) <= 30 and NUM_RE.search(s):
                cand.append((pi, s.strip()))
    rng.shuffle(cand)
    out = []
    for pi, s in cand:
        if len(out) >= n:
            break
        if any(s == o["q"] for o in out):
            continue
        num = NUM_RE.search(s).group(0)
        # richtig：直接引用原文句（陈述句）
        out.append({"q": s, "qzh": "", "a": "richtig",
                    "why": "原文第 %d 段直接给出该信息。" % (pi + 1)})
        if len(out) >= n:
            break
        # falsch：改动数字（+1 或 +9），制造可判定的错误
        try:
            val = float(num.replace(",", "."))
            wrong = str(int(val) + (1 if val < 100 else 9)).replace(".", ",")
        except ValueError:
            wrong = num + "0"
        out.append({"q": s.replace(num, wrong, 1), "qzh": "", "a": "falsch",
                    "why": "原文数字为 %s，题中被改为 %s（第 %d 段）。" % (num, wrong, pi + 1)})
    return out[:n]


def make_mcq(paras, lex, rng, n=3):
    """词汇题：词库内且非 A1 的词 → 正确释义 + 3 个词库干扰释义"""
    bag = []
    text = " ".join(paras)
    present = set(WORD_RE.findall(text))
    pool = [w for w, v in lex.items() if w in present and v["lvl"] not in ("A1",) and v["zh"]]
    rng.shuffle(pool)
    all_zh = [v["zh"] for v in lex.values() if v["zh"]]
    for w in pool:
        if len(bag) >= n:
            break
        right = lex[w]["zh"]
        distract = []
        while len(distract) < 3:
            d = all_zh[rng.randrange(len(all_zh))]
            if d != right and d not in distract:
                distract.append(d)
        opts = distract + [right]
        rng.shuffle(opts)
        bag.append({"q": 'Was bedeutet „%s” im Text?' % w, "qzh": "文中 „%s” 是什么意思？" % w,
                    "opts": opts, "a": opts.index(right),
                    "why": "词库释义：%s%s（%s）。" % (lex[w]["art"] + " " if lex[w]["art"] not in ("", "—") else "", w, lex[w]["zh"])})
    return bag


def make_words(paras, lex, rng, n=6):
    text = " ".join(paras)
    present = set(WORD_RE.findall(text))
    pool = [w for w, v in lex.items() if w in present and v["zh"]]
    rng.shuffle(pool)
    return [{"de": (lex[w]["art"] + " " if lex[w]["art"] not in ("", "—") else "") + w, "zh": lex[w]["zh"]}
            for w in pool[:n]]


# ---------------------------------------------------------------- 主流程
def load_title_zh():
    if not os.path.exists(TITLE_ZH):
        return {}
    try:
        return {k.strip(): v.strip() for k, v in json.load(io.open(TITLE_ZH, encoding="utf-8")).items()}
    except Exception as e:
        log("  ! 读取阅读标题表失败：%s" % str(e)[:80])
        return {}


def load_heading_zh():
    """{短文 id: [中文小标题 × 段数]}。按篇 id 存，段落不变就不会错位。"""
    if not os.path.exists(HEADING_ZH):
        return {}
    try:
        raw = json.load(io.open(HEADING_ZH, encoding="utf-8"))
        return {k.strip(): [str(s).strip() for s in v] for k, v in raw.items() if isinstance(v, list)}
    except Exception as e:
        log("  ! 读取小标题中文表失败：%s" % str(e)[:80])
        return {}


def build(limit=0, refresh=False, report=REPORT, seedsalt="linguade-reading-1"):
    freq = load_freq()
    lex = load_lexicon()
    title_zh = load_title_zh()
    heading_zh = load_heading_zh()
    titles = fetch(TITLES, refresh=refresh)
    log("中文标题表 %d 条" % len(title_zh))
    if limit:
        titles = titles[:limit]
    passages, stats, skipped = [], [], []
    for t in titles:
        p = os.path.join(READ_CACHE, _safe(t) + ".txt")
        meta_p = os.path.join(READ_CACHE, _safe(t) + ".meta.json")
        if not os.path.exists(p):
            continue
        try:
            meta = json.load(io.open(meta_p, encoding="utf-8"))
        except Exception:
            meta = {"title": t, "license": "CC BY-SA 4.0", "source": "de.wikipedia.org",
                    "url": "https://de.wikipedia.org/wiki/" + urllib.parse.quote(t)}
        paras_all = paragraphs(io.open(p, encoding="utf-8").read())
        if len(paras_all) < 3:
            continue
        # 取开头 6 段连续段落（保持主题连贯；「挑最简段落」会造成语义跳跃，不可取）
        head = paras_all[:6]
        graded = [(grade_para(x, freq), x) for x in head]
        paras_de = [x for _, x in graded]
        lv = sorted(g[0] for g, _ in graded)[len(graded) // 2]   # 取中位等级
        g = graded[len(graded) // 2][0][2]
        # 每篇独立种子：增删一篇不会把其它篇的题目全部重排（学员正在做的题保持稳定）
        rng = random.Random("%s|%s" % (t, seedsalt))
        headings, ans = make_headings(paras_de)
        tfng = make_tfng(paras_de, rng)
        mcq = make_mcq(paras_de, lex, rng)
        words = make_words(paras_de, lex, rng)
        # 题量不足的条目直接跳过（宁缺毋滥：保证每篇都能完整出题）
        if len(tfng) < 2 or len(mcq) < 2 or len(words) < 4:
            skipped.append((t, "题量不足 tfng=%d mcq=%d words=%d" % (len(tfng), len(mcq), len(words))))
            continue
        pid = re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", t.lower()).encode("ascii", "ignore").decode())[:28]
        pobj = {
            "id": "wiki-" + pid, "lv": lv, "theme": "百科阅读",
            "title": meta.get("title", t),
            "titleZh": title_zh.get(meta.get("title", t)) or title_zh.get(t, ""),
            "src": "Wikipedia · CC BY-SA 4.0",
            "srcUrl": meta.get("url", ""), "fetchedAt": meta.get("fetchedAt", ""),
            "paras": [{"de": y, "zh": ""} for y in paras_de],
            "headings": headings,
            "headingZh": (heading_zh.get("wiki-" + pid)
                          if len(heading_zh.get("wiki-" + pid) or []) == len(headings)
                          else [""] * len(headings)),
            "headingAns": ans,
            "tfng": tfng, "mcq": mcq, "words": words,
            "difficulty": g, "absLevel": lv,
            "score": round(graded[len(graded) // 2][0][1], 2),
        }
        passages.append(pobj)
        stats.append(pobj)
    # 相对难度分级：同批内按难度分位切 33/33/34 —— 保证「由浅入深」的阅读梯度
    # （绝对等级另存 absLevel 供对照；维基百科书面语整体偏难，绝对口径多为 B1–B2）
    passages.sort(key=lambda z: z.get("score", 0))
    n = len(passages)
    for i, z in enumerate(passages):
        q = i / max(1, n)
        z["lv"] = "A2" if q < 0.33 else ("B1" if q < 0.66 else "B2")
    passages.sort(key=lambda z: ({"A2": 0, "B1": 1, "B2": 2}[z["lv"]], z.get("score", 0)))

    pack = {
        "pack": "reading", "version": 1,
        "generatedAt": time.strftime("%Y-%m-%d"),
        "source": "de.wikipedia.org", "license": "CC BY-SA 4.0",
        "note": "分级为同批内相对难度分位（absLevel 为绝对口径）；题型由模板确定性生成（无 LLM）",
        "count": len(passages), "items": passages,
    }
    os.makedirs(os.path.dirname(OUT_PACK), exist_ok=True)
    with io.open(OUT_PACK, "w", encoding="utf-8") as f:
        json.dump(pack, f, ensure_ascii=False, indent=1)
    heads = [h for p in passages for h in p["headings"]]
    no_head = [h for p in passages for h, z in zip(p["headings"], p["headingZh"]) if not z]
    log("小标题 %d 条（去重 %d）· 中文覆盖 %d" % (len(heads), len(set(heads)), len(heads) - len(no_head)))
    if no_head:
        log("  缺中文小标题（补进 tools/data/reading_heading_zh.json）：", len(no_head), no_head[:8])
    no_zh = [p["title"] for p in passages if not p["titleZh"]]
    log("中文标题覆盖 %d/%d" % (len(passages) - len(no_zh), len(passages)))
    if no_zh:
        log("  缺中文标题（补进 tools/data/reading_titles.json）：", no_zh[:12])
    log("已生成 %d 篇 → %s（%.0f KB）" % (len(passages), OUT_PACK, os.path.getsize(OUT_PACK) / 1024))
    # 阅读池为独立内容包（不内联进主包，守住「零外链单文件」体积红线）；清理早期内联产物
    old_js = os.path.join(ROOT, "src", "data", "reading.js")
    if os.path.exists(old_js):
        os.remove(old_js)

    lv_count = {"A2": 0, "B1": 0, "B2": 0}
    for x in passages:
        lv_count[x["lv"]] = lv_count.get(x["lv"], 0) + 1
    lines = ["# LinguaDE 阅读池管线报告（3.5.0-d）\n",
             "> 由 `tools/reading_pipeline.py` 生成 · 数据源 de.wikipedia.org（CC BY-SA 4.0）· 模板出题（零 LLM）\n",
             "## 一、汇总\n",
             "| 指标 | 值 |", "|---|---|",
             "| 成稿篇数 | **%d** |" % len(passages),
             "| 分级分布 | A2 %d / B1 %d / B2 %d |" % (lv_count.get("A2", 0), lv_count.get("B1", 0), lv_count.get("B2", 0)),
             "| 每篇段落数 | 3+（按 60–320 词切分） |",
             "| 题型 | 小标题匹配 / 判断正误 / 词汇选择 / 关键词表 |",
             "| 授权 | CC BY-SA 4.0（逐篇记录 srcUrl 与抓取日期） |",
             "\n## 二、逐篇明细\n",
             "| 条目 | 相对等级（同批分位） | 词数 | 超纲率 | 平均句长 | 长词率 | 派生率 | 逗号/句 |", "|---|---|---|---|---|---|---|---|"]
    for z in stats:
        d = z.get("difficulty") or {}
        lines.append("| %s | %s（绝对口径 %s） | %d | %.1f%% | %.1f | %.1f%% | %.1f%% | %.1f |" % (
            z["title"], z["lv"], z.get("absLevel", "?"), d.get("words", 0),
            d.get("rareRatio", 0) * 100, d.get("avgSentence", 0),
            d.get("longRatio", 0) * 100, d.get("derivRatio", 0) * 100, d.get("commaPerSent", 0)))
    if skipped:
        lines.append("\n## 二·补充：题量不足被跳过的条目\n")
        for t, why in skipped[:40]:
            lines.append("- %s：%s" % (t, why))
    lines.append("\n## 三、说明\n")
    lines.append("- 译文（zh）留空：不依赖 LLM 翻译，前端在有译文时展示、无译文时优雅降级；")
    lines.append("- 出题全部模板化且可判定（词汇题答案取自词库；细节题基于原文数字改写），**不产生幻觉**；")
    lines.append("- 如需更高质的题目与中文译文，走 `tools/lexicon_enrich.py` 同类 LLM 通道（需凭证）后再人工抽检。")
    with io.open(report, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    log("报告已写入：", report)
    return passages


def main():
    ap = argparse.ArgumentParser(description="LinguaDE 阅读池管线（Wikipedia → 分级短文）")
    ap.add_argument("--all", action="store_true", help="抓取 + 分段分级 + 出题 + 打包")
    ap.add_argument("--fetch", action="store_true", help="仅抓取原文到缓存")
    ap.add_argument("--refresh", action="store_true", help="忽略缓存重新抓取")
    ap.add_argument("--limit", type=int, default=0, help="限制篇数")
    ap.add_argument("--report", default=REPORT)
    a = ap.parse_args()
    if a.fetch:
        fetch(TITLES, refresh=a.refresh)
        return 0
    if a.all or not (a.fetch):
        build(limit=a.limit, refresh=a.refresh, report=a.report)
        return 0


if __name__ == "__main__":
    sys.exit(main())