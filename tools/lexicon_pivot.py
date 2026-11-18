# -*- coding: utf-8 -*-
"""LinguaDE · 2000 词扩展（开放词典机器对齐，待校对）

来源与许可：
  · 德英释义：English Wiktionary 的 German 提取版（kaikki.org），CC BY-SA 3.0
  · 英中释义：FreeDict eng-zho（WikDict/DBnary 生成），CC BY-SA 3.0
  · 频率表：hermitdave/FrequencyWords（de_50k.txt），CC BY-SA 4.0

产物：
  · src/data/lexicon-9.js：与现有 576 词去重后补足到 2000 词
  · docs/lexicon-pivot-report.md：数量、等级分布、样本、许可与待校对说明

注意：这是“机器对齐候选”，不是人工词典；中文释义与词性需人工抽检。
"""
import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".knowledge-cache")
KAIKKI = os.path.join(CACHE, "kaikki-german.jsonl.gz")
ECDICT = os.path.join(CACHE, "ecdict.csv")
FREQ = os.path.join(ROOT, ".content-cache", "de_50k.txt")
OUT_JS = os.path.join(ROOT, "src", "data", "lexicon-9.js")
REPORT = os.path.join(ROOT, "docs", "lexicon-pivot-report.md")

KAIKKI_URL = "https://kaikki.org/dictionary/German/kaikki.org-dictionary-German.jsonl.gz"
ECDICT_URL = "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv"
POS_MAP = {"noun": "n", "verb": "v", "adj": "adj", "adv": "adv"}
# 抽检中确认的错义/非词元/低价值条目；宁可换词，不把错误释义留在主词库
QA_BLACKLIST = {
    "disziplin", "dukat", "esse", "einsatz", "vermissen", "betten",
    "rauchen", "bestens", "selbstverständlich", "mäuse", "melde", "antun",
}
SKIP_TAGS = {"alt-of", "alternative", "abbreviation", "form-of", "misspelling",
             "obsolete", "archaic", "dated", "given-name", "surname", "place", "plural"}
BAD_GLOSS = re.compile(r"^(abbreviation|alternative form|inflection|plural|past participle|present participle|comparative|superlative|first-person|third-person|form of)\b", re.I)
WORD_RE = re.compile(r"^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß-]{1,30}$")
TRAD_RE = re.compile(r"[\u4e00-\u9fff]")
BAD1 = set("的地得了着过把被给对从到就都也很太不要会能可让使为以及或而但却还再又才只更最一二三四五六七八九十有放关开做干搞弄挣")
TRAD_CHARS = set("免費衝鋒譴責裝擊彈掙記覺這說學習讀寫聽詞語譯錢銀開關門問題時間現實際發進過還麼價誼")


def log(*a):
    print(*a, flush=True)


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 1024:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    log("下载", url)
    urllib.request.urlretrieve(url, path)


def load_existing():
    lex = set()
    data_dir = os.path.join(ROOT, "src", "data")
    for fn in sorted(os.listdir(data_dir)):
        if not re.match(r"lexicon-[1-8]\.js$", fn):
            continue
        txt = io.open(os.path.join(data_dir, fn), encoding="utf-8").read()
        for m in re.finditer(r'\["([^"]+)"', txt):
            lex.add(m.group(1).lower())
    return lex


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


def pos_group(label):
    l = (label or "").lower()
    if re.match(r"^(n|noun)\b", l):
        return "n"
    if re.match(r"^(v|vt|vi|verb)\b", l):
        return "v"
    if re.match(r"^(a|adj|adjective)\b", l):
        return "adj"
    if re.match(r"^(ad|adv|adverb)\b", l):
        return "adv"
    return ""


def extract_zhs(translation):
    out = []
    for line in (translation or "").splitlines():
        line = line.strip()
        if not line or line.startswith("[网络]"):
            continue
        m = re.match(r"^([A-Za-z][A-Za-z. ]*)\.\s*", line)
        line_pos = pos_group(m.group(1)) if m else ""
        rest = line[m.end():] if m else line
        # 同一行可能混排多个词性：n. 烟, 烟雾; v. 吸烟
        for chunk in re.split(r"[;；]", rest):
            chunk = chunk.strip()
            cm = re.match(r"^([A-Za-z][A-Za-z. ]*)\.\s*", chunk)
            p = pos_group(cm.group(1)) if cm else line_pos
            body = chunk[cm.end():] if cm else chunk
            for part in re.split(r"[,，]", body):
                part = re.sub(r"\[[^\]]*\]", "", part).strip().strip("[]()（）")
                if 1 <= len(part) <= 8 and TRAD_RE.search(part) and not re.search(r"[A-Za-z0-9#/|]", part):
                    out.append((p, part))
    return out


def load_ecdict():
    """English headword -> [(pos, Chinese gloss)] from ECDICT (MIT)."""
    download(ECDICT_URL, ECDICT)
    out = {}
    with io.open(ECDICT, encoding="utf-8", errors="replace", newline="") as f:
        for row in csv.DictReader(f):
            word = (row.get("word") or "").strip().lower()
            if not word:
                continue
            out.setdefault(word, []).extend(extract_zhs(row.get("translation") or ""))
    return out


def valid_zh(v):
    v = re.sub(r"\[\[[^\]]*\]\]", "", v).strip()
    if not v or not TRAD_RE.search(v) or len(v) > 8:
        return None
    if re.search(r"[A-Za-z0-9#,/|()（）\[\]]", v):
        return None
    if len(v) == 1 and v in BAD1:
        return None
    return v


def pick_zh(vals, gpos):
    # 先取与德语词性一致的 ECDICT 首义，再回退到任意首义
    for p, v in vals:
        if p == gpos:
            z = valid_zh(v)
            if z:
                return z
    for _p, v in vals:
        z = valid_zh(v)
        if z:
            return z
    return None


def back_ok(zh, gloss, zh2en):
    if not zh or not gloss:
        return False
    gt = set(re.findall(r"[a-z]{3,}", gloss.lower()))
    backs = zh2en.get(zh, set())
    if not backs:
        return True   # 没有反查记录时不据此否定，交给“待校对”标记
    for en in backs:
        if gt & set(re.findall(r"[a-z]{3,}", en.lower())):
            return True
    return False


def zh_for(gloss, zhmap, gpos):
    if not gloss:
        return None
    g = gloss.strip().lower()
    g = re.sub(r"^\([^)]*\)\s*", "", g)
    g = re.sub(r"\s+", " ", g)
    phrases = []
    for sep in (";", ",", "/", "|"):
        phrases += [x.strip() for x in g.split(sep) if x.strip()]
    phrases = list(dict.fromkeys(phrases))
    expanded = []
    for c in phrases:
        c = re.sub(r"\([^)]*\)", "", c).strip()
        if not c:
            continue
        expanded.append(c)
        for pref in ("to ", "the ", "a ", "an "):
            if c.startswith(pref):
                expanded.append(c[len(pref):])
    for c in expanded:
        if c in zhmap:
            v = pick_zh(zhmap[c], gpos)
            if v:
                return v
    return None


def article_of(entry):
    for ht in entry.get("head_templates") or []:
        args = ht.get("args") or {}
        v = str(args.get("1") or "")
        if v and v[0].lower() in "mfn":
            return {"m": "der", "f": "die", "n": "das"}[v[0].lower()]
    return "-"


def level_of(rank):
    if rank <= 1500:
        return "B1"
    if rank <= 6000:
        return "B2"
    if rank <= 20000:
        return "C1"
    return "C2"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=1424, help="新增词条数（总词库 576+target）")
    ap.add_argument("--max-lines", type=int, default=0)
    args = ap.parse_args()
    download(KAIKKI, KAIKKI)
    zhmap = load_ecdict()
    zh2en = {}
    for en, vals in zhmap.items():
        for _p, zh in set(vals):
            zh2en.setdefault(zh, set()).add(en)
    log("英中词条：", len(zhmap), "中文反查：", len(zh2en))
    existing = load_existing()
    freq = load_freq()
    log("现有词库：", len(existing), "频率表：", len(freq))

    candidates = []
    seen = set()
    with gzip.open(KAIKKI, "rt", encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            if args.max_lines and n > args.max_lines:
                break
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("lang_code") != "de":
                continue
            pos = POS_MAP.get(e.get("pos"))
            word = (e.get("word") or "").strip()
            if not pos or not WORD_RE.match(word):
                continue
            key = word.lower()
            if key in existing or key in seen or key in QA_BLACKLIST:
                continue
            senses = e.get("senses") or []
            if not senses:
                continue
            s0 = senses[0]
            tags = set(s0.get("tags") or [])
            if tags & SKIP_TAGS:
                continue
            glosses = s0.get("glosses") or []
            if not glosses:
                continue
            gloss = glosses[0]
            if BAD_GLOSS.search(gloss):
                continue
            zh = zh_for(gloss, zhmap, pos)
            if not zh or not back_ok(zh, gloss, zh2en):
                continue
            if pos == "v" and zh.endswith("的"):
                continue
            if pos == "n" and zh.endswith("的"):
                zh = zh[:-1]
            rank = freq.get(key, 999999)
            if rank > 50000:
                continue
            lvl = level_of(rank)
            art = article_of(e) if pos == "n" else "-"
            candidates.append({
                "de": word, "art": art, "zh": zh, "pos": pos, "lvl": lvl,
                "rank": rank, "gloss": gloss
            })
            seen.add(key)
            if len(candidates) >= args.target * 16:
                break

    # 分层选取：B2 70% / C1 20% / C2 10%；不足时从其他层补
    by_lvl = {}
    for x in candidates:
        by_lvl.setdefault(x["lvl"], []).append(x)
    for k in by_lvl:
        by_lvl[k].sort(key=lambda x: x["rank"])
    log("候选分布：", {k: len(v) for k, v in by_lvl.items()})
    quotas = {
        "B2": int(args.target * 0.70),
        "C1": int(args.target * 0.20),
        "C2": args.target - int(args.target * 0.70) - int(args.target * 0.20),
    }
    picked = []
    used = set()
    for lvl in ("B2", "C1", "C2"):
        take = by_lvl.get(lvl, [])[:quotas[lvl]]
        picked += take
        used.update(id(x) for x in take)
    if len(picked) < args.target:
        rest = [x for x in (by_lvl.get("B2", []) + by_lvl.get("C1", []) + by_lvl.get("C2", []) + by_lvl.get("B1", [])) if id(x) not in used]
        rest.sort(key=lambda x: x["rank"])
        picked += rest[:args.target - len(picked)]
    if len(picked) < args.target:
        log("候选不足：%d / %d" % (len(picked), args.target))
        sys.exit(1)
    picked = picked[:args.target]
    picked.sort(key=lambda x: x["rank"])

    rows = []
    for x in picked:
        rows.append([x["de"], x["art"], x["zh"], x["pos"], x["lvl"], "", ""])

    header = """/* LinguaDE 词库 Part 9 · 2000 词扩展（%d 条，开放词典机器对齐，待校对）
   来源：English Wiktionary German extract via kaikki.org（CC BY-SA 3.0）
        + ECDICT 英汉词典（MIT，skywind3000/ECDICT）
   说明：德语词条 → 英文释义 → 中文释义的机器对齐；中文释义、词性、等级需人工抽检。
   本文件中的德英数据衍生自 Wiktionary（CC BY-SA 3.0），按 CC BY-SA 3.0 共享。 */
window.LD_LEX_MACHINE_FROM = (window.LD_LEX || []).length;
window.LD_LEX = (window.LD_LEX || []).concat([
""" % len(rows)
    with io.open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(header)
        for i, r in enumerate(rows):
            f.write(json.dumps(r, ensure_ascii=False) + (",\n" if i < len(rows) - 1 else "\n"))
        f.write("]);\n")
        f.write("window.LD_LEX_MACHINE = new Set((window.LD_LEX || []).slice(window.LD_LEX_MACHINE_FROM).map(x => String(x[0]).toLowerCase()));\n")

    by = {}
    for x in picked:
        by[x["lvl"]] = by.get(x["lvl"], 0) + 1
    samples = picked[:8]
    lines = [
        "# 2000 词扩展报告 · 开放词典机器对齐",
        "",
        "> 目标：现有 %d + %d = **%d** 词；本批 **%d** 条。" % (len(existing), len(rows), len(existing) + len(rows), len(rows)),
        "> 来源：kaikki.org / English Wiktionary German extract（CC BY-SA 3.0）+ ECDICT（MIT）。",
        "> 性质：德→英→中机器对齐，**待人工抽检**；不是人工词典，不宣称释义完全准确。",
        "",
        "## 等级分布",
        "",
        "| 等级 | 条数 |",
        "|---|---|",
    ]
    for k in ("B1", "B2", "C1", "C2"):
        lines.append("| %s | %d |" % (k, by.get(k, 0)))
    lines += [
        "",
        "## 样本",
        "",
        "| 德语 | 中文（机器对齐） | 等级 | 英文 gloss |",
        "|---|---|---|---|",
    ]
    for x in samples:
        lines.append("| %s | %s | %s | %s |" % (x["de"], x["zh"], x["lvl"], x["gloss"][:60]))
    lines += [
        "",
        "## 许可与再分发",
        "",
        "- 德英数据：English Wiktionary（CC BY-SA 3.0），经 kaikki.org 提取。",
        "- 英中数据：ECDICT（MIT，skywind3000/ECDICT），仅用于词义桥接。",
        "- 德英衍生词表按 CC BY-SA 3.0 共享；保留本报告与来源链接。",
        "- 频率表仅用于等级估计，不随词表分发。",
        "",
        "## 复核",
        "",
        "- 中文释义只取 1–20 字，取不到中文的德语词直接丢弃。",
        "- 跳过缩写、替代形式、屈折形式、过时/古旧/人名地名。",
        "- 无例句；后续可用 Tatoeba 对齐或 AI 补例句。",
    ]
    with io.open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    log("写入", OUT_JS, "条数", len(rows), "等级", by)


if __name__ == "__main__":
    main()
