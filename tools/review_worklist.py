#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""LinguaDE · 人工复核工作清单生成器

把「机器不能替你决定」的四类内容债变成可勾选、可复跑、可追踪的清单，
供扩容（例句 / 人工词条 / 词形原形 / 阅读考试化改写）逐条消化：

  A 词库缺例句 / 缺例句中文        —— 从 src/data/lexicon-*.js 直接统计
  B 词形（复数/分词）原形不在词库  —— 读 tools/lexicon_govern.py 落的 dist/review-missing-forms.json
  C 机器对齐词条待抽检             —— 从 lexicon-9.js 等距抽样，附等级与释义
  D 阅读考试化改写                 —— 统计导语（titleZh）缺失、题量、建议用时，排出改写优先级
  E 真人录音覆盖                   —— 读 dist/content-pack-audio.json 与跟读池覆盖率

用法：
  python tools/review_worklist.py            # 打印摘要
  python tools/review_worklist.py --write     # 同时写 docs/review-worklist.md + dist/review-worklist.json
"""
import argparse
import glob
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "src", "data")
MISSING = os.path.join(ROOT, "docs", "review-missing-forms.json")
AUDIO = os.path.join(ROOT, "dist", "content-pack-audio.json")
SPEECH = os.path.join(ROOT, "dist", "content-pack-speech.json")
READING = os.path.join(ROOT, "dist", "content-pack-reading.json")
OUT_MD = os.path.join(ROOT, "docs", "review-worklist.md")
OUT_JSON = os.path.join(ROOT, "docs", "review-worklist.json")
LINE_RE = re.compile(r"^\s*(\[.*\]),?$")


def lexicon_rows():
    """逐行 json.loads（治理后行内空格格式），返回 [(file, fields)]"""
    out = []
    for p in sorted(glob.glob(os.path.join(DATA_DIR, "lexicon-*.js"))):
        name = os.path.basename(p)
        with io.open(p, encoding="utf-8") as f:
            for line in f:
                m = LINE_RE.match(line.rstrip("\n"))
                if not m:
                    continue
                try:
                    out.append((name, json.loads(m.group(1))))
                except Exception:
                    continue
    return out


def read_json(path):
    if not os.path.exists(path):
        return None
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def words_of(paras):
    return sum(len(re.split(r"\s+", str(x.get("de") or "").strip())) for x in paras if x.get("de"))


def exam_secs(p):
    n = len(p.get("paras") or []) + len(p.get("headings") or [])
    q = len(p.get("tfng") or []) + len(p.get("mcq") or [])
    return max(4, int(-(-((words_of(p.get("paras") or [])) * 4 + q * 160) // 360)))


def build():
    rows = lexicon_rows()
    lex = [f for _, f in rows]
    machine = [f for n, f in rows if n in ("lexicon-9.js", "lexicon-10.js", "lexicon-11.js")]
    no_ex = [f for f in lex if not (f[5] or "").strip()]
    no_exzh = [f for f in lex if (f[5] or "").strip() and not (f[6] or "").strip()]
    forms = (read_json(MISSING) or {}).get("items") or []
    audio = read_json(AUDIO) or {}
    speech = read_json(SPEECH) or {}
    reading = (read_json(READING) or {}).get("items") or []
    pool_total = int(speech.get("count") or 0) + (int(audio.get("count") or 0) if audio else 0)

    # 抽检样本：等距取样，覆盖各等级，避免只看到头部
    step = max(1, len(machine) // 30)
    sample = machine[::step][:30]

    no_lead = [p for p in reading if not (p.get("titleZh") or "").strip()]
    thin = [p for p in reading if len(p.get("tfng") or []) + len(p.get("mcq") or []) <= 3]
    long_ones = sorted(reading, key=lambda p: -words_of(p.get("paras") or []))[:12]

    return {
        "lexicon": {"total": len(lex), "machine": len(machine), "manual": len(lex) - len(machine),
                    "no_example": len(no_ex), "no_example_zh": len(no_exzh),
                    "no_example_sample": [[f[0], f[3], f[4]] for f in no_ex[:40]],
                    "no_example_zh_sample": [f[0] for f in no_exzh[:40]]},
        "forms": {"count": len(forms), "items": forms},
        "spotcheck": {"pool": len(machine), "sampled": len(sample),
                      "rows": [[f[0], f[1], f[2], f[3], f[4]] for f in sample]},
        "reading": {"total": len(reading), "no_leadin": len(no_lead), "thin_questions": len(thin),
                    "no_leadin_ids": [p.get("id") for p in no_lead][:30],
                    "thin_ids": [p.get("id") for p in thin][:30],
                    "longest": [[p.get("id"), words_of(p.get("paras") or []),
                                 len(p.get("tfng") or []) + len(p.get("mcq") or []), exam_secs(p)] for p in long_ones]},
        "audio": {"human_files": int(audio.get("count") or 0), "inlined": int(audio.get("inlineAudio") or 0),
                  "speech_pool": pool_total,
                  "coverage": round((int(audio.get("count") or 0)) / pool_total * 100, 1) if pool_total else 0},
    }


MD = """# LinguaDE · 人工复核工作清单

> 由 `python tools/review_worklist.py --write` 生成；机器只负责把债列清楚，判断留给人。
> 每完成一项就在对应复选框打勾，复跑本工具会按最新数据重排优先级。

## A. 例句（词库 {lexicon[total]} 词）

- 无任何例句：**{lexicon[no_example]}** 条 → 目标补到 {lexicon[total]} 条全覆盖
- 有德语句但缺中文对照：**{lexicon[no_example_zh]}** 条

<details><summary>缺例句词条（前 40 条）</summary>

{no_ex_rows}

</details>

## B. 词形原形缺失（三重闸门拒绝标注，{forms[count]} 条）

这些词词典标了复数/过去分词，但原形不在当前词库，所以本轮**不标注**。
补录方式二选一：把原形作为新词条加进词库，或放弃标注（保持现状）。

<details><summary>词形 → 需要的原形</summary>

{form_rows}

</details>

## C. 机器对齐词条抽检（{spotcheck[pool]} 条，本轮抽 {spotcheck[sampled]} 条）

等级为词频估计，非官方 CEFR；释义来自 ECDICT / kaikki 对齐，需人工确认「词性 + 释义 + 例句」三件套。

<details><summary>抽检样本</summary>

{spot_rows}

</details>

## D. 阅读考试化改写（{reading[total]} 篇）

- 缺中文主题导语：**{reading[no_leadin]}** 篇
- 题目偏少（≤3 题，不够一场考试）：**{reading[thin_questions]}** 篇
- 改写口径：TestDaF 三段式（段落配小标题 + 判断正误 + 细节选择），按建议用时限时

最长 12 篇（优先做成限时套题）：

{long_rows}

## E. 真人录音覆盖（{audio[human_files]} 条本地 / 跟读池 {audio[speech_pool]} 句 = {audio[coverage]}%）

- 打进单文件（离线可播）：**{audio[inlined]}** 条，其余走 `dist/audio/` 按需播放
- 补齐：`python tools/fetch_audio.py --write --fetch --limit 160` 后再 `python tools/build.py`

## 扩容目标（例句 / 人工词条）

| 项 | 当前 | 目标 | 缺口 |
|---|---|---|---|
| 人工校订词条 | {lexicon[manual]} | 1200 | {manual_gap} |
| 词条带例句 | {with_ex} | {lexicon[total]} | {lexicon[no_example]} |
| 阅读带导语 | {leadin_ok} | {reading[total]} | {reading[no_leadin]} |
| 真人录音句 | {audio[human_files]} | 300 | {audio_gap} |

- 人工词条只能逐条写：`src/data/lexicon-1..8.js` 里按现有 7 字段格式追加，然后跑
  `python tools/lexicon_govern.py --write && python tools/test_content.py && python tools/build.py`。
- 治理脚本不会覆盖人工区（`MACHINE_START` 之前），也不会替你造例句：查不到可靠例句就留空。
"""


def render(d):
    def rows(items, head):
        cols = [c.strip() for c in head.split("|") if c.strip()]
        out = ["| " + " | ".join(cols) + " |", "|" + "|".join(["---"] * len(cols)) + "|"]
        out += ["| " + " | ".join(str(c) for c in r) + " |" for r in items]
        return "\n".join(out) if items else "_（无）_"

    manual_gap = max(0, 1200 - d["lexicon"]["manual"])
    audio_gap = max(0, 300 - d["audio"]["human_files"])
    with_ex = d["lexicon"]["total"] - d["lexicon"]["no_example"]
    leadin_ok = d["reading"]["total"] - d["reading"]["no_leadin"]
    return MD.format(
        lexicon=d["lexicon"], forms=d["forms"], spotcheck=d["spotcheck"], reading=d["reading"], audio=d["audio"],
        manual_gap=manual_gap, audio_gap=audio_gap, with_ex=with_ex, leadin_ok=leadin_ok,
        no_ex_rows=rows(d["lexicon"]["no_example_sample"], "德语 | 词性 | 等级"),
        form_rows=rows([[x["de"], x["base"], x["kind"]] for x in d["forms"]["items"][:120]], "词形 | 需要的原形 | 类型"),
        spot_rows=rows(d["spotcheck"]["rows"], "德语 | 冠词 | 中文 | 词性 | 等级"),
        long_rows="\n".join("- `%s`：%d 词 · %d 题 · 建议 %d 分钟" % (i or "-", w, q, s)
                            for i, w, q, s in d["reading"]["longest"]),
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    d = build()
    print("词库 %d 词（人工 %d / 机器 %d）· 缺例句 %d · 缺例句中文 %d" % (
        d["lexicon"]["total"], d["lexicon"]["manual"], d["lexicon"]["machine"],
        d["lexicon"]["no_example"], d["lexicon"]["no_example_zh"]))
    print("词形原形待补 %d · 抽检样本 %d · 阅读 %d 篇（缺导语 %d / 题少 %d）" % (
        d["forms"]["count"], d["spotcheck"]["sampled"], d["reading"]["total"],
        d["reading"]["no_leadin"], d["reading"]["thin_questions"]))
    print("真人录音 %d 条（内联 %d）· 覆盖跟读池 %s%%" % (
        d["audio"]["human_files"], d["audio"]["inlined"], d["audio"]["coverage"]))
    if args.write:
        with io.open(OUT_MD, "w", encoding="utf-8", newline="\n") as f:
            f.write(render(d))
        with io.open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        print("已写", os.path.relpath(OUT_MD, ROOT), "和", os.path.relpath(OUT_JSON, ROOT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
