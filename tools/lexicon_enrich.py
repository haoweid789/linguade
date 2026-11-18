# -*- coding: utf-8 -*-
"""LinguaDE · 词表富化管线（3.5.0-d）：候选高频词 → LLM 批量富化 → 质检 → 入库

依据 docs/content-scaling-plan.md §3.1 与 §六 的质量红线：
  · 候选来源：频率表（.content-cache/de_50k.txt 前 N）− 现有词库（src/data/lexicon-*.js）
  · 富化通道：
      --channel llm   调用 OpenAI 兼容接口批量生成「词性 / 中文释义 / 例句 / 例句译文 / CEFR 等级」
      --channel stub  离线占位（zh 留空）——仅用于验证流程与质检规则，**不会入库**
  · 质量红线（content-scaling-plan §六）：**无中文释义的词不进词库**；词性/等级必须在枚举内；例句需含该词
  · 幂等与断点续跑：结果逐条落 `.lexicon-cache/enriched.jsonl`，重复运行只补缺失的词
  · 人工抽检：`docs/lexicon-review.md` 列出「随机 5% + 全部低置信（zh 过长/例句不合规）」供复核

用法：
  python tools/lexicon_enrich.py --selftest
  python tools/lexicon_enrich.py --candidates                 # 产出候选清单
  python tools/lexicon_enrich.py --enrich --channel stub      # 走通流程（不入库）
  python tools/lexicon_enrich.py --all --channel llm \\
      --base-url https://<maas>/v1 --api-key sk-xxx --model deepseek-chat
  python tools/lexicon_enrich.py --pack                       # 质检 + 入库 + 抽检清单
"""
import argparse
import io
import json
import os
import random
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, ".lexicon-cache")
CAND = os.path.join(CACHE_DIR, "candidates.json")
ENRICHED = os.path.join(CACHE_DIR, "enriched.jsonl")
OUT_JS = os.path.join(ROOT, "src", "data", "lexicon-8.js")
OUT_JSON = os.path.join(ROOT, "dist", "content-pack-lexicon.json")   # 独立内容包（部署形态可一键导入）
REVIEW = os.path.join(ROOT, "docs", "lexicon-review.md")
REPORT = os.path.join(ROOT, "docs", "lexicon-enrich-report.md")
FREQ = os.path.join(ROOT, ".content-cache", "de_50k.txt")
INDEX = os.path.join(ROOT, "index.html")

POS_SET = {"n", "v", "adj", "adv", "prep", "conj", "pron", "num", "phr"}
LVL_SET = {"A1", "A2", "B1", "B2", "C1", "C2"}
SYS = ("你是德语词典编者。为给定的德语词条逐一给出词性与中文释义，输出严格 JSON 数组，每项："
       '{"de":"原词","art":"der|die|das|—","zh":"中文释义(<=15字)","pos":"n|v|adj|adv|prep|conj|pron|num|phr",'
       '"lvl":"A1|A2|B1|B2|C1|C2","ex":"德语例句(6-14词且含该词)","exzh":"例句中文"}\n'
       "要求：释义准确简明；例句自然、贴近留德学习生活；lvl 按 CEFR 估计。只输出 JSON，不要任何解释。")


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- 词库 / 候选
def load_existing():
    lex = {}
    data_dir = os.path.join(ROOT, "src", "data")
    for fn in sorted(os.listdir(data_dir)):
        if not re.match(r"lexicon-\d+\.js$", fn):
            continue
        for line in io.open(os.path.join(data_dir, fn), encoding="utf-8"):
            s = line.strip().rstrip(",")
            if not s.startswith("["):
                continue
            try:
                row = json.loads(s)
            except Exception:
                continue
            if len(row) >= 7:
                lex[row[0]] = {"art": row[1], "zh": row[2], "lvl": row[4]}
    return lex


def load_freq_rank():
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


def candidates(top=5000):
    """频率表前 top 名中，尚未入词库的词（排除首字母非大写、含连字符数字、长度 <4 的噪声）"""
    lex = load_existing()
    rank = load_freq_rank()
    if not rank:
        raise SystemExit("缺少频率表 .content-cache/de_50k.txt（先跑 tools/content_pipeline.py --all）")
    have = {k.lower() for k in lex}
    out = []
    for w, r in sorted(rank.items(), key=lambda kv: kv[1]):
        if r > top:
            break
        if w in have or len(w) < 4 or not w[0].isalpha():
            continue
        if any(ch.isdigit() for ch in w):
            continue
        out.append(w.capitalize())
    os.makedirs(CACHE_DIR, exist_ok=True)
    with io.open(CAND, "w", encoding="utf-8") as f:
        json.dump({"top": top, "existing": len(lex), "count": len(out), "words": out}, f, ensure_ascii=False, indent=1)
    log("候选词 %d 个（现有词库 %d，频率表前 %d）→ %s" % (len(out), len(lex), top, CAND))
    return out


# ---------------------------------------------------------------- 富化通道
def load_enriched():
    rows = {}
    if os.path.exists(ENRICHED):
        for line in io.open(ENRICHED, encoding="utf-8"):
            line = line.strip()
            if line:
                try:
                    o = json.loads(line)
                    if o.get("model") == "stub":      # stub 占位不算有效富化（红线：无中文释义不入库）
                        continue
                    rows[o["de"]] = o
                except json.JSONDecodeError:
                    continue
    return rows


def _safe_json_list(txt):
    s = (txt or "").strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    i, j = s.find("["), s.rfind("]")
    if i < 0 or j <= i:
        return None
    try:
        v = json.loads(s[i:j + 1])
        return v if isinstance(v, list) else None
    except json.JSONDecodeError:
        return None


def enrich_llm(words, base_url, api_key, model, batch=20):
    """OpenAI 兼容接口批量富化；结果追加落盘（幂等）"""
    done = load_enriched()
    todo = [w for w in words if w not in done]
    log("待富化 %d 个（已缓存 %d）" % (len(todo), len(done)))
    with io.open(ENRICHED, "a", encoding="utf-8") as out:
        for i in range(0, len(todo), batch):
            chunk = todo[i:i + batch]
            body = json.dumps({
                "model": model, "temperature": 0.3,
                "messages": [{"role": "system", "content": SYS},
                             {"role": "user", "content": "词表：" + ", ".join(chunk)}],
            }).encode("utf-8")
            req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", data=body,
                                         headers={"Content-Type": "application/json",
                                                  "Authorization": "Bearer " + api_key})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    j = json.loads(r.read().decode("utf-8"))
                content = (j.get("choices") or [{}])[0].get("message", {}).get("content", "")
                arr = _safe_json_list(content) or []
            except Exception as e:
                log("  ! 批次 %d 失败：%s" % (i // batch + 1, str(e)[:100]))
                continue
            got = 0
            for it in arr:
                if not isinstance(it, dict) or not it.get("de"):
                    continue
                it["model"] = model
                it["at"] = time.strftime("%Y-%m-%d")
                out.write(json.dumps(it, ensure_ascii=False) + "\n")
                got += 1
            out.flush()
            log("  批次 %d：%d/%d 条" % (i // batch + 1, got, len(chunk)))
            time.sleep(0.3)
    return load_enriched()


def enrich_stub(words):
    """离线占位：结构齐备但 zh 为空 —— 用于验证流程与质检（不会入库）"""
    done = load_enriched()
    todo = [w for w in words if w not in done]
    with io.open(ENRICHED, "a", encoding="utf-8") as out:
        for w in todo:
            out.write(json.dumps({"de": w, "art": "—", "zh": "", "pos": "n", "lvl": "B2",
                                  "ex": "", "exzh": "", "model": "stub", "at": time.strftime("%Y-%m-%d")},
                                 ensure_ascii=False) + "\n")
    log("stub 占位写入 %d 条（zh 为空 → 质检必不通过，不会入库）" % len(todo))
    return load_enriched()


# ---------------------------------------------------------------- 质检 / 打包
def check(rows):
    """返回 (passed, rejected, reasons)"""
    lex = load_existing()
    have = {k.lower() for k in lex}
    passed, rejected = [], []
    for de, o in sorted(rows.items()):
        why = []
        zh = (o.get("zh") or "").strip()
        pos = (o.get("pos") or "").strip()
        lvl = (o.get("lvl") or "").strip()
        ex = (o.get("ex") or "").strip()
        if not zh:
            why.append("无中文释义（红线）")
        if len(zh) > 30:
            why.append("释义过长")
        if pos not in POS_SET:
            why.append("词性不在枚举内：%s" % pos)
        if lvl not in LVL_SET:
            why.append("等级不在枚举内：%s" % lvl)
        if ex and de.lower() not in ex.lower():
            why.append("例句不含该词")
        if de.lower() in have:
            why.append("与现有词库重复")
        (passed if not why else rejected).append((de, o, why))
    return passed, rejected, [w for _, _, w in rejected for w in w]


def pack(passed, rejected):
    """生成 src/data/lexicon-8.js（仅质检通过）+ 抽检清单 + 报告；并把脚本引入 index.html"""
    order = {"A1": 0, "A2": 1, "B1": 2, "B2": 3, "C1": 4, "C2": 5}
    passed.sort(key=lambda kv: (order.get(kv[1].get("lvl"), 9), kv[0]))
    rows = "".join(
        '["%s","%s","%s","%s","%s","%s","%s"],\n' % (
            de, o.get("art", "—"), o.get("zh", ""), o.get("pos", ""), o.get("lvl", ""),
            o.get("ex", "").replace('"', "'"), o.get("exzh", "").replace('"', "'"))
        for de, o, _ in passed)
    header = ("/* LinguaDE 词库 Part 8 · 由 tools/lexicon_enrich.py 生成（%s）\n"
              "   来源：频率表候选 + LLM 富化 + 质检红线（无中文释义不入库）；请勿手工编辑 */\n"
              % time.strftime("%Y-%m-%d"))
    body = "window.LD_LEX = (window.LD_LEX || []).concat([\n" + rows + "]);\n"
    with io.open(OUT_JS, "w", encoding="utf-8") as f:
        f.write(header + body)
    log("已入库 %d 词 → %s（拒绝 %d 条）" % (len(passed), OUT_JS, len(rejected)))

    # 同步产出独立内容包：部署形态下可由前端检测同源 pack 文件一键导入（与 lexicon-8.js 内容一致）
    dist = os.path.dirname(OUT_JSON)
    if not os.path.isdir(dist):
        os.makedirs(dist)
    with io.open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump({
            "pack": "lexicon", "version": "3.5.0-d",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "source": "频率表候选 + LLM 富化 + 质检红线（无中文释义不入库）",
            "count": len(passed),
            "items": [{
                "de": de, "art": o.get("art", "—"), "zh": o.get("zh", ""), "pos": o.get("pos", ""),
                "lvl": o.get("lvl", ""), "ex": o.get("ex", ""), "exzh": o.get("exzh", "")
            } for de, o, _ in passed]
        }, f, ensure_ascii=False, indent=1)
    log("独立内容包：", OUT_JSON)

    # 引入 index.html（幂等）
    html = io.open(INDEX, encoding="utf-8").read()
    tag = '<script src="src/data/lexicon-8.js"></script>'
    if tag not in html:
        anchor = '<script src="src/data/corpus-ext.js"></script>'
        if anchor in html:
            html = html.replace(anchor, anchor + "\n" + tag, 1)
            io.open(INDEX, "w", encoding="utf-8").write(html)
            log("已把 lexicon-8.js 引入 index.html")

    # 抽检清单：随机 5%（至少 5 条）+ 全部被拒原因聚类
    rng = random.Random(20261025)
    sample = rng.sample(passed, min(len(passed), max(5, len(passed) // 20))) if passed else []
    lines = ["# 词表富化 · 人工抽检清单\n",
             "> 由 `tools/lexicon_enrich.py --pack` 生成 · 抽样 5%%（至少 5 条）+ 拒绝原因聚类\n",
             "## 一、抽样复核（请逐条确认释义与例句）\n",
             "| 词 | 冠词 | 中文释义 | 词性 | 等级 | 例句 | 例句中文 |", "|---|---|---|---|---|---|---|"]
    for de, o, _ in sample:
        lines.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            de, o.get("art", ""), o.get("zh", ""), o.get("pos", ""), o.get("lvl", ""),
            o.get("ex", ""), o.get("exzh", "")))
    lines.append("\n## 二、被拒条目（按原因计数）\n")
    cnt = {}
    for de, o, why in rejected:
        for w in why:
            k = w.split("：")[0]
            cnt[k] = cnt.get(k, 0) + 1
    for k, v in sorted(cnt.items(), key=lambda kv: -kv[1]):
        lines.append("- %s：%d 条" % (k, v))
    lines.append("\n## 三、红线提醒\n")
    lines.append("- **无中文释义的词绝不入库**（content-scaling-plan §六）；")
    lines.append("- 词性、等级必须在枚举内；例句必须含该词；与现有词库重复者自动剔除。")
    with io.open(REVIEW, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    log("抽检清单：", REVIEW)

    with io.open(REPORT, "w", encoding="utf-8") as f:
        f.write("# 词表富化管线报告（3.5.0-d）\n\n"
                "| 指标 | 值 |\n|---|---|\n"
                "| 候选词 | %d |\n| 通过质检入库 | **%d** |\n| 被拒 | %d |\n| 产出文件 | `src/data/lexicon-8.js` |\n"
                % (len(passed) + len(rejected), len(passed), len(rejected)))
    log("报告：", REPORT)


# ---------------------------------------------------------------- 自检
def selftest():
    lex = load_existing()
    assert len(lex) >= 400, "现有词库解析异常：%d" % len(lex)
    rows = {
        "Hausboot": {"de": "Hausboot", "art": "das", "zh": "船屋", "pos": "n", "lvl": "B2",
                     "ex": "Wir haben im Urlaub auf einem Hausboot geschlafen.", "exzh": "我们假期睡在船屋上。"},
        "vermeintlich": {"de": "vermeintlich", "art": "—", "zh": "", "pos": "adj", "lvl": "C1", "ex": "", "exzh": ""},
        "blubbern": {"de": "blubbern", "art": "—", "zh": "咕噜作响", "pos": "verb", "lvl": "B2", "ex": "Das Wasser blubbert.", "exzh": "水在咕噜响。"},
        "Hausboot7": {"de": "Hausboot7", "art": "das", "zh": "船屋", "pos": "n", "lvl": "B2", "ex": "x", "exzh": ""},
    }
    passed, rejected, _ = check(rows)
    ids = {d for d, _, _ in passed}
    wrej = {d for d, _, _ in rejected}
    assert "Hausboot" in ids, "合规条目应通过"
    assert "vermeintlich" in wrej, "无中文释义必须被拒（红线）"
    assert "blubbern" in wrej, "非法词性必须被拒"
    assert "Hausboot7" in wrej, "例句不含该词必须被拒"
    assert _safe_json_list('```json\n[{"de":"A"}]\n```') == [{"de": "A"}]
    assert _safe_json_list("no json") is None
    log("SELFTEST PASS：词库解析 / 质检红线（zh 缺失 / 非法词性 / 例句不含词）/ JSON 解析 均正确")


def main():
    ap = argparse.ArgumentParser(description="LinguaDE 词表富化管线（候选 → LLM → 质检 → 入库）")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--candidates", action="store_true")
    ap.add_argument("--enrich", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--pack", action="store_true")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--channel", choices=["llm", "stub"], default="stub")
    ap.add_argument("--top", type=int, default=5000)
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 个候选（控成本）")
    ap.add_argument("--base-url", default="")
    ap.add_argument("--api-key", default="")
    ap.add_argument("--model", default="deepseek-chat")
    a = ap.parse_args()

    if a.selftest:
        selftest()
        return 0

    words = None
    if a.candidates or a.all:
        words = candidates(a.top)
    elif os.path.exists(CAND):
        words = json.load(io.open(CAND, encoding="utf-8"))["words"]
    if a.limit and words:
        words = words[:a.limit]

    if a.enrich or a.all:
        if a.channel == "llm":
            if not a.base_url or not a.api_key:
                raise SystemExit("--channel llm 需要 --base-url 与 --api-key")
            enrich_llm(words, a.base_url, a.api_key, a.model)
        else:
            enrich_stub(words)

    if a.pack or a.all or a.check:
        rows = load_enriched()
        if not rows:
            raise SystemExit("没有富化结果：先跑 --enrich（.lexicon-cache/enriched.jsonl 为空）")
        passed, rejected, why = check(rows)
        log("质检：通过 %d / 拒绝 %d" % (len(passed), len(rejected)))
        if passed:
            pack(passed, rejected)
        else:
            log("无可入库条目（红线：无中文释义不入库）。拒绝原因聚类：")
            cnt = {}
            for w in why:
                k = w.split("：")[0]
                cnt[k] = cnt.get(k, 0) + 1
            for k, v in sorted(cnt.items(), key=lambda kv: -kv[1]):
                log("  - %s：%d" % (k, v))
    return 0


if __name__ == "__main__":
    sys.exit(main())