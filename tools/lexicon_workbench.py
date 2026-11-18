#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""LinguaDE · 人工审校工作台

只做一件事：让「人工看过并认可」这件事有迹可循。

- 默认读取机器词条（lexicon-9 / lexicon-10），逐条显示词头、词性、等级、释义、例句；
- 审校人按 a 认可 / r 退回 / s 跳过 / q 退出；
- 认可结果写入独立台账（默认 docs/lexicon-review-ledger.json）；
- 只有显式执行 --write 才把认可词头合并进 src/data/lexicon-human.js；
- 自动结构校验（LD_LEX_AI_REVIEWED）永远不等于人工审校，本工具不会读取它来自动通过任何词条。

用法：
  python tools/lexicon_workbench.py --list --limit 20
  python tools/lexicon_workbench.py                 # 交互审校
  python tools/lexicon_workbench.py --approve Beispiel --write
  python tools/lexicon_workbench.py --reject Beispiel --note "释义与例句不匹配"
  python tools/lexicon_workbench.py --stats
"""
import argparse
import glob
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "src", "data")
DEFAULT_LEDGER = os.path.join(ROOT, "docs", "lexicon-review-ledger.json")
HUMAN_OUT = os.path.join(DATA, "lexicon-human.js")
LINE_RE = re.compile(r"^\s*(\[.*\]),?$")
HUMAN_RE = re.compile(r'^"((?:[^"\\]|\\.)*)"\s*,?\s*$', re.M)


def read_rows():
    rows = []
    for name in ("lexicon-9.js", "lexicon-10.js"):
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            continue
        with io.open(path, encoding="utf-8") as f:
            for line in f:
                m = LINE_RE.match(line.rstrip("\n"))
                if not m:
                    continue
                try:
                    fields = json.loads(m.group(1))
                except Exception:
                    continue
                if fields and isinstance(fields[0], str):
                    rows.append({
                        "de": fields[0],
                        "art": fields[1] if len(fields) > 1 else "",
                        "zh": fields[2] if len(fields) > 2 else "",
                        "pos": fields[3] if len(fields) > 3 else "",
                        "level": fields[4] if len(fields) > 4 else "",
                        "example": fields[5] if len(fields) > 5 else "",
                        "exampleZh": fields[6] if len(fields) > 6 else "",
                        "source": name,
                    })
    by_word = {}
    for row in rows:
        by_word.setdefault(row["de"].lower(), row)
    return sorted(by_word.values(), key=lambda r: (r["level"], r["de"].lower()))


def load_ledger(path):
    if not os.path.exists(path):
        return {"version": 1, "decisions": {}}
    try:
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict) or not isinstance(data.get("decisions"), dict):
            raise ValueError("台账格式不正确")
        return data
    except Exception as exc:
        print("读取台账失败：%s" % exc, file=sys.stderr)
        return {"version": 1, "decisions": {}}


def save_ledger(path, ledger):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with io.open(tmp, "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=2, sort_keys=True)
        f.write("\n")
    os.replace(tmp, path)


def existing_human(path):
    if not os.path.exists(path):
        return set()
    with io.open(path, encoding="utf-8") as f:
        body = f.read()
    # 只读取 Set([...]) 之间的双引号字符串，不执行文件
    start = body.find("new Set([")
    if start < 0:
        return set()
    end = body.find("]", start)
    return {m.group(1).replace('\\"', '"') for m in HUMAN_RE.finditer(body[start:end])}


def write_human(path, ledger):
    approved = sorted({w for w, d in ledger.get("decisions", {}).items()
                       if d.get("status") == "approved"})
    words = sorted(existing_human(path) | set(approved), key=lambda x: x.lower())
    header = """/* LinguaDE · 人工校订覆盖（3.20）
   人工确认过释义 / 例句 / 词性的词头加入此集合；优先级最高，
   会覆盖 AI 自动复核与机器待复核。这是唯一应手工编辑的复核文件；
   lexicon-review.js 由 tools/review_batch.py 生成，请勿手改。
   审校入口：python tools/lexicon_workbench.py */
window.LD_LEX_REVIEWED = new Set([
"""
    with io.open(path, "w", encoding="utf-8") as f:
        f.write(header)
        for w in words:
            f.write("  " + json.dumps(w, ensure_ascii=False) + ",\n")
        f.write("]);\n")
    return len(approved), len(words)


def show(row):
    print("")
    print("─" * 64)
    print("词头：%s%s" % ((row["art"] + " ") if row["art"] else "", row["de"]))
    print("等级 / 词性：%s · %s" % (row["level"] or "?", row["pos"] or "?"))
    print("释义：%s" % (row["zh"] or "（空）"))
    print("例句：%s" % (row["example"] or "（空）"))
    print("例句中文：%s" % (row["exampleZh"] or "（空）"))
    print("来源：%s" % row["source"])


def decide(ledger, word, status, note=""):
    ledger.setdefault("decisions", {})[word] = {
        "status": status,
        "note": note,
        "at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    }


def interactive(args, ledger, rows):
    pending = [r for r in rows if r["de"].lower() not in ledger["decisions"]]
    if args.limit:
        pending = pending[:args.limit]
    if not pending:
        print("没有待审词条。")
        return 0
    print("待审 %d 条。a=认可  r=退回（可写备注）  s=跳过  q=退出" % len(pending))
    approved = rejected = 0
    for row in pending:
        show(row)
        choice = input("选择 [a/r/s/q]：").strip().lower()
        if choice == "q":
            break
        if choice == "a":
            decide(ledger, row["de"], "approved")
            approved += 1
            save_ledger(args.ledger, ledger)
        elif choice == "r":
            note = input("退回原因（可空）：").strip()
            decide(ledger, row["de"], "rejected", note)
            rejected += 1
            save_ledger(args.ledger, ledger)
        elif choice == "s":
            continue
        else:
            print("未知选项，已跳过。")
    print("本次认可 %d 条，退回 %d 条；台账：%s" % (approved, rejected, args.ledger))
    return approved


def main():
    parser = argparse.ArgumentParser(description="LinguaDE 人工审校工作台")
    parser.add_argument("--ledger", default=DEFAULT_LEDGER, help="审校台账路径")
    parser.add_argument("--out", default=HUMAN_OUT, help="人工校订覆盖文件")
    parser.add_argument("--list", action="store_true", help="只列出待审词条，不进入交互")
    parser.add_argument("--limit", type=int, default=0, help="限制本次处理数量")
    parser.add_argument("--approve", action="append", default=[], help="认可一个词头，可重复")
    parser.add_argument("--reject", action="append", default=[], help="退回一个词头，可重复")
    parser.add_argument("--note", default="", help="与 --reject/--approve 一起写入的备注")
    parser.add_argument("--write", action="store_true", help="把认可词头写入 lexicon-human.js")
    parser.add_argument("--stats", action="store_true", help="输出台账统计")
    args = parser.parse_args()

    rows = read_rows()
    if not rows:
        print("没有读到机器词条；先运行词库构建/治理。", file=sys.stderr)
        return 2
    ledger = load_ledger(args.ledger)

    if args.approve or args.reject:
        known = {r["de"].lower() for r in rows}
        for word in args.approve:
            if word.lower() not in known:
                print("警告：%s 不在机器词条中；仍写入台账前请确认词头。" % word, file=sys.stderr)
            decide(ledger, word, "approved", args.note)
        for word in args.reject:
            decide(ledger, word, "rejected", args.note)
        save_ledger(args.ledger, ledger)
        print("台账已更新：%s" % args.ledger)

    if args.stats:
        decisions = ledger.get("decisions", {})
        print("机器词条：%d" % len(rows))
        print("已认可：%d" % sum(1 for d in decisions.values() if d.get("status") == "approved"))
        print("已退回：%d" % sum(1 for d in decisions.values() if d.get("status") == "rejected"))
        print("待审：%d" % sum(1 for r in rows if r["de"].lower() not in decisions))

    if args.list:
        pending = [r for r in rows if r["de"].lower() not in ledger["decisions"]]
        if args.limit:
            pending = pending[:args.limit]
        for row in pending:
            print("%-18s %-3s %-8s %s" % (row["de"], row["level"], row["pos"], row["zh"][:48]))
        print("共 %d 条待审" % len(pending))
        return 0

    if not args.approve and not args.reject and not args.stats and not args.write:
        interactive(args, ledger, rows)

    if args.write:
        approved, total = write_human(args.out, ledger)
        print("已写入 %s：台账认可 %d 条，文件共 %d 条人工校订词头" % (args.out, approved, total))
    return 0


if __name__ == "__main__":
    sys.exit(main())
