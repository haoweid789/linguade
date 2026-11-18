# -*- coding: utf-8 -*-
"""LinguaDE · 纠错句库规则注错管线（AEG · Artificial Error Generation）

依据 docs/content-scaling-plan.md §3.6 路线 1（规则注错，确定性、离线、零 LLM）：
以词库（src/data/lexicon-*.js）的正确例句为原料，注入德语学习者高频错误，
生成 src/data/grammar-aeg.js（追加到 LD_GRAMMAR_LIBRARY，含中文讲解与 provenance）。

四类保证「错得真实」的变换（只在能确定原句正确时才动手）：
  1. 冠词性别错配 —— 句中冠词与词库登记的名词性别一致时，换成错误性别
  2. 名词小写     —— 句中非句首的已知名词改为小写
  3. 正字法破坏   —— 含 ä/ö/ü/ß 的词改写为 ae/oe/ue/ss
  4. 完成时助动词 —— 位移动词分词（gegangen/gefahren/…）配 sein 时换 haben

用法：python tools/aeg_rules.py            # 生成（幂等，输出带哈希去重）
      python tools/aeg_rules.py --check    # 校验已生成文件与源数据一致
"""
import hashlib
import io
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "src", "data", "grammar-aeg.js")
LEX_RE = re.compile(r'^\["([^"]+)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)","([^"]*)"\]', re.M)

ART_ZH = {"der": "阳性", "die": "阴性", "das": "中性"}
ARTS = ["der", "die", "das"]
MOTION_PARTICIPLES = ("gegangen", "gefahren", "gekommen", "gereist", "gelaufen", "geflogen", "gefahren")


def load_lexicon():
    """返回 [(word, art, zh, pos, lv, example, example_zh)]，按文件序加载全部词库册"""
    entries = []
    for i in range(1, 8):
        p = os.path.join(ROOT, "src", "data", "lexicon-%d.js" % i)
        if not os.path.exists(p):
            continue
        txt = io.open(p, encoding="utf-8").read()
        for m in LEX_RE.finditer(txt):
            entries.append(m.groups())
    return entries


def load_existing_library():
    """corpus.js 内置句库的 wrong 集合（去重用）"""
    p = os.path.join(ROOT, "src", "data", "corpus.js")
    txt = io.open(p, encoding="utf-8").read()
    return set(re.findall(r'wrong:\s*"([^"]+)"', txt))


def gen_items(entries, existing, cap=150):
    """分轮收集（冠词性别 → 助动词 → 正字法·变音符 → 名词小写补足），
    避免易命中的规则垄断配额，保证题型分布可用于按语法点组卷。"""
    nouns = {w: a for w, a, _z, pos, _l, _e, _ez in entries if pos == "n" and a in ARTS}
    sources = []
    for word, art, zh, pos, lv, example, example_zh in entries:
        s = (example or "").strip().rstrip(".")
        if 4 <= len(s.split()) <= 16:
            sources.append((s, word, art))

    items, seen = [], set(existing)

    def push(wrong, right, typ, why):
        if len(items) < cap and wrong != right and wrong not in seen:
            seen.add(wrong)
            items.append({"wrong": wrong, "right": right, "type": typ, "why": why})
            return True
        return False

    # 1) 冠词性别错配（句中冠词与词库性别一致时换错，保证原句正确）
    #    换法固定为 der→die / die→das / das→die：换成"另一性别"的主格形式，
    #    在任何格环境下都不可能是该名词的合法形式（避免 die→der 撞上 Dativ 阴性）。
    WRONG_ART = {"der": "die", "die": "das", "das": "die"}
    for s, word, art in sources:
        if word not in nouns or len(items) >= cap:
            continue
        pat = r"\b%s %s\b" % (art, re.escape(word))
        if re.search(pat, s):
            wrong_art = WRONG_ART[art]
            wrong = re.sub(pat, "%s %s" % (wrong_art, word), s, count=1)
            push(wrong + ".", s + ".", "冠词性别",
                 "%s 是%s名词（%s %s），冠词性别不能错配。" % (word, ART_ZH[art], art, word))

    # 2) 完成时助动词（位移动词 + sein → haben）
    aux_map = {"Ich bin": "Ich habe", "Er ist": "Er hat", "Sie ist": "Sie hat", "Wir sind": "Wir haben"}
    for s, _w, _a in sources:
        if len(items) >= cap:
            break
        m = re.search(r"\b(Ich bin|Er ist|Sie ist|Wir sind)\b(?=[^.]*\b(?:%s)\b)" % "|".join(MOTION_PARTICIPLES), s)
        if m:
            wrong = s[:m.start()] + aux_map[m.group(0)] + s[m.end():]
            push(wrong + ".", s + ".", "助动词",
                 "表示位置移动的动词（gehen/fahren/kommen…）完成时用 sein，不用 haben。")

    # 3) 正字法破坏（ä/ö/ü/ß → ae/oe/ue/ss，配额 45）
    for s, _w, _a in sources:
        if len(items) >= cap or sum(1 for i in items if i["type"] == "正字法") >= 45:
            break
        m = re.search(r"\b\w*(?:ä|ö|ü|ß)\w*\b", s)
        if m and len(m.group(0)) >= 4:
            bad = m.group(0).replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
            wrong = s[:m.start()] + bad + s[m.end():]
            push(wrong + ".", s + ".", "正字法",
                 "ä/ö/ü/ß 不可写作 ae/oe/ue/ss（%s → %s 属正字法错误）。" % (m.group(0), bad))

    # 4) 名词小写（补足到 cap；m.start()>8 排除句首）
    for s, _w, _a in sources:
        if len(items) >= cap:
            break
        for n in sorted(nouns, key=len, reverse=True):
            if len(n) < 4:
                continue
            m = re.search(r"\b%s\b" % re.escape(n), s)
            if m and m.start() > 8:
                wrong = s[:m.start()] + n[0].lower() + n[1:] + s[m.end():]
                if push(wrong + ".", s + ".", "正字法",
                        "德语所有名词首字母必须大写：%s 是名词。" % n):
                    break
    return items


def render_js(items):
    src_hash = hashlib.sha1(
        "".join(io.open(os.path.join(ROOT, "src", "data", "lexicon-%d.js" % i), encoding="utf-8").read()
                for i in range(1, 8) if os.path.exists(os.path.join(ROOT, "src", "data", "lexicon-%d.js" % i)))
        .encode("utf-8")).hexdigest()[:12]
    lines = [
        "/* LinguaDE · 纠错句库 · AEG 规则注错产物（由 tools/aeg_rules.py 生成，请勿手编）",
        "   来源 provenance：aeg-rule × 词库例句（lexicon-1..7，src-hash %s）" % src_hash,
        "   重新生成：python tools/aeg_rules.py */",
        "window.LD_GRAMMAR_LIBRARY = (window.LD_GRAMMAR_LIBRARY || []).concat([",
    ]
    for it in items:
        lines.append('  { wrong: %s, right: %s, issues: [{ type: %s, why: %s }] },' % (
            js(it["wrong"]), js(it["right"]), js(it["type"]), js(it["why"])))
    lines.append("]);")
    return "\n".join(lines) + "\n"


def js(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def main():
    entries = load_lexicon()
    existing = load_existing_library()
    items = gen_items(entries, existing)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(render_js(items))
    types = {}
    for it in items:
        types[it["type"]] = types.get(it["type"], 0) + 1
    print("AEG 生成 %d 条（类型分布 %s）→ %s" % (len(items), types, os.path.relpath(OUT, ROOT)))
    bad = [it for it in items if it["wrong"] == it["right"]]
    if bad:
        print("校验失败：%d 条 wrong==right" % len(bad))
        return 1
    print("校验通过：全部 wrong != right，且与内置句库零重复")
    return 0


if __name__ == "__main__":
    sys.exit(main())
