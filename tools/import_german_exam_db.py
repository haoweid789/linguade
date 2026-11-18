# -*- coding: utf-8 -*-
"""把 german_exam.db（Goethe/DWDS 词表 + 词频派生 + Tatoeba 例句）导入 LinguaDE。

为什么不是“直接接数据库”：
  - 源库是服务端 SQLite（134 MB，含 28 万条 kaikki 词典与 15k 例句），
    前端是离线优先的静态词库（window.LD_LEX），两者 schema / 词性 / 等级字段都不兼容；
  - 源库的 pos 是 DWDS 德语全称、中文是逐词机翻，还混有词形变体/符号/多词表达，
    不能直接进学习队列。

本脚本做四件事：
  1. 词性归一（Substantiv -> n …），用词条绑定的 kaikki 词典修正 spaCy 词性错误；
  2. 过滤不可学条目（符号/词缀/专名/词形变体/无冠词名词/无中文释义）；
  3. 中文释义清洗（去重复义项、去语法说明、A/B 两版候选择优）并保留人工覆盖表；
  4. 从 Tatoeba 例句中挑一条“含词形 + 中文齐全 + 长度合适”的例句。

产物（全部可重跑、幂等）：
  - src/data/lexicon-10.js      新词（A1–C2），按现有词库 7 字段格式
  - src/data/grammar-exam.js    71 个语法点（语法速查）
  - src/data/exam-plan.js       12 个考试 / 48 条模块结构
  - docs/exam-vocab-review.csv  逐条复核表（A/B/自动选择/来源/词频）
  - 控制台统计 + 体积

用法：
  python tools/import_german_exam_db.py
  python tools/import_german_exam_db.py --db D:/111/121/german-db/german_exam.db
  python tools/import_german_exam_db.py --selftest
"""
import argparse
import collections
import csv
import io
import json
import os
import re
import sqlite3
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "src", "data")
DOCS_DIR = os.path.join(ROOT, "docs")
DEFAULT_DB = os.environ.get("GERMAN_EXAM_DB", r"D:/111/121/german-db/german_exam.db")
OVERRIDES = os.path.join(ROOT, "tools", "data", "exam_vocab_overrides.json")
EX_SAMPLES = os.path.join(ROOT, "tools", "data", "exam_example_overrides.json")

OUT_LEX = os.path.join(DATA_DIR, "lexicon-10.js")
OUT_GRAMMAR = os.path.join(DATA_DIR, "grammar-exam.js")
OUT_EXAMS = os.path.join(DATA_DIR, "exam-plan.js")
OUT_REVIEW = os.path.join(DOCS_DIR, "exam-vocab-review.csv")
# 仓库里已发货的产物（--check-drift 用：源库重新生成后与它们逐字节比对）
SHIPPED = {"lexicon-10.js": OUT_LEX, "grammar-exam.js": OUT_GRAMMAR,
           "exam-plan.js": OUT_EXAMS, "exam-vocab-review.csv": OUT_REVIEW}

# ---------- 字段映射 ----------
POS_MAP = {
    "Substantiv": "n", "Verb": "v", "Adjektiv": "adj", "partizipiales Adjektiv": "adj",
    "Adverb": "adv", "Pronominaladverb": "adv", "Konjunktion": "conj",
    "Präposition": "prep", "Präposition + Artikel": "prep", "Partikel": "part",
    "Kardinalzahlwort": "num", "Ordinalzahlwort": "num", "Zahlwort": "num",
    "Mehrwortausdruck": "phrase", "Interjektion": "interj",
    "bestimmter Artikel": "art", "unbestimmter Artikel": "art", "Artikel": "art",
    "Personalpronomen": "pron", "Possessivpronomen": "pron", "Indefinitpronomen": "pron",
    "Demonstrativpronomen": "pron", "Interrogativpronomen": "pron",
    "Reflexivpronomen": "pron", "Pronomen": "pron",
}
DROP_POS = {"Symbol", "Affix", "Eigenname", "Komparativ", "Superlativ", "",
            "Präfix", "Suffix", "symbol", "punct", "character", "proverb", "det",
            "Kontraktion", "prep_phrase", "postp", "interfix", "circumfix", "name"}

MULTIWORD = {"zum Beispiel", "auf jeden Fall", "auf keinen Fall", "Pommes frites",
             "was für ein", "was für eine", "wie viel"}
PLURAL_ONLY = {"Eltern", "Großeltern", "Leute", "Ferien", "Kosten", "Geschwister"}
LANG_NEUTER = {"Französisch", "Chinesisch", "Englisch", "Deutsch", "Spanisch",
               "Italienisch", "Russisch", "Portugiesisch", "Türkisch", "Polnisch"}

FORM_OF = re.compile(
    r"^(alternative form of|alternative spelling of|form of|inflected form of|"
    r"plural of|past participle of|present participle of|comparative of|superlative of|"
    r"first-person .* of|second-person .* of|third-person .* of|"
    r"genitive of|dative of|accusative of|nominative of|"
    r"short for|abbreviation of|synonym of|diminutive of|female equivalent of)", re.I)
NAMEISH = re.compile(r"(given name|surname|family name|diminutive of the .* name|name of a)", re.I)
GRAMMAR_GLOSS = re.compile(
    r"(过去分词|现在分词|的缩写|第一人称|第二人称|第三人称|单数|名词化|动名词|"
    r"相当于|同义词|姓氏|人名|女性等同|男性等同|动词名词|形容词化|替代形式|"
    r"缩写为|的阴性|的阳性)")
BAD_SENT = re.compile(
    r"(erschie|töte|töten|Waffe|Krieg|Sex|fick|scheiß|scheiss|Arsch|Porno|"
    r"Selbstmord|Nazi|Hitler|Mord|Leiche|vergewaltig|Hure|schwul|"
    r"Penner|penner)", re.I)

# 例句内容红线：词条可以是粗口/武器/尸体（标注语域后仍可查词），
# 但例句和例句中文不能把性描写 / 暴力 / 排泄推给初学者。
EXAMPLE_BANNED = re.compile(
    r"((?:^|[^a-zäöüß])(?:fick|wichs|arsch|fotze|hurensohn|scheiß|scheiss|kack|begierde|busen|"
    r"brustwarze|sex|porno|prostitui|vergewalt|erschie[sß]|erschoss|töt|waffe|leiche|selbstmord|"
    r"suizid|beischlaf|umbring|nazi|hitler|bombe))|"
    r"(性交|性欲|乳房|阴茎|阴道|鸡巴|强奸|妓女|尸体|自杀|开枪|炸弹|纳粹|拉屎|大便)", re.I)
ZH_BANNED = ("性交", "性欲", "乳房", "阴茎", "阴道", "鸡巴", "强奸", "妓女", "尸体",
             "自杀", "开枪", "炸弹", "纳粹", "拉屎", "大便")


def example_banned(de, zh, word="", gloss=""):
    """内容红线。先把词头自身的词形（德）和它的释义（中）剥掉再判，
    否则 Sex / Bombe / Selbstmord 这类词永远配不到例句；短词头（Sex 三个字母）也要剥。"""
    d, z = str(de or ""), str(zh or "")
    w = str(word or "").lower()
    keys = {w} | {w[:n] for n in (6, 5, 4) if len(w) >= n}
    keys = {k for k in keys if len(k) >= 3}
    if keys:
        d = " ".join(t for t in d.split() if not any(t.lower().startswith(k) for k in keys))
        z = " ".join(t for t in z.split() if not any(t.lower().startswith(k) for k in keys))
    g = str(gloss or "")
    for term in ZH_BANNED:
        if term in g:
            z = z.replace(term, " ")
    return bool(EXAMPLE_BANNED.search(d)) or bool(EXAMPLE_BANNED.search(z))


REGISTER_VULGAR = {
    "wichser", "ficken", "hurensohn", "kacke", "scheiße", "scheisse", "arsch",
    "arschloch", "fotze", "schlampe", "luder", "drecksack", "mistsack", "trottel",
    "blödmann", "spasti", "pisse", "pisen", "bumsen", "vögeln", "schweinehund",
    "vollidiot", "vollpfosten", "locher",
}
REGISTER_COLLOQUIAL = {
    "karre", "penner", "quatsch", "verrückter", "piepen", "spinnen", "verknallt",
    "pennen", "schnacken", "labern", "zocken", "checken", "kapiert", "besoffen",
    "pleite", "zoff", "macke", "anzicken", "verpennen", "abgehoben", "kasper",
    "depp", "mammon", "schuften", "buckeln", "schmusen", "mief", "knete",
    "weichei", "lusche", "gockel", "heulen",
}

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

try:
    from opencc import OpenCC
    _t2s = OpenCC("t2s").convert
except Exception:
    _t2s = None


def to_simplified(s):
    return _t2s(s) if _t2s and s else s


def read(p):
    return io.open(p, encoding="utf-8").read()


def write(p, s):
    io.open(p, "w", encoding="utf-8", newline="\n").write(s)


def german_tokens(s):
    # é/è/à…：Café、Soufflé 这类借词不带变音就切不出完整词形
    return re.findall(r"[A-Za-zÄÖÜäöüßÉÈÀÊéèàêôùû][A-Za-zÄÖÜäöüßÉÈÀÊéèàêôùû-]*", s or "")


# 可分动词前缀（用于 abfahren → „fährt … ab“ 这类句子的匹配）
# 可分动词前缀，匹配时按长度倒序，否则 „hinzu-fügen“ 会被 „hin“ 抢走、
# „kennen-lernen“ 认不出来；表里只放真正的前缀（„mitte“/„daran“ 这类会把 mitteilen 切成 ilen）。
SEP_PREFIXES = tuple(sorted(
    ("zurück", "zusammen", "auseinander", "entgegen", "heraus", "hinzu", "voraus", "vorent",
     "ab", "an", "auf", "aus", "bei", "ein", "mit", "nach", "vor", "zu", "weg", "her", "hin",
     "los", "fest", "weiter", "fern", "heim", "davon", "dafür", "statt", "teil", "kennen",
     "still", "stand", "inne"), key=len, reverse=True))
VOWEL_CHANGES = (("au", "äu"), ("a", "ä"), ("a", "u"), ("o", "ö"), ("u", "ü"), ("e", "i"))


ADV_VARIANTS = {"vorn": "vorne", "vorne": "vorn", "hinten": "hinten",
               "allemal": "allemal", "natts": "nachts", "nachts": "natts"}


def spelling_variants(w):
    """拼写变体：gewiß/gewiss、Stengel/Stängel 之类正字法差异，同一词不算宽松匹配。"""
    out = set()
    if w.endswith("ß"):
        out.add(w[:-1] + "ss")
    if w.endswith("ss"):
        out.add(w[:-1] + "ß")
    if w in ADV_VARIANTS:
        out.add(ADV_VARIANTS[w])
    return out


CLAUSE_END = re.compile(r"([A-Za-zÄÖÜäöüßÉÈÀÊéèàêôùû-]+)\s*[,.;:!?]")


def clause_final(raw):
    """分句末尾的词：„Er fügte hinzu, dass …“ 的 hinzu 落在逗号前，也是可分前缀的合法落点。"""
    out = set()
    for m in CLAUSE_END.finditer(raw or ""):
        out.add(m.group(1).lower())
    return out


def umlaut_variants(w):
    """单数→复数的变音候选：只动一个元音，首尾两处都试（Apfel→Äpfel，Großvater→Großväter）。"""
    out = set()
    for a, b in (("a", "ä"), ("o", "ö"), ("u", "ü")):
        for i in {w.find(a), w.rfind(a)}:
            if i >= 0:
                out.add(w[:i] + b + w[i + 1:])
    return out


def stem_variants(stem):
    """强变化词干候选：laufen→läuf, fahren→fähr, sprechen→sprich（取最后一次元音，避开前缀）。"""
    out = {stem}
    for a, b in VOWEL_CHANGES:
        i = stem.rfind(a)
        if i > 0:
            out.add(stem[:i] + b + stem[i + len(a):])
    return out


VERB_FORMS = ("e", "st", "t", "en", "et", "end")        # 现在时与分词尾巴
VERB_PAST = ("te", "ten", "test", "tet")                # 弱变化过去式，只接基础词干
STOP_TOKENS = {"der", "die", "das", "den", "dem", "des", "ein", "eine", "er", "sie", "es",
               "ich", "du", "wir", "ihr", "man", "es.", "ist", "hat", "war", "zu", "nicht"}


DE_UMLAUT = str.maketrans("äöü", "aou")


# 强变化里「元音换 + 辅音变」的一小撮（nehmen→nimm、geben→gib、sehen→sieh …），
# 规则生成拿不到，手写最省事；只收不规则到规则推不出来的动词。
IRREGULAR_STEMS = {
    "nehmen": "nimm", "geben": "gib", "sehen": "sieh", "essen": "iss", "messen": "miss",
    "treffen": "triff", "werfen": "wirf", "sterben": "stirb", "treten": "tritt",
    "lesen": "lies", "vergessen": "vergiss", "empfehlen": "empfiehl", "stehlen": "stiehl",
    "gelten": "gilt", "nehmen": "nimm", "schelten": "schilt", "bergen": "birg",
    "brechen": "brich", "sprechen": "sprich", "stechen": "stich", "helfen": "hilf",
    "lassen": "läss", "raten": "rät", "schlafen": "schläf", "fahren": "fähr",
    "tragen": "träg", "fangen": "fäng", "fallen": "fäll", "laden": "läd", "halten": "hält",
}


def verb_forms_of(stem):
    """一个动词词干的可接受写法。
    变音候选（fährt / gibt）只参与现在时；命令式、过去式、分词一律只认基础词干，
    否则 bitte、wär 这类同形词会被 bieten、warnen 误吃。"""
    out = set()
    base = {stem}
    if stem in IRREGULAR_STEMS:            # nehmen → nimm（nimmst / nimmt / nimmt …）
        base.add(IRREGULAR_STEMS[stem])
    for st in base | stem_variants(stem):
        if len(st) >= 3:
            out.update(st + s for s in VERB_FORMS)
        if len(st) >= 4 or st in IRREGULAR_STEMS.values():
            out.add(st)                                # 裸形：hält/fuhr/gilt；强变化命令式 gib/nimm/sieh 另收
    for st in base:
        if len(st) < 3:
            continue
        out.update(st + s for s in VERB_PAST)
        out.update("ge" + st + e for e in ("t", "en"))
    if stem[-1] in "dt":
        out.update(stem + s for s in ("ete", "eten", "est"))
    if stem.endswith("el"):                            # bezweifeln → ich bezweifle
        out.update(stem[:-2] + s for s in ("le", "lt", "lten", "lte", "ltest"))
    return out


def inflected_tokens(word, pos):
    w = (word or "").lower()
    out = {w} | spelling_variants(w)
    if pos == "n":
        for suf in ("s", "es", "e", "en", "n", "er", "ern", "ners", "ns", "ens"):
            out.add(w + suf)
        for up in umlaut_variants(w):     # 复数变音：Vater→Väter、Apfel→Äpfel
            out.update({up, up + "n", up + "e", up + "s", up + "er"})
    elif pos == "v":
        for stem in verb_stems(w):
            out |= verb_forms_of(stem)
    elif pos == "adj":
        out.update(w + s for s in ("e", "en", "er", "es", "em", "r", "ste", "sten",
                                   "ere", "eren", "erer", "eres"))
    return out


def verb_stems(w):
    """动词词干候选：laufen→lauf，fingern→finger，bezweifeln→bezweifel。"""
    stems = {w}
    if w.endswith(("ern", "eln")):
        stems.add(w[:-1])
    if w.endswith("en"):
        stems.add(w[:-2])
    elif w.endswith("e"):
        stems.add(w[:-1])
    return {s for s in stems if len(s) >= 3}


def part_forms(part):
    """多词词条里单个片段的常见写法：名词样给屈折尾巴，动词样给变位形
    （Bezug nehmen auf → „nehme … Bezug auf“ 才算命中）。"""
    out = {part} | {part + s for s in ("s", "en", "e", "n", "er", "ns")} | spelling_variants(part)
    if part.endswith(("en", "e", "eln", "ern")):
        out |= verb_forms_of(part[:-2] if part.endswith("en") else part[:-1])
        out |= verb_forms_of(part)
    return out


def form_sets(lemma, pos, extra_forms):
    """句子匹配用的候选形式：single = 任一到货即可；multi = 每组片段都要有到货；
    sep = 可分动词，前缀必须落在句末（„er stellt ein“），另一成员是变位形式。"""
    single = inflected_tokens(lemma, pos)
    multi, sep = [], []

    def add_sep(prefix, others):
        rest = {t for t in others if t not in STOP_TOKENS and len(t) >= 3}
        if rest:
            sep.append((prefix, rest))

    parts = [t for t in re.split(r"\s+", (lemma or "").strip().lower())
             if re.search(r"[A-Za-zÄÖÜäöüß]", t or "")]     # „zwar … aber“ 的连接符不作匹配片段
    if len(parts) > 1:
        multi.append([part_forms(p) for p in parts])
        for pt in parts:                        # „auseinandersetzen“ / „hinzufügen“ 这类还要再拆
            for sub in SEP_PREFIXES:
                if pt.startswith(sub) and len(pt) > len(sub) + 3:
                    sub_forms = set()
                    for st in verb_stems(pt[len(sub):]):
                        sub_forms |= verb_forms_of(st)
                        single.update(sub + v for v in verb_forms_of(st))
                    if sub_forms:
                        sep.append((sub, sub_forms))
                    break
    for f in extra_forms or []:
        toks = [t.lower() for t in german_tokens(f or "")]
        if len(toks) == 1:
            single |= {toks[0]}
        elif len(toks) > 1:
            pre = [t for t in toks if t in SEP_PREFIXES]
            if pre:
                add_sep(pre[0], [t for t in toks if t != pre[0]])
            else:
                multi.append([{t} for t in toks])
    w = (lemma or "").lower()
    if pos == "v":
        for p in SEP_PREFIXES:
            if not w.startswith(p) or len(w) <= len(p) + 3:
                continue
            forms = set()
            for st in verb_stems(w[len(p):]):
                vforms = verb_forms_of(st)
                forms |= vforms                      # 句中独立出现的变位形式
                # 从句里不拆开：einstellt / eingestellt / einzustellen
                single.update(p + v for v in vforms)
                single.update(p + "ge" + v + e for v in {st, st.translate(DE_UMLAUT)} | stem_variants(st)
                              for e in ("t", "en"))
                single.update(p + "zu" + v + e for v in {st, st.translate(DE_UMLAUT)} | stem_variants(st)
                              for e in ("n", "en", "em"))
            add_sep(p, forms - {w})
            break
    return single, multi, sep


def sentence_hit(pos, toks, soft, ends, early, single, multi, sep):
    # 动词/形容词不认句中首字母大写的同形名词（Wärme ≠ wärmen、Vorhaben ≠ vorhaben）
    pool = soft if pos in ("v", "adj", "adv") else toks
    if pool & single:
        return True
    for m in multi:
        if all(ps & toks for ps in m):
            return True
    # 可分动词：前缀落在句末或分句末，且变位出现在前 6 词内（主句动词第二位，主语可能很长）。
    # 位置约束挡住 „flippe … aus“(ausrasten) 与 „… zu sprechen“(ansprechen) 这类错配。
    for prefix, forms in sep:
        if prefix in ends and early & forms:
            return True
    return False


def sent_ok(de, zh):
    """进句对池的句子：有德有中、长度合适，且不踩内容红线（人工覆盖表不受此限）。"""
    if not de or not zh or not (14 <= len(de) <= 150):
        return False
    if BAD_SENT.search(de) or EXAMPLE_BANNED.search(de):
        return False
    # 中文侧也要查：德句写 „oder ich schieße“，中文译成「开枪」才露出内容
    return not EXAMPLE_BANNED.search(zh)


def sent_pack(de):
    """(全部词形, 排除句中大写同形的词形, 可分前缀落点, 前 6 词窗口, 长度)。"""
    raw = german_tokens(de)
    tl = [t.lower() for t in raw]
    seen = []                       # (词形, 是否句中大写) —— 连字符片段继承原词的大小写位置
    for i, t in enumerate(raw):
        cap = bool(i and t[:1].isupper())
        seen.append((t.lower(), cap))
        for p in t.lower().split("-"):
            if len(p) >= 2:
                seen.append((p, cap))
    up = {w for w, c in seen if c}
    low = {w for w, c in seen if not c}
    toks = {w for w, _ in seen}
    ends = clause_final(de)
    if tl:
        ends.add(tl[-1])
    # 依次：全部词形（含连字符片段）/ 排除句中大写同形 / 可分前缀落点 / 变位窗口 / 长度
    return toks, toks - (up - low), ends, set(tl[:6]), len(de)


def load_pool(con):
    """全局德中句对：预分词 + 倒排索引，给本词条没句子的词做第二层匹配。"""
    pool, index, seen = [], collections.defaultdict(list), set()
    for r in con.execute("SELECT de, zh FROM sentences"):
        de = re.sub(r"\s+", " ", (r["de"] or "").strip())
        zh = re.sub(r"\s+", " ", (r["zh"] or "").strip())
        if not sent_ok(de, zh) or de in seen:
            continue
        seen.add(de)
        toks, soft, ends, early, n = sent_pack(de)
        i = len(pool)
        pool.append((de, zh, toks, soft, ends, early, n))
        for t in toks:
            index[t].append(i)
    return pool, index


def pool_ids(single, multi, sep, index):
    """倒排索引里可能命中的句子编号，避免整库扫描。"""
    ids = set()
    for t in single:
        ids.update(index.get(t, ()))
    for m in multi:
        acc = None
        for ps in m:                       # 每个片段先并上自己的屈折形，再逐段求交
            hit_ids = set()
            for t in ps:
                hit_ids.update(index.get(t, ()))
            acc = hit_ids if acc is None else (acc & hit_ids)
            if not acc:
                break
        ids |= acc or set()
    for prefix, forms in sep:
        ids.update(index.get(prefix, ()))
        for t in forms:
            ids.update(index.get(t, ()))
    return ids


def best_of(items, pos, single, multi, sep, used):
    """候选越短越好；已被用过的句子排到后面，提高整库例句多样度。"""
    cands = [(0 if de not in used else 1, n, de, zh)
             for de, zh, toks, soft, ends, early, n in items
             if sentence_hit(pos, toks, soft, ends, early, single, multi, sep)]
    return min(cands) if cands else None


# ---------- 中文释义清洗 ----------
SENSE_SPLIT = re.compile(r"[，,、;；/]")


def senses(s):
    out = []
    for x in SENSE_SPLIT.split(s or ""):
        x = re.sub(r"\s+", "", x)
        x = re.sub(r"^[.。·:：]+|[.。·:：]+$", "", x)
        x = re.sub(r"^\[[^\]]*\]|\[[^\]]*\]$", "", x)
        if x and x not in out:
            out.append(x)
    return out


def clean_zh(s, max_senses=2, max_len=24):
    ss = senses(s)
    if not ss:
        return ""
    out = []
    for x in ss[:max_senses]:
        if len("；".join(out + [x])) > max_len:
            break
        out.append(x)
    return "；".join(out)


def valid_zh(s):
    s = (s or "").strip()
    if not s or not re.search(r"[\u4e00-\u9fff]", s):
        return False
    if re.search(r"[A-Za-z]{3,}", s):
        return False
    if GRAMMAR_GLOSS.search(s):
        return False
    if re.search(r"[0-9]{2,}", s):
        return False
    if len(s) > 30:
        return False
    return True


# ---------- CC-CEDICT 语义打分（只在 A/B 差距大时做保守择优） ----------
STOP = set("a an the of to in on at for with and or as by from is are be this that these those etc cl".split())


def en_tokens(s):
    s = re.sub(r"\([^)]*\)", " ", (s or "").lower())
    s = re.sub(r"[^a-z\- ]", " ", s)
    out = []
    for w in s.split():
        w = w.strip("-")
        if not w or w in STOP:
            continue
        for part in [w] + w.split("-"):
            part = part.strip()
            if not part:
                continue
            if len(part) > 4 and part.endswith("ing"):
                part = part[:-3]
            elif len(part) > 3 and part.endswith("ed"):
                part = part[:-2]
            elif len(part) > 3 and part.endswith("s") and not part.endswith("ss"):
                part = part[:-1]
            out.append(part)
    return set(out)


def build_zh_index(con):
    zh2en = collections.defaultdict(set)
    for r in con.execute("SELECT en, zh FROM zh_en"):
        for seg in re.split(r"[；;、，,/|]", r["zh"] or ""):
            seg = re.sub(r"CL:.*", "", seg).strip()
            seg = re.sub(r"\([^)]*\)", "", seg).strip()
            if 1 <= len(seg) <= 8 and re.search(r"[\u4e00-\u9fff]", seg):
                zh2en[seg] |= en_tokens(r["en"])
    return zh2en


def zh_score(zh, en_tokens, zh2en):
    sc = 0.0
    for seg in senses(zh):
        cand = set(zh2en.get(seg, ()))
        if not cand:
            for k, v in zh2en.items():
                if len(k) >= 2 and (k in seg or seg in k):
                    cand |= v
        ov = cand & en_tokens
        if ov:
            sc += 1 + min(len(ov), 3) * 0.5
    return sc


def choose_auto(A, B, gloss_en, pos, zh2en):
    a = clean_zh(A, max_senses=2)
    b = clean_zh(B, max_senses=1)          # 只取 B 的第一义项，避免把“人们；民间”这类噪声带进来
    va, vb = valid_zh(a), valid_zh(b)
    if not va and not vb:
        return "", "none"
    if not va:
        return b, "B"
    if not vb:
        return a, "A"
    if b == a:
        return a, "A"
    # 名词/动词/副词却拿到形容词释义（以“的”结尾）
    if a.endswith("的") and pos in ("n", "v", "adv") and not b.endswith("的"):
        return b, "B-pos"
    # 单字动词/名词，B 是完整词
    if len(a) == 1 and 2 <= len(b) <= 8 and pos in ("n", "v"):
        return b, "B-len"
    et = en_tokens(gloss_en)
    sa, sb = zh_score(a, et, zh2en), zh_score(b, et, zh2en)
    if sa < 1.5 and sb >= 1.5 and len(b) <= 8:
        return b, "B-cedict"
    return a, "A"


# ---------- 主流程 ----------
def load_overrides():
    if not os.path.exists(OVERRIDES):
        return {}, set()
    d = json.loads(read(OVERRIDES))
    return d.get("overrides", {}) or {}, set(d.get("drop", []) or [])


def load_example_overrides():
    """人工补写的例句：语料里匹配不到句子的词（可分动词、抽象名词等）逐条手写。"""
    if not os.path.exists(EX_SAMPLES):
        return {}
    d = json.loads(read(EX_SAMPLES))
    return {k: v for k, v in d.items() if isinstance(v, dict) and v.get("ex")}


def load_site_lemmas():
    """网站已有词（lexicon-1..9）一律不重复导入；行首 [ 开头逐行解析，容忍注释。"""
    out = set()
    for name in sorted(os.listdir(DATA_DIR)):
        if not re.match(r"lexicon-([1-9])\.js$", name):
            continue
        for line in io.open(os.path.join(DATA_DIR, name), encoding="utf-8"):
            s = line.strip().rstrip(",")
            if not s.startswith("["):
                continue
            try:
                row = json.loads(s)
            except Exception:
                continue
            if len(row) >= 7:
                out.add(str(row[0]).lower())
    return out


def pos_of(row, dict_pos):
    """词条词性优先；kaikki 词典在 word_only 匹配时可修正 spaCy 的明显错标。"""
    raw = row["pos"] or ""
    dp = dict_pos or ""
    if dp in DROP_POS and raw not in DROP_POS:
        # 词典说是专名/符号，但词表标了别的：保留词表词性，除非是专名
        if dp == "Eigenname":
            return "Eigenname"
    if row["match_type"] == "word_only" and dp in POS_MAP:
        return dp
    if raw in POS_MAP:
        return raw
    if dp in POS_MAP:
        return dp
    return raw


def js_rows(rows):
    lines = []
    for r in rows:
        arr = [r["de"], r["art"], r["zh"], r["pos"], r["lvl"], r["ex"], r["exzh"]]
        if r["reg"]:
            arr += ["", "", r["reg"]]
        lines.append("[" + ",".join(json.dumps(x, ensure_ascii=False) for x in arr) + "],")
    return "\n".join(lines)


LEX_HEADER = """/* LinguaDE 词库 Part 10 · 考试词汇 A1–C2（%d 条）
   来源：Goethe-Zertifikat A1/A2/B1 词表（DWDS 机器可读整理版）
        + 频率派生 B2/C1/C2（Tatoeba 语料词频，非官方 CEFR 认定）
        + kaikki.org / Wiktionary German（CC BY-SA 3.0）词形与英文释义
   例句：Tatoeba 德中句对（CC BY 2.0 FR），三层选句（本词条句 → 全局句库 → 人工补写），
        逐条经“含词形（含可分动词 er stellt ein）+ 中文非空 + 长度/内容”校验；
        语料里配不到句子的 97 条为人工编写例句（见 tools/data/exam_example_overrides.json）
   中文：Google Translate 机翻，已做去重义项/去语法说明/词性一致性清洗；仍标注「机器对齐 · 待抽检」
   注意：B2–C2 为词频派生，不是官方词表；正式考试请以官方词表为准。
   本文件中的德英数据衍生自 Wiktionary（CC BY-SA 3.0），按 CC BY-SA 3.0 共享。
   复跑：python tools/import_german_exam_db.py
*/
"""


def write_lexicon(rows, stats):
    body = js_rows(rows)
    js = (LEX_HEADER % len(rows)
          + "window.LD_LEX_MACHINE_FROM_10 = (window.LD_LEX || []).length;\n"
          + "window.LD_LEX = (window.LD_LEX || []).concat([\n" + body + "\n]);\n"
          + "window.LD_LEX_MACHINE = new Set([...(window.LD_LEX_MACHINE || []),\n"
          + "  ...(window.LD_LEX || []).slice(window.LD_LEX_MACHINE_FROM_10).map(x => String(x[0]).toLowerCase())]);\n")
    write(OUT_LEX, js)
    return len(js.encode("utf-8"))


def write_grammar(con):
    rows = [dict(r) for r in con.execute(
        "SELECT level_code, code, title_de, title_zh, explanation_zh, pattern, example_de, example_zh "
        "FROM grammar_points ORDER BY CASE level_code WHEN 'A1' THEN 1 WHEN 'A2' THEN 2 "
        "WHEN 'B1' THEN 3 WHEN 'B2' THEN 4 WHEN 'C1' THEN 5 ELSE 6 END, grammar_id")]
    items = [{"lv": r["level_code"], "code": r["code"] or "", "de": r["title_de"],
              "zh": r["title_zh"], "exp": r["explanation_zh"] or "",
              "pat": r["pattern"] or "", "ex": r["example_de"] or "",
              "exzh": r["example_zh"] or ""} for r in rows]
    js = ("/* LinguaDE · 语法速查 A1–C2（%d 个语法点）\n"
          "   来源：german_exam.db grammar_points（中文讲解为本项目整理，例句为自写/改编）\n"
          "   用途：句法纠错模块右侧「语法速查」；按等级筛选，点击展开。 */\n"
          "window.LD_GRAMMAR_POINTS = " % len(items)
          + json.dumps(items, ensure_ascii=False, separators=(",", ":")) + ";\n")
    write(OUT_GRAMMAR, js)
    return len(items), len(js.encode("utf-8"))


def write_exams(con):
    exams = [dict(r) for r in con.execute(
        "SELECT exam_id, name, provider, level_code, official_wordlist, url FROM exams")]
    tasks = [dict(r) for r in con.execute(
        "SELECT task_id, exam_id, module, part, minutes, items, task_type, description_zh FROM exam_tasks")]
    passc = [dict(r) for r in con.execute("SELECT exam_id, criteria_zh, note FROM pass_criteria")]
    data = {
        "exams": exams,
        "tasks": tasks,
        "pass": passc,
    }
    js = ("/* LinguaDE · 考试结构速查（%d 个考试 / %d 条模块）\n"
          "   来源：german_exam.db exams / exam_tasks / pass_criteria\n"
          "   用途：全真模考首页「考试结构」折叠表；时长/题量为公开考试说明，非官方评分细则。 */\n"
          "window.LD_EXAM_PLAN = " % (len(exams), len(tasks))
          + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    write(OUT_EXAMS, js)
    return len(exams), len(tasks), len(js.encode("utf-8"))


def write_review(review):
    fields = ["entry_id", "level", "lemma", "pos_db", "pos_final", "article", "A", "B",
              "chosen", "pick", "src", "freq", "zh", "ex", "ex_src"]
    with io.open(OUT_REVIEW, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in review:
            w.writerow(r)


def selftest():
    if not os.path.exists(OUT_LEX):
        print("缺少产物：", OUT_LEX)
        return 1
    src = read(OUT_LEX)
    rows = []
    for line in src.splitlines():
        line = line.strip().rstrip(",")
        if line.startswith("[") and line.endswith("]"):
            try:
                rows.append(json.loads(line))
            except Exception:
                pass
    errs = []
    if len(rows) < 3000:
        errs.append("词条数异常：%d" % len(rows))
    seen = set()
    for r in rows:
        de, art, zh, pos, lv = r[0], r[1], r[2], r[3], r[4]
        if not str(zh).strip():
            errs.append("缺中文：%s" % de)
        if lv not in LEVELS:
            errs.append("等级非法：%s %s" % (de, lv))
        if pos not in {"n", "v", "adj", "adv", "conj", "prep", "pron", "num", "part", "interj", "art", "phrase"}:
            errs.append("词性非法：%s %s" % (de, pos))
        if de.lower() in seen:
            errs.append("重复词条：%s" % de)
        seen.add(de.lower())
        if not str(r[5]).strip():
            errs.append("缺例句：%s" % de)
        elif not str(r[6]).strip():
            errs.append("例句缺中文：%s" % de)
    ex = read(OUT_EXAMS)
    if "LD_EXAM_PLAN" not in ex:
        errs.append("缺少考试结构文件")
    gr = read(OUT_GRAMMAR)
    if "LD_GRAMMAR_POINTS" not in gr:
        errs.append("缺少语法速查文件")
    if errs:
        print("SELFTEST FAIL")
        for e in errs[:20]:
            print("  -", e)
        return 1
    print("SELFTEST PASS：%d 词 / 语法 / 考试结构" % len(rows))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=DEFAULT_DB)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--check-drift", action="store_true",
                    help="把源库重新生成到临时目录，与仓库产物逐字节比较，不改动正式文件")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(selftest())
    if args.check_drift:
        import tempfile
        tmp = tempfile.mkdtemp(prefix="linguade-drift-")
        global OUT_LEX, OUT_GRAMMAR, OUT_EXAMS, OUT_REVIEW
        OUT_LEX = os.path.join(tmp, "lexicon-10.js")
        OUT_GRAMMAR = os.path.join(tmp, "grammar-exam.js")
        OUT_EXAMS = os.path.join(tmp, "exam-plan.js")
        OUT_REVIEW = os.path.join(tmp, "exam-vocab-review.csv")

    if not os.path.exists(args.db):
        sys.exit("找不到数据库：%s（用 --db 指定 german_exam.db）" % args.db)
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(DOCS_DIR, exist_ok=True)

    con = sqlite3.connect("file:%s?mode=ro" % args.db.replace("\\", "/"), uri=True)
    con.row_factory = sqlite3.Row
    zh2en = build_zh_index(con)
    site_lemmas = load_site_lemmas()

    # 用一次性临时表把 dict_pos 注入 v_word 的副本
    con.execute("CREATE TEMP TABLE v_word2 AS SELECT * FROM v_word")
    con.execute("ALTER TABLE v_word2 ADD COLUMN dict_pos TEXT")
    con.execute("""UPDATE v_word2 SET dict_pos = (
        SELECT de.pos FROM entry_dict ed JOIN dict_entry de ON de.id = ed.dict_id
        WHERE ed.entry_id = v_word2.entry_id)""")
    rows = [dict(r) for r in con.execute("SELECT * FROM v_word2")]
    overrides, drop = load_overrides()
    ex_ov = load_example_overrides()
    pool, index = load_pool(con)
    # 本词条自带的德中句对（sentences 表按 entry_id 绑定），先过滤再做第一层匹配
    sent = collections.defaultdict(list)
    for r in con.execute("SELECT entry_id, de, zh FROM sentences"):
        de = re.sub(r"\s+", " ", (r["de"] or "").strip())
        zh = re.sub(r"\s+", " ", (r["zh"] or "").strip())
        if not sent_ok(de, zh):
            continue
        sent[r["entry_id"]].append((de, zh) + sent_pack(de))
    freq = {r[0]: r[1] for r in con.execute("SELECT lemma_norm, rank FROM frequency")}

    used = set()
    kept, dropped, no_zh, review = [], collections.Counter(), [], []
    for r in rows:
        lemma = re.sub(r"\s+", " ", (r["lemma"] or "").strip())
        p = pos_of(r, r.get("dict_pos") or "")
        pos = POS_MAP.get(p, "")
        art = (r["article"] or "").strip()
        if not lemma or len(lemma) <= 1 or not re.search(r"[A-Za-zÄÖÜäöüß]", lemma):
            dropped["bad_lemma"] += 1; continue
        if lemma.lower() in site_lemmas:
            dropped["already_in_site"] += 1; continue
        if pos in DROP_POS or p in DROP_POS:
            dropped["pos:%s" % (p or "empty")] += 1; continue
        if " " in lemma and lemma not in MULTIWORD:
            dropped["multiword"] += 1; continue
        if lemma.endswith("-"):
            dropped["affix"] += 1; continue
        if r["wordlist_source"] == "DERIVED_FREQ":
            ge = r["bedeutung_en"] or ""
            if FORM_OF.match(ge):
                dropped["form_of"] += 1; continue
            if NAMEISH.search(ge):
                dropped["name"] += 1; continue
        if pos == "n":
            if not art and lemma in LANG_NEUTER:
                art = "das"
            if not art and lemma in PLURAL_ONLY:
                art = "die"
            if not art:
                dropped["noun_no_article"] += 1; continue
        if pos != "n":
            art = "-"

        zh, pick = choose_auto(r["bedeutung_zh"], r["bedeutung_zh_gloss"],
                               r["bedeutung_en"], pos, zh2en)
        if lemma.lower() in drop:
            dropped["override_drop"] += 1; continue
        if lemma in overrides:
            ov = overrides[lemma]
            if isinstance(ov, str):
                zh = clean_zh(ov)
            else:
                zh = clean_zh(ov.get("zh", zh))
                if ov.get("pos"):
                    pos = ov["pos"]
                if ov.get("article"):
                    art = ov["article"]
                if ov.get("lvl"):
                    r["level_code"] = ov["lvl"]
            pick = "override"
        zh = to_simplified(zh)
        if not valid_zh(zh):
            no_zh.append((r["entry_id"], r["level_code"], lemma, p, r["bedeutung_zh"], r["bedeutung_zh_gloss"]))
            review.append(dict(entry_id=r["entry_id"], level=r["level_code"], lemma=lemma,
                               pos_db=r["pos"], pos_final=pos, article=art, A=r["bedeutung_zh"],
                               B=r["bedeutung_zh_gloss"], chosen="", pick="drop-no-zh",
                               src=r["wordlist_source"], freq=freq.get(lemma.lower(), ""),
                               zh="", ex=""))
            dropped["no_zh"] += 1; continue

        single, multi, sep = form_sets(lemma, pos, [
            r.get("plural"), r.get("verb_praesens_3sg"), r.get("verb_praeteritum"),
            r.get("verb_partizip2"), r.get("komparativ"), r.get("superlativ")])
        ex = exzh = ex_src = ""
        hit = best_of(sent[r["entry_id"]], pos, single, multi, sep, used)
        if not hit:
            ids = pool_ids(single, multi, sep, index)
            hit = best_of([pool[i] for i in ids], pos, single, multi, sep, used)
            if hit:
                ex_src = "pool"
        if hit:
            if not ex_src:
                ex_src = "entry"
            ex, exzh = hit[2], to_simplified(hit[3])
        ov = ex_ov.get(lemma)
        if ov:
            ex, exzh, ex_src = ov["ex"], ov.get("exzh", ""), "manual"
        if ex and ex_src != "manual":
            used.add(ex)
        reg = ""
        if lemma.lower() in REGISTER_VULGAR:
            reg = "vulgar"
        elif lemma.lower() in REGISTER_COLLOQUIAL:
            reg = "colloquial"
        item = {"entry_id": r["entry_id"], "de": lemma, "art": art, "zh": zh, "pos": pos,
                "lvl": r["level_code"], "ex": ex, "exzh": exzh, "reg": reg,
                "src": r["wordlist_source"], "freq": freq.get(lemma.lower(), ""),
                "ex_src": ex_src}
        kept.append(item)
        review.append(dict(entry_id=r["entry_id"], level=r["level_code"], lemma=lemma,
                           pos_db=r["pos"], pos_final=pos, article=art, A=r["bedeutung_zh"],
                           B=r["bedeutung_zh_gloss"], chosen=zh, pick=pick,
                           src=r["wordlist_source"], freq=item["freq"], zh=zh, ex=ex,
                           ex_src=ex_src))

    groups = collections.defaultdict(list)
    for r in kept:
        groups[r["de"].lower()].append(r)
    out = []
    for g in groups.values():
        g.sort(key=lambda r: (r["src"] != "DWDS_GOETHE",
                              LEVELS.index(r["lvl"]) if r["lvl"] in LEVELS else 9,
                              0 if r["art"] != "-" else 1,
                              0 if r["ex"] else 1,
                              r["freq"] if isinstance(r["freq"], int) else 10 ** 9))
        out.append(g[0])
    out.sort(key=lambda r: (LEVELS.index(r["lvl"]), r["de"].lower()))

    stats = {
        "source_rows": len(rows), "kept": len(kept), "unique": len(out),
        "dropped": dict(dropped), "no_zh": no_zh,
        "by_level": dict(collections.Counter(r["lvl"] for r in out)),
        "by_src": dict(collections.Counter(r["src"] for r in out)),
        "with_example": sum(1 for r in out if r["ex"]),
        "no_example": sum(1 for r in out if not r["ex"]),
        "by_ex_src": dict(collections.Counter(r["ex_src"] for r in out if r["ex"])),
        "dup_examples": len(out) - len(set(r["ex"] for r in out if r["ex"])),
        "colloquial": sum(1 for r in out if r["reg"] == "colloquial"),
        "vulgar": sum(1 for r in out if r["reg"] == "vulgar"),
    }

    lex_kb = write_lexicon(out, stats)
    g_n, g_kb = write_grammar(con)
    e_n, t_n, e_kb = write_exams(con)
    write_review(review)

    print("源词条 %d → 保留 %d → 去重后 %d" % (len(rows), len(kept), len(out)))
    print("丢弃：", dict(dropped))
    print("分级：", stats["by_level"])
    print("来源：", stats["by_src"])
    print("例句：%d 有 / %d 无（来源 %s，重复句 %d）"
          % (stats["with_example"], stats["no_example"], stats["by_ex_src"], stats["dup_examples"]))
    print("语域：colloquial=%d vulgar=%d" % (stats["colloquial"], stats["vulgar"]))
    print("lexicon-10.js %.0f KB；grammar-exam.js %d 条 %.0f KB；exam-plan.js %d 考试/%d 模块 %.0f KB"
          % (lex_kb / 1024, g_n, g_kb / 1024, e_n, t_n, e_kb / 1024))
    if stats["no_example"]:
        print("\n仍无例句（%d）：可加进 tools/data/exam_example_overrides.json" % stats["no_example"])
        write(os.path.join(DOCS_DIR, "exam-no-example.json"),
              json.dumps([{"de": r["de"], "pos": r["pos"], "lvl": r["lvl"], "zh": r["zh"]}
                          for r in out if not r["ex"]], ensure_ascii=False, indent=1))
    if no_zh:
        print("\n无可靠中文（未入库，需覆盖或放弃）：")
        for x in no_zh[:40]:
            print("  ", x)
    con.close()
    if args.check_drift:
        drift = []
        for name, shipped in SHIPPED.items():
            fresh = os.path.join(os.path.dirname(OUT_LEX), name)
            if not os.path.exists(shipped):
                drift.append((name, "仓库缺文件"))
                continue
            a, b = read(shipped), read(fresh)
            drift.append((name, "一致" if a == b else "有差异（%d → %d 字节）" % (len(b.encode("utf-8")), len(a.encode("utf-8")))))
        print("源库 → 仓库产物漂移：")
        for name, st in drift:
            print("  %-24s %s" % (name, st))
        import shutil
        shutil.rmtree(os.path.dirname(OUT_LEX), ignore_errors=True)
        return 1 if any(st != "一致" for _, st in drift) else 0
    return selftest()


if __name__ == "__main__":
    sys.exit(main())
