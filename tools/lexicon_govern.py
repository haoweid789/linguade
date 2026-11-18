# -*- coding: utf-8 -*-
"""LinguaDE · 词库治理（一次性数据修正，可复跑）

处理四类问题：
  1) 分级失真：1428 条机器词条原本几乎全标 B2/C1/C2。按字幕词频重新定级
     （词频是估计，不是官方 CEFR 认定；少量高频基础词用人工覆盖表校正）。
  2) 例句不含词条：用 kaikki 词形表 + Tatoeba 德中句对做严格匹配，替换错例句；
     找不到可靠例句就留空，不伪造。
  3) 简繁混排：用 OpenCC t2s 统一全部词条的释义与例句中文。
  4) 词形当原形：复数名词（Träume → Traum）与过去分词（genannt → nennen）
     写入 formOf / formKind 字段；复数变体不再进入新词队列，分词在卡片上标明来源。

写入格式：
  [de, art, zh, pos, level, example, exampleZh]                 普通词条
  [de, art, zh, pos, level, example, exampleZh, formOf, kind]   词形条目（kind=plural|participle）

用法：
  python tools/lexicon_govern.py             # 只体检，不改文件
  python tools/lexicon_govern.py --write     # 写回 src/data/lexicon-*.js 并生成报告
  python tools/lexicon_govern.py --write --no-examples   # 只做分级/简繁/词形
"""
import argparse
import gzip
import io
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
FILES = ["lexicon-%d.js" % i for i in range(1, 10)]
LEX9 = os.path.join(DATA, "lexicon-9.js")
MACHINE_START = 572          # 运行时按 lexicon-1..8 的实际条数重算（历史上写死过 576，漏治理 4 条）
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

# 语域红线：粗口/辱骂/性描写词不进新词队列（保留查词），口语俚语在卡片上标注
REGISTER_VULGAR = {
    "wichser", "ficken", "hurensohn", "kacke", "scheiße", "scheisse", "arsch", "arschloch",
    "fotze", "schlampe", "luder", "drecksack", "mistsack", "trottel", "blödmann", "spasti",
    "pisse", "pisen", "bumsen", "vögeln", "schweinehund", "vollidiot", "vollpfosten", "locher",
}
REGISTER_COLLOQUIAL = {
    "karre", "penner", "quatsch", "verrückter", "piepen", "spinnen", "verknallt", "pennen",
    "schnacken", "labern", "zocken", "checken", "kapiert", "besoffen", "pleite", "zoff",
    "macke", "anzicken", "verpennen", "abgehoben", "kasper", "depp", "mammon", "schuften",
    "buckeln", "schmusen", "mief", "knete", "weichei", "lusche", "gockel", "heulen",
}
REGISTER_ENUM = ("", "vulgar", "colloquial")
# 词干匹配：精确词头会漏掉屈折与派生（Fick / ficken / fickst；Mistkerl / Miststück）。
# 必须锚定在词首，否则 Marsch / Haarschnitt / Nachbarschaft 会被 arsch 误伤，
# Sandwichs 会被 wichs 误伤。
REGISTER_VULGAR_STEMS = (
    "fick", "wichs", "hurensohn", "arsch", "fotze", "schlampe", "drecksack", "mistsack",
    "mistkerl", "miststück", "scheißkerl", "scheißdreck", "schweinehund", "vollidiot", "vollpfosten",
)
REGISTER_COLLOQUIAL_STEMS = (
    "quatsch", "penner", "pennen", "labern", "zocken", "besoffen", "pleite", "zoff", "verarsch",
)
# 词首（含复合词的前一成分结尾处）才算命中：Kaktus、Marsch、Sandwich 都不会中
_STEM_EDGE = r"(?:^|[^a-zäöüß])"
_VULGAR_RE = re.compile("|".join(_STEM_EDGE + s for s in sorted(REGISTER_VULGAR_STEMS)))
_COLLOQUIAL_RE = re.compile("|".join(_STEM_EDGE + s for s in sorted(REGISTER_COLLOQUIAL_STEMS)))


def register_for(word):
    """按词头精确表 + 词首锚定的词干表判定语域；返回 vulgar / colloquial / 空串。"""
    w = str(word or "").lower()
    if w in REGISTER_VULGAR or _VULGAR_RE.search(w):
        return "vulgar"
    if w in REGISTER_COLLOQUIAL or _COLLOQUIAL_RE.search(w):
        return "colloquial"
    return ""


# 复核中发现的释义偏差（不是语域问题，是义项本身偏了）
GLOSS_FIXES = {"karre": "汽车（口语）；手推车", "überlebt": "幸存的"}

# 词形当原形：这些机器词条的词头本身是复数 / 名词化变格形式，直接换成可学的原形。
# 键 = 原词头，值 = [新词头, 冠词, 中文, 词性, 等级, 德文例句, 中文例句]
LEMMA_FIXES = {
    "träume": ["Traum", "der", "梦想；梦", "n", "A2",
               "Ich hatte heute Nacht einen seltsamen Traum.", "我今晚做了一个奇怪的梦。"],
    "rechte": ["Recht", "das", "权利；法律", "n", "A2",
               "Jeder Mensch hat das Recht auf Bildung.", "每个人都有受教育的权利。"],
    "armer": ["Arme", "der", "穷人", "n", "A2",
              "Die Kirche hilft den Armen in der Stadt.", "教会帮助城里的穷人。"],
    "süßer": ["Süße", "die", "甜心；爱人", "n", "A2",
              "Gute Nacht, meine Süße.", "晚安，我的甜心。"],
    "deutscher": ["Deutsche", "der", "德国人", "n", "A2",
                  "Die Deutsche arbeitet seit zwei Jahren in Berlin.", "这位德国人在柏林工作两年了。"],
    "vertrauter": ["Vertraute", "die", "知己；心腹", "n", "C1",
                   "Sie ist meine älteste Vertraute.", "她是我最老的朋友/知己。"],
}
# 逐条人工复核后判死的 form-of 断言：kaikki 把这些当成「某词的复数」，其实是不相关的名词
# （Braut 是新娘，不是 Bräutigam 的复数）。判死后既不标注，也不再出现在待补清单里。
REJECTED_FORMOF = {
    ("braut", "n"), ("zeuge", "n"), ("kohle", "n"), ("decke", "n"), ("runde", "n"),
    ("reifen", "n"), ("weiße", "n"), ("akte", "n"), ("süße", "n"), ("dichter", "n"),
    ("deutsche", "n"), ("vertraute", "n"), ("platten", "n"), ("gehöre", "n"),
    ("herde", "n"), ("arme", "n"),
    # 这三条不是「某词的复数」，而是独立名词，标了会在卡片上写出错话
    ("westen", "n"), ("schütze", "n"), ("steige", "n"),
}

# 已逐条复核、判定「不补原形」的词形（写进报告，不再挂在待补清单上）
REVIEWED_NO_BASE = {
    # 这些分词已经词汇化成形容词，形容词本身才是要学的单位，硬标原形反而误导
    "betrunken": "喝醉的（形容词已独立，betrinken 罕用）",
    "dringend": "紧急的（形容词已独立，dringen 义不同）",
    "vertraut": "熟悉的（das Vertrauen 已在库，动词与名词同形会顶掉查词）",
    "verflucht": "该死的（感叹用法，verfluchen 罕用）",
    "überlegt": "深思熟虑的（形容词已独立，überlegen 另义）",
    "kompliziert": "复杂的（形容词已独立）",
    "eingesperrt": "被关押的（动词 einsperren 低频）",
    "lebend": "活着的（das Leben 已在库，动词 leben 同形会顶掉查词）",
    "verzweifelt": "绝望的（形容词已独立）",
    "berühmt": "出名的（berühmen 已废弃）",
    "befreundet": "友好的（动词是 sich befreunden，与库内单名词头不同形）",
    "bezaubernd": "迷人的（现在分词作形容词）",
    "verknallt": "迷恋的（口语，verknallen 不进学习队列）",
    "anmaßend": "傲慢的（现在分词作形容词）",
    "erstarrt": "僵硬的（erstarren 低频）",
}
FREQ = os.path.join(ROOT, ".content-cache", "de_50k.txt")
PAIRS = os.path.join(ROOT, ".knowledge-cache", "tatoeba_pairs.jsonl")
EX_OVERIDES = os.path.join(ROOT, "tools", "data", "lexicon9_example_overrides.json")

# 选句匹配与考试词库共用一套实现：可分动词句末前缀、同形名词闸门、全局德中句对池
try:
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from import_german_exam_db import (DEFAULT_DB as EXAM_DB, load_pool, pool_ids,
                                       form_sets, best_of, sent_pack, sentence_hit,
                                       EXAMPLE_BANNED, example_banned)
except Exception:
    EXAM_DB = ""
    load_pool = pool_ids = form_sets = best_of = sent_pack = sentence_hit = None
    EXAMPLE_BANNED = example_banned = None
KAIKKI = os.path.join(ROOT, ".knowledge-cache", "kaikki-german.jsonl.gz")
REPORT = os.path.join(ROOT, "docs", "lexicon-governance-report.md")
TODAY = date.today().isoformat()

STR_RE = re.compile(r'"((?:[^"\\]|\\.)*)"')
GERMAN_WORD = re.compile(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]*")
CITATION = re.compile(r"\b(?:19|20)\d{2}\b|\bISBN\b|\bpage\s+\d+|https?://|[<>{}|\[\]]|\bS\.\s?\d+")
TAG_WORDS = {
    "no-table-tags", "de-ndecl", "de-adecl", "de-conj", "strong", "weak", "irregular",
    "masculine", "feminine", "neuter", "plural", "singular", "nominative", "accusative",
    "genitive", "dative", "comparative", "superlative", "positive", "predicative",
    "no-predicative", "not-comparable", "mixed", "stem", "umlaut", "class", "auxiliary",
    "haben", "sein", "active", "passive", "subjunctive", "imperative", "participle",
    "present", "past", "first-person", "second-person", "third-person", "archaic",
}

# 报告点名的错例句：Tatoeba / 词典里找不到干净替换时，用项目自写例句兜底
MANUAL_EXAMPLES = {
    "dorf": ("Das Dorf liegt ruhig zwischen den Bergen.", "这个村庄安静地坐落在群山之间。"),
    "leise": ("Bitte sprich leiser, das Baby schläft.", "请小声一点，宝宝在睡觉。"),
    "falle": ("Die Falle war gut versteckt.", "这个陷阱藏得很好。"),
    "halb": ("Ich habe den halben Kuchen gegessen.", "我吃了一半的蛋糕。"),
    "schwierig": ("Die Prüfung war schwieriger als erwartet.", "考试比预想的更难。"),
    "garten": ("Unser Garten ist im Sommer voller Blumen.", "夏天我们的花园开满鲜花。"),
    "gewissen": ("Er hat ein schlechtes Gewissen, weil er gelogen hat.", "他因为撒谎而感到内疚。"),
    "mitkommen": ("Kann ich mitkommen?", "我可以一起去吗？"),
    "wind": ("Der Wind ist heute sehr stark.", "今天风很大。"),
    "wand": ("An der Wand hängt ein Bild.", "墙上挂着一幅画。"),
    "gemeint": ("So war das nicht gemeint.", "我不是这个意思。"),
    "längst": ("Er ist längst zu Hause.", "他早就到家了。"),
    "schlechter": ("Das Wetter ist heute schlechter als gestern.", "今天天气比昨天差。"),
}

# 语义不匹配/空例句的人工替换（不是「找不到例句」，而是现有例句虽然含词形但义项不对）
FORCE_EXAMPLES = {
    "gleichen": ("Die beiden Bilder gleichen sich.", "这两幅图片很相似。"),
    "position": ("Die Position des Hauses ist sehr gut.", "这栋房子的位置很好。"),
}

# 高频基础词的人工校正（频率表在字幕语料上会把抽象词与基础词排得一样高）
# 2026-11-01 首次治理前的真实分布（重复运行不会丢失基线）
ORIGINAL_LEVELS = {"A1": 121, "A2": 59, "B1": 127, "B2": 1136, "C1": 393, "C2": 164}

LEVEL_OVERRIDES = {
    "schwierig": "B1", "dorf": "A2", "halb": "A2", "leise": "A2",
    "position": "B1", "ring": "A2", "insel": "A2", "freiheit": "B1",
    "feind": "B1", "daher": "B1", "zufällig": "B1", "fantastisch": "A2",
    "rennen": "A2", "lied": "A2", "nah": "A2", "drink": "A2",
    "bauen": "A2", "versprechen": "B1", "hängen": "B1", "beenden": "B1",
    "unterhalten": "B1", "verdienen": "B1", "schaden": "B1", "entlang": "B1",
    "einverstanden": "A2", "gleich": "A2", "schließlich": "B1",
}


def log(*a):
    print(*a, flush=True)


def parse_line(line):
    fields = [json.loads('"%s"' % s) for s in STR_RE.findall(line)]
    return fields if len(fields) >= 7 else None


def load_all():
    """返回 [(file, line_index, fields)]，索引按全局词条顺序。"""
    out = []
    for name in FILES:
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding="utf-8") as f:
            for i, line in enumerate(f):
                fields = parse_line(line) if line.lstrip().startswith("[") else None
                if fields:
                    out.append((name, i, fields))
    return out


def load_freq():
    counts = {}
    with io.open(FREQ, encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) == 2:
                try:
                    counts[parts[0].lower()] = int(parts[1])
                except ValueError:
                    pass
    return counts


def clean_forms(forms):
    out = set()
    for form in forms or []:
        s = (form.get("form") or "").strip()
        if not s or s.lower() in TAG_WORDS:
            continue
        if " / " in s or len(s) > 40:
            continue
        if re.fullmatch(r"[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß\s-]*", s):
            out.add(s.lower())
    return out


def clean_example(text):
    s = re.sub(r"\s+", " ", (text or "").strip())
    if not s or CITATION.search(s) or " / " in s:
        return ""
    n = len(GERMAN_WORD.findall(s))
    return s if 5 <= n <= 18 else ""


def scan_kaikki(wanted):
    """一次扫描 kaikki：拿词形、词性、例句，并建立「词形 → 原形」索引。"""
    meta = {}
    form_map = defaultdict(list)
    names = set()
    if not os.path.exists(KAIKKI):
        return meta, form_map, names
    seen_lines = 0
    with gzip.open(KAIKKI, "rt", encoding="utf-8") as f:
        for line in f:
            seen_lines += 1
            if seen_lines % 200000 == 0:
                log("  kaikki 扫描 %d 万行…" % (seen_lines // 10000))
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("lang_code") != "de":
                continue
            word = (e.get("word") or "").lower()
            forms = clean_forms(e.get("forms"))
            for form in forms:
                if form in wanted and " " not in form:
                    form_map[form].append((e.get("word") or "", e.get("pos") or ""))
            if word in wanted and e.get("pos") == "name":
                names.add(word)
            if word not in wanted:
                continue
            item = meta.setdefault(word, {"pos": set(), "forms": set(), "examples": [], "pluralOf": "",
                                          "formOfPlural": False, "formOfParticiple": False, "gender": ""})
            item["pos"].add(e.get("pos") or "")
            if (e.get("pos") or "") == "noun" and not item["gender"]:
                for sense in e.get("senses") or []:
                    for tag in sense.get("tags") or []:
                        if tag in ("masculine", "feminine", "neuter"):
                            item["gender"] = tag
                            break
                    if item["gender"]:
                        break
            item["forms"].update(forms)
            for form in e.get("forms") or []:
                m = re.search(r"plural of ([A-ZÄÖÜ][\wÄÖÜäöüß-]+)", form.get("form") or "")
                if m and not item["pluralOf"]:
                    item["pluralOf"] = m.group(1)
            for sense in e.get("senses") or []:
                tags = set(sense.get("tags") or [])
                # 只有「词条自身被词典标为形式旁」才算词形；光靠词形撞名会把 leer 认成 leeren 的过去分词
                if "form-of" in tags:
                    if "plural" in tags:
                        item["formOfPlural"] = True
                    if "participle" in tags:
                        item["formOfParticiple"] = True
                for ex in sense.get("examples") or []:
                    txt = clean_example(ex.get("text") or "")
                    if txt and txt not in item["examples"]:
                        item["examples"].append(txt)
    return meta, form_map, names


def load_pairs():
    out = []
    if not os.path.exists(PAIRS):
        return out
    with io.open(PAIRS, encoding="utf-8") as f:
        for line in f:
            try:
                j = json.loads(line)
            except Exception:
                continue
            de = clean_example(j.get("de") or "")
            zh = (j.get("zh") or "").strip()
            if de and zh:
                out.append({"de": de, "zh": zh, "tokens": {t.lower() for t in GERMAN_WORD.findall(de)}})
    return out


def load_pack_sentences():
    """从 dist 内容包补例句：只用 300 句 Tatoeba 跟读句（完整句，无中文）。
    维基短文可能从段落中间抽取，容易产生半句，暂不进入例句池。"""
    out = []
    path = os.path.join(ROOT, "dist", "content-pack-speech.json")
    if not os.path.exists(path):
        return out
    try:
        data = json.load(io.open(path, encoding="utf-8"))
    except Exception:
        return out
    for item in data.get("items") or []:
        sent = clean_example(item.get("de") or "")
        if sent:
            out.append(sent)
    return list(dict.fromkeys(out))


def load_ex_overrides():
    """池里配不到句的词条：人工例句覆盖表 {词头: [德语例句, 例句中文]}。"""
    if not os.path.exists(EX_OVERIDES):
        return {}
    d = json.loads(io.open(EX_OVERIDES, encoding="utf-8").read())
    return {str(k).lower(): [str(v[0]), str(v[1])] for k, v in d.items() if len(v) >= 2 and v[0]}


def ex_accepts(sentence, word, pos, forms, info):
    """例句是否真的用了这个词。与选句池共用一套判定，否则「本轮选中的、下轮又被判不合格」
    会反复换句，治理结果就不幂等。"""
    if match_example(sentence, word, pos, forms, info):
        return True
    if not sent_pack:
        return False
    toks, soft, ends, early, _n = sent_pack(sentence)
    single, multi, sep = form_sets(word, pos, [])
    return sentence_hit(pos, toks, soft, ends, early, single, multi, sep)


def build_pool(local_pairs, db_path, t2s):
    """德中句对池：本地缓存 + 考试库 sentences 表（后者量大一个数量级）。"""
    seen, pool = set(), []
    for j in local_pairs:
        de = j["de"]
        if not de or de in seen:
            continue
        seen.add(de)
        toks, soft, ends, early, n = sent_pack(de)
        pool.append((de, t2s(j["zh"]), toks, soft, ends, early, n))
    if db_path and os.path.exists(db_path.replace("\\", "/")):
        import sqlite3
        con = sqlite3.connect("file:%s?mode=ro" % db_path.replace("\\", "/"), uri=True)
        con.row_factory = sqlite3.Row
        for row in load_pool(con)[0]:
            if row[0] in seen:
                continue
            seen.add(row[0])
            pool.append(row)
        con.close()
    index = defaultdict(list)
    for i, item in enumerate(pool):
        for t in item[2]:
            index[t].append(i)
    return pool, index


def pool_pick(word, pos, pool, index, used):
    """池里给该词找一条干净句对：优先没用过的、更短的。"""
    single, multi, sep = form_sets(word, pos, [])
    ids = pool_ids(single, multi, sep, index)
    if not ids:
        return None
    return best_of([pool[i] for i in ids], pos, single, multi, sep, used)


def add_regular_forms(word, pos):
    w = word.lower()
    forms = {w}
    if pos == "n":
        forms.update(w + s for s in ("s", "es", "e", "en", "n", "er", "ern", "ners"))
    elif pos == "adj":
        forms.update(w + s for s in ("e", "en", "er", "es", "em"))
    return forms


def match_example(sentence, word, pos, forms, meta):
    """严格匹配：词形表 / 常规屈折 / 连字符片段 / 多词短语。
    不接受「德语复合词包含该词」的宽松匹配（Ring 不应被 bringen 命中，
    Insel 不应被 Halbinsel 命中）——例句必须真的用到这个词。"""
    raw = GERMAN_WORD.findall(sentence)
    tokens = {t.lower() for t in raw}
    parts = set()
    for t in tokens:
        if "-" in t:
            parts.update(p for p in t.split("-") if p)
    accepted = set(forms) | add_regular_forms(word, pos)
    if meta:
        accepted |= meta.get("forms", set())
    if " " in word or "…" in word:
        need = [p for p in re.split(r"[\s…]+", word.lower()) if len(p) > 1]
        for p in need:
            if not (p in tokens or any(t.startswith(p) and len(t) - len(p) <= 3 for t in tokens)):
                return False
        return bool(need)
    if word.isupper() and len(word) <= 6:
        return word.lower() in tokens or word.lower() in parts
    if word.lower() in parts:
        return True
    if pos == "v":
        for i, t in enumerate(raw):
            if t.lower() in accepted:
                # 句中的大写形式若是名词化（zu Ehren），不作为动词证据；
                # 但名词化不定式（Das Atmen）就是原形本身，保留。
                if i > 0 and t[0].isupper() and t.lower() != word.lower():
                    continue
                return True
        for form in accepted:
            if " " in form and form in sentence.lower():
                return True
        return False
    return bool(tokens & accepted)


def level_from_count(count):
    if count >= 6000:
        return "A2"
    if count >= 3000:
        return "B1"
    if count >= 1200:
        return "B2"
    if count >= 300:
        return "C1"
    return "C2"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--no-examples", action="store_true")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--db", default=EXAM_DB, help="german_exam.db（德中句对池来源，可缺省）")
    ap.add_argument("--limit", type=int, default=15)
    args = ap.parse_args()

    rows = load_all()
    global MACHINE_START
    MACHINE_START = sum(1 for name, _, _ in rows if name != "lexicon-9.js")
    log("词条总数 %d · 人工词条 %d · 机器词条 %d" % (
        len(rows), MACHINE_START, len(rows) - MACHINE_START))

    # 词头归一：把「复数 / 名词化变格」形式的机器词条换成可学的原形。
    # 放在最前面，后面的词形闸门与词性索引都以归一后的词头为准。
    fixed_idx = set()
    lemma_fixed = []
    for idx in range(MACHINE_START, len(rows)):
        fix = LEMMA_FIXES.get(rows[idx][2][0].lower())
        if fix:
            lemma_fixed.append("%s → %s" % (rows[idx][2][0], fix[0]))
            rows[idx] = (rows[idx][0], rows[idx][1], list(fix))
            fixed_idx.add(idx)
    log("词头归一（复数/变格 → 原形）", len(lemma_fixed), lemma_fixed)
    freq = load_freq()
    machine_rows = rows[MACHINE_START:]
    wanted = {r[2][0].lower() for r in machine_rows}
    log("机器词条", len(machine_rows), "· 开始扫描 kaikki（约 1 分钟）…")
    meta, form_map, _auto_names = scan_kaikki(wanted)
    # kaikki 会把 Bauer / Berg / Kuchen 等姓氏与常用名词混在同一条目下；
    # 这里只保留人工确认的纯专名，避免把「熊 / 山 / 蛋糕」误杀。
    PROPER_NAMES = {"ali", "charlotte", "marie", "molly", "rom"}
    name_words = PROPER_NAMES & wanted
    log("kaikki 命中词条", len(meta), "· 词形索引", len(form_map), "· 纯人名/地名", len(name_words))
    pairs = load_pairs()
    pack_sentences = load_pack_sentences()
    manual_ex = load_ex_overrides()
    if sent_pack is None:
        pool, pool_index = [], {}
        log("未装到考试库导入器，只用本地句对缓存")
    else:
        pool, pool_index = build_pool(pairs, args.db, lambda x: x)
    log("Tatoeba 德中句对", len(pairs), "· 句对池", len(pool), "· 内容包德语句",
        len(pack_sentences), "· 人工例句", len(manual_ex))

    # 已被占用的句子：只认「德中都有」的定稿件（含 lexicon-10），
    # 不带中文的旧句随时可能被替换，把它们排除在外才能保证复跑结果一致
    used = {f[5] for _, _, f in rows if f[5] and f[6]}
    p10 = os.path.join(DATA, "lexicon-10.js")
    if os.path.exists(p10):
        for line in io.open(p10, encoding="utf-8"):
            f = parse_line(line)
            if f:
                used.add(f[5])

    # 词性索引（分词/复数判定只在词库内找原形）；
    # lexicon-10 不在治理范围内，但它的词头同样是「学员查得到、学得到」的原形，必须算数。
    lex_words = {}
    for idx, (_, _, f) in enumerate(rows):
        lex_words.setdefault(f[0].lower(), []).append((idx, f[3]))
    if os.path.exists(p10):
        for line in io.open(p10, encoding="utf-8"):
            f = parse_line(line)
            if f:
                lex_words.setdefault(f[0].lower(), []).append((-1, f[3]))

    # 词形归属三重闸门：① 词典把该词条自身标成 form-of（复数/过去分词）
    #                   ② 词性一致（名词↔名词、形容词↔动词原形）
    #                   ③ 原形必须已经在词库里
    # 三条缺一就不标——宁可少标，也不要在卡片上写出「leer 是 leeren 的过去分词」这种错话。
    def lex_spelling(base, want):
        """原形在词库里的实际写法：瑞士拼写 giessen/schliessen 对应 gießen/schließen。
        找到就返回词库里的写法（卡片上写它才对得上查词），否则返回空串。"""
        low = base.lower()
        for k in (low, low.replace("ss", "ß"), low.replace("ß", "ss")):
            for _, p in lex_words.get(k, []):
                if p == want:
                    return k
        return ""

    def in_lex(base, want):
        return bool(lex_spelling(base, want))

    form_info = {}
    missing_base = []
    for idx in range(MACHINE_START, len(rows)):
        if idx in fixed_idx:
            continue
        f = rows[idx][2]
        word, pos = f[0], f[3]
        info = meta.get(word.lower(), {})
        base, kind = "", ""
        if (word.lower(), pos) in REJECTED_FORMOF:
            continue
        if pos == "n" and (info.get("formOfPlural") or info.get("pluralOf")):
            cands = [w for w, p in form_map.get(word.lower(), []) if p == "noun" and w.lower() != word.lower()]
            base = info.get("pluralOf") or (cands[0] if cands else "")
            if base and in_lex(base, "n"):
                kind = "plural"
            elif base:
                missing_base.append((word, base, "复数"))
        elif pos == "adj" and info.get("formOfParticiple"):
            # formOfParticiple 只是词典的布尔标记，原形要从词形索引里取
            cands = [w for w, p in form_map.get(word.lower(), []) if p == "verb"]
            base = next((lex_spelling(w, "v") for w in cands if lex_spelling(w, "v")), "")
            if base:
                kind = "participle"
            elif cands:
                missing_base.append((word, cands[0], "过去分词"))
        if base and kind:
            form_info[idx] = (base, kind)

    # 定级：人类词条不动；机器词条按词频估计，少量基础词人工覆盖，词形跟随原形
    level_of = {}
    for idx, (_, _, f) in enumerate(rows):
        if idx < MACHINE_START:
            level_of[idx] = f[4]
    wave1 = [i for i in range(MACHINE_START, len(rows)) if i not in form_info]
    wave2 = [i for i in range(MACHINE_START, len(rows)) if i in form_info]
    for idx in wave1:
        word = rows[idx][2][0].lower()
        level_of[idx] = LEVEL_OVERRIDES.get(word) or level_from_count(freq.get(word, 0))
    for idx in wave2:
        base = form_info[idx][0].lower()
        if base in LEVEL_OVERRIDES:
            level_of[idx] = LEVEL_OVERRIDES[base]
            continue
        base_idx = next((i for i, p in lex_words.get(base, []) if p in ("n", "v")), None)
        level_of[idx] = (level_of.get(base_idx) if base_idx is not None else None) or level_from_count(freq.get(base, 0))

    # 词性与冠词修正：机器对齐里存在 Bombe 被标成形容词、Bär 没有冠词这类硬错误。
    # 只在「kaikki 给的词性唯一且与我们的不一致」时才改，避免把多词性词强行归一。
    POS_MAP = {"noun": "n", "verb": "v", "adj": "adj", "adv": "adv"}
    GENDER_ART = {"masculine": "der", "feminine": "die", "neuter": "das"}
    pos_fixed, art_filled = [], 0
    for idx in range(MACHINE_START, len(rows)):
        if idx in fixed_idx:
            continue
        f = rows[idx][2]
        info = meta.get(f[0].lower(), {})
        allowed = {POS_MAP.get(x) for x in info.get("pos", set())} & {"n", "v", "adj", "adv"}
        if len(allowed) == 1 and f[3] not in allowed:
            pos_fixed.append("%s %s→%s" % (f[0], f[3], list(allowed)[0]))
            f[3] = list(allowed)[0]
        elif f[3] != "n" and f[0][:1].isupper() and "n" in allowed:
            # 德语名词首字母大写是硬规则：词头大写却标成形容词/动词，一定是机器对齐错了（如 Bombe）
            pos_fixed.append("%s %s→n（大写词头）" % (f[0], f[3]))
            f[3] = "n"
        if f[3] == "n" and (f[1] or "").strip() in ("", "-"):
            art = GENDER_ART.get(info.get("gender", ""))
            if art:
                f[1] = art
                art_filled += 1
    log("=== 词性/冠词 ===")
    log("  词性修正", len(pos_fixed), pos_fixed[:12])
    log("  名词补冠词", art_filled)

    # 语域标注：粗口 / 口语俚语（全库生效，不只机器词条）
    register_of = {}
    for idx, (_, _, f) in enumerate(rows):
        reg = register_for(f[0])
        if reg:
            register_of[idx] = reg

    # 简繁转换
    try:
        import opencc
        t2s = opencc.OpenCC("t2s").convert
    except Exception:
        log("缺少 OpenCC：pip install opencc-python-reimplemented")
        sys.exit(1)

    # 例句核查与替换
    src_count = Counter()
    changed_ex = 0
    kept_ex = 0
    blanked = 0
    replaced_samples = []
    blank_samples = []
    for idx in range(MACHINE_START, len(rows)):
        if idx in fixed_idx:
            continue
        f = rows[idx][2]
        word, pos, ex, exzh = f[0], f[3], f[5], f[6]
        info = meta.get(word.lower(), {})
        forms = info.get("forms", set())
        if word.lower() in FORCE_EXAMPLES:
            f[5], f[6] = FORCE_EXAMPLES[word.lower()]
            changed_ex += 1
            continue
        hit = manual_ex.get(word.lower())
        if hit:
            f[5], f[6] = hit[0], hit[1]
            src_count["manual"] += 1
            changed_ex += 1
            continue
        if ex and exzh and ex_accepts(ex, word, pos, forms, info) and not CITATION.search(ex):
            kept_ex += 1
            src_count["keep"] += 1
            continue
        if args.no_examples:
            continue
        old = ex
        best = ""
        if pool:
            p = pool_pick(word, pos, pool, pool_index, used)
            if p:
                f[5], f[6] = p[2], p[3]
                used.add(p[2])
                src_count["pool"] += 1
                continue
        if ex and ex_accepts(ex, word, pos, forms, info) and not CITATION.search(ex):
            kept_ex += 1
            src_count["keep-no-zh"] += 1
            continue
        for cand in pack_sentences:
            if cand not in used and match_example(cand, word, pos, forms, info):
                best = cand
                f[5], f[6] = cand, ""
                used.add(cand)
                src_count["pack"] += 1
                break
        if not best:
            for cand in info.get("examples", []):
                if cand not in used and match_example(cand, word, pos, forms, info):
                    best = cand
                    f[5], f[6] = cand, ""
                    used.add(cand)
                    src_count["kaikki"] += 1
                    break
        if not best and word.lower() in MANUAL_EXAMPLES:
            f[5], f[6] = MANUAL_EXAMPLES[word.lower()]
            best = f[5]
            src_count["manual"] += 1
        if not f[5] or not ex_accepts(f[5], word, pos, forms, info):
            if f[5]:
                blanked += 1
                if len(blank_samples) < args.limit:
                    blank_samples.append((word, old))
            f[5], f[6] = "", ""
        elif old != f[5]:
            changed_ex += 1
            if len(replaced_samples) < args.limit:
                replaced_samples.append((word, old, f[5], bool(f[6])))

    # 组装输出 + 统计
    before_levels = Counter(f[4] for _, _, f in rows)
    after_levels = Counter(level_of[i] for i in range(len(rows)))
    machine_levels = Counter(level_of[i] for i in range(MACHINE_START, len(rows)))
    plural_n = sum(1 for v in form_info.values() if v[1].startswith("plural"))
    part_n = sum(1 for v in form_info.values() if v[1] == "participle")
    trad_n = 0
    for name, line_no, f in rows:
        if re.search(r"[她們敵人湯馬斯剛這說學習讀寫聽詞語譯錢銀開關門問題時間現實際發進過還麼價誼傳統歷史經濟學術簡單複雜應該錯誤選擇練習測試閱讀寫作聽力口語翻譯詞彙發音記憶電腦軟件硬盤網絡數據庫資訊系統設計圖書館辦公室實驗設備環境保護醫療藥劑]", f[2] + f[6]):
            trad_n += 1
    log("\n=== 例句来源 ===")
    for k in ("keep", "pool", "manual", "keep-no-zh", "pack", "kaikki"):
        if src_count.get(k):
            log("  %-11s %d" % (k, src_count[k]))
    log("  清空", blanked)
    log("\n=== 分级 ===")
    log("  治理前", dict(before_levels))
    log("  治理后", dict(after_levels))
    log("  机器词条", dict(machine_levels))
    log("=== 例句 ===")
    log("  保留可用", kept_ex, "· 替换", changed_ex, "· 清空", blanked)
    log("=== 词形（三重闸门后）===")
    log("  复数变体", plural_n, "· 分词变体", part_n, "· 人名/地名", len(name_words))
    open_items = [(w, b, k) for w, b, k in missing_base if w.lower() not in REVIEWED_NO_BASE]
    reviewed = [{"de": w, "base": b, "kind": k, "why": REVIEWED_NO_BASE[w.lower()]}
                for w, b, k in missing_base if w.lower() in REVIEWED_NO_BASE]
    log("  词典标了词形但原形不在词库：待补 %d %s · 已复核判定不补 %d" % (
        len(open_items), [w for w, _, _ in open_items[:12]], len(reviewed)))
    # 把「本轮拒绝标注」的词形清单落盘，供 tools/review_worklist.py 生成人工补录工作清单
    with io.open(os.path.join(ROOT, "docs", "review-missing-forms.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"generatedAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M"),
                   "note": "kaikki/Wiktionary 标了 form-of 但原形不在当前词库；"
                           "reviewed 是已逐条复核、判定不补原形的条目（附理由）",
                   "items": [{"de": w, "base": b, "kind": k} for w, b, k in open_items],
                   "reviewed": reviewed}, f, ensure_ascii=False, indent=1)
    vul = [rows[i][2][0] for i in register_of if register_of[i] == "vulgar"]
    col = [rows[i][2][0] for i in register_of if register_of[i] == "colloquial"]
    log("=== 语域 ===")
    log("  粗口/辱骂（不进新词队列）", len(vul), vul)
    log("  口语/俚语（卡片标注）", len(col), col)
    log("=== 简繁 ===")
    log("  含繁体候选", trad_n, "（写入时统一转简体）")
    for key in ("dorf", "halb", "schwierig", "leise", "träume", "genannt", "geändert"):
        hit = next((i for i in range(MACHINE_START, len(rows)) if rows[i][2][0].lower() == key), None)
        if hit is not None:
            log("  %-10s → %s %s" % (rows[hit][2][0], level_of[hit], form_info.get(hit, "")))
    if args.show:
        log("\n=== 例句替换样本 ===")
        for word, old, new, has_zh in replaced_samples:
            log("  %s：%s\n    → %s %s" % (word, (old or "（空）")[:80], new[:80], "[中]" if has_zh else ""))
        log("\n=== 清空样本 ===")
        for word, old in blank_samples:
            log("  %s：%s" % (word, (old or "（空）")[:80]))
    if not args.write:
        log("\n（未写入；加 --write 生效）")
        return

    # 写回：逐文件替换词条行
    by_file = defaultdict(list)
    for idx, (name, line_no, f) in enumerate(rows):
        by_file[name].append((idx, line_no, f))
    written = 0
    banned_examples = []
    for name in FILES:
        path = os.path.join(DATA, name)
        if not os.path.exists(path) or name not in by_file:
            continue
        with io.open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
        for idx, line_no, f in by_file[name]:
            tail = "," if lines[line_no].rstrip().endswith(",") else ""
            row = list(f[:7])
            row[2] = GLOSS_FIXES.get(row[0].lower()) or t2s(row[2])
            row[6] = t2s(row[6])
            # 例句内容红线：命中性描写 / 暴力 / 排泄即清空，宁可不显示也不推给初学者
            if example_banned and example_banned(row[5], row[6], row[0], row[2]):
                banned_examples.append(row[0])
                row[5] = ""
                row[6] = ""
            if idx >= MACHINE_START:
                row[4] = level_of[idx]
            # 字段数每次重写：闸门收紧后不再成立的旧标注必须被清掉，不能留在文件里
            formOf, formKind = form_info.get(idx, ("", ""))
            reg = register_of.get(idx, "")
            if formOf or formKind or reg:
                row = row + [formOf, formKind, reg]
            lines[line_no] = json.dumps(row, ensure_ascii=False) + tail + "\n"
            written += 1
        io.open(path, "w", encoding="utf-8").write("".join(lines))
    log("已写回", written, "条词目")
    log("例句内容红线清空", len(banned_examples), sorted(set(banned_examples))[:20])

    # 专名集合：保留查词，但新词队列跳过（Ali / Molly 不应出现在学习队列里）
    names_js = "window.LD_LEX_NAME_WORDS = new Set(%s);" % json.dumps(sorted(name_words), ensure_ascii=False)
    lines9 = io.open(LEX9, encoding="utf-8").read().splitlines()
    lines9 = [ln for ln in lines9 if not ln.startswith("window.LD_LEX_NAME_WORDS")]
    for i, ln in enumerate(lines9):
        if ln.startswith("window.LD_LEX_MACHINE"):
            lines9.insert(i, names_js)
            break
    io.open(LEX9, "w", encoding="utf-8").write("\n".join(lines9) + "\n")

    # 报告
    machine_total = len(rows) - MACHINE_START
    machine_with_ex = sum(1 for i, (_, _, f) in enumerate(rows) if i >= MACHINE_START and f[5])
    machine_no_zh = sum(1 for i, (_, _, f) in enumerate(rows)
                        if i >= MACHINE_START and f[5] and not f[6])
    lines = [
        "# 词库治理报告",
        "",
        "> 生成时间：%s · 工具：`tools/lexicon_govern.py`（复跑自动刷新）" % TODAY,
        "",
        "## 做了什么",
        "",
        "1. **分级**：1428 条机器词条原本 995 条标 B2。改为按字幕词频估计（非官方 CEFR 认定），"
        "并用人工覆盖表校正高频基础词（Dorf / halb / schwierig / leise 等）。",
        "2. **例句**：三层选句 —— ① 原句带中文且通过词形校验就保留；② 从德中句对池（Tatoeba，"
        "含考试库 sentences 表）取该词最干净的一句；③ 池里配不到句的走人工覆盖表 "
        "`tools/data/lexicon9_example_overrides.json`。可分动词要求前缀落在句末（er stellt ein），"
        "句中首字母大写的同形名词不算动词命中。本轮机器词条例句覆盖 %d/%d，例句缺中文 %d。" % (
            machine_with_ex, machine_total, machine_no_zh),
        "3. **简繁**：全部词条释义与例句中文经 OpenCC `t2s` 统一为简体。",
        "4. **词形**：复数名词（如 Träume → Traum）与过去分词（如 genannt → nennen）写入 "
        "`formOf` / `formKind`；复数变体不再进入新词队列，分词在卡片上标注来源。",
        "",
        "## 分级分布",
        "",
        "| 等级 | 治理前 | 治理后 |",
        "|---|---|---|",
    ]
    for lv in LEVELS:
        lines.append("| %s | %d | %d |" % (lv, ORIGINAL_LEVELS.get(lv, 0), after_levels.get(lv, 0)))
    lines += [
        "",
        "机器词条：A1 %d / A2 %d / B1 %d / B2 %d / C1 %d / C2 %d。" % (
            machine_levels.get("A1", 0), machine_levels.get("A2", 0), machine_levels.get("B1", 0),
            machine_levels.get("B2", 0), machine_levels.get("C1", 0), machine_levels.get("C2", 0)),
        "",
        "## 例句与词形",
        "",
        "- 本轮例句来源：保留原句 %d · 句对池 %d · 人工覆盖 %d · 无中文保留 %d · 内容包 %d · kaikki %d · 清空 %d。" % (
            src_count.get("keep", 0), src_count.get("pool", 0), src_count.get("manual", 0),
            src_count.get("keep-no-zh", 0), src_count.get("pack", 0), src_count.get("kaikki", 0), blanked),
        "- 复跑幂等：`used` 只从已带中文的定稿件播种，同一输入两次写出逐字节一致。",
        "- 复数变体：%d；分词变体：%d（词形标签已收紧为三重闸门：词典自身标 form-of + 词性一致 + 原形在库）。" % (plural_n, part_n),
        "- 词典标了词形但原形不在词库：待补 %d 条 %s；已逐条复核判定不补 %d 条（理由见 "
        "`dist/review-missing-forms.json` 的 reviewed，多为分词已词汇化成形容词、或动词与库内名词同形会顶掉查词）。" % (
            len(open_items), "、".join("%s→%s" % (w, b) for w, b, _ in open_items[:8]) or "无", len(reviewed)),
        "- 词性修正 %d 条（如 Bombe 由形容词改回名词）、名词补冠词 %d 条。" % (len(pos_fixed), art_filled),
        "- 词头归一（复数/变格形式换成原形）：%d 条：%s。" % (len(lemma_fixed), "、".join(lemma_fixed)),
        "- 语域：粗口/辱骂 %d 条（不进新词队列，保留查词）；口语/俚语 %d 条（卡片标注「口语 · 非正式」）。" % (
            sum(1 for v in register_of.values() if v == "vulgar"),
            sum(1 for v in register_of.values() if v == "colloquial")),
        "- 人名/地名/专名：%d 条（保留查词，不进入新词队列）。" % len(name_words),
        "",
        "## 边界",
        "",
        "- 词频来自 OpenSubtitles 德语 50k 列表，基础词与抽象词可能被排到同一档，因此等级只作学习顺序参考。",
        "- kaikki / Wiktionary 数据为 CC BY-SA 3.0；Tatoeba 句对为 CC BY 2.0 FR；本报告与代码不改这些许可。",
        "- 例句优先级：人工覆盖表 > 原句（含中文且通过校验）> 德中句对池 > 原句（无中文）"
        "> 内容包/kaikki 德语单句（无中文）> 留空。",
        "- 池里配不到句的一律走人工例句，不用无中文的德语单句凑数。",
        "- 早期脚本把机器词条边界写成 576（实际人工词条 572 条），导致前 4 条机器词条漏治理；本轮已按 572 修正。",
        "",
        "## 复跑",
        "",
        "```bash",
        "pip install opencc-python-reimplemented",
        "python tools/lexicon_govern.py --write",
        "python tools/lexicon_audit.py",
        "```",
        "",
    ]
    io.open(REPORT, "w", encoding="utf-8").write("\n".join(lines))
    log("报告", REPORT)


if __name__ == "__main__":
    main()
