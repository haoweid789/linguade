# -*- coding: utf-8 -*-
"""C2 阶段成效报告 e2e：空态引导 / 指标与 Markdown 形状 / 两次生成的对比 / 导出无报错。"""
import pytest

from conftest import goto

HEADER = "过程数据，非考试分数"


def _inject_activity(page, n=40):
    """注入作答与时长，让报告有内容（不依赖真实练习）"""
    page.evaluate("""(n) => {
      for (let i = 0; i < n; i++) {
        LD.Store.logAnswer({ type: 'vocab', ability: 'vocab', ok: i % 3 !== 0, ms: 3000, item: 'w' + i });
      }
      LD.Store.s.daily[LD.Store.dayKey()] = 25;
      LD.Store.s.fsrs['w1'] = { kind: 'word', stability: 30, difficulty: 5, reps: 6, lapses: 0, last: Date.now(), due: Date.now() + 86400000 };
      LD.Store.s.fsrs['w2'] = { kind: 'word', stability: 9, difficulty: 5, reps: 3, lapses: 1, last: Date.now(), due: Date.now() + 86400000 };
      LD.Store.save();
    }""", n)


def test_report_card_empty_state_guides(page):
    """无数据时不渲染空表：给「先做分级测评 / 先去练习」的引导"""
    goto(page, "analytics")
    page.wait_for_timeout(250)
    html = page.evaluate("() => document.getElementById('view').innerHTML")
    assert "阶段成效报告" in html
    assert "还没有可报告的数据" in html
    assert "导出 Markdown" not in html


def test_report_collect_shape_and_markdown(page):
    """collect() 字段完整；Markdown 含固定声明与口径，无模板残留"""
    _inject_activity(page)
    out = page.evaluate("""() => {
      const R = LD.Report;
      const snap = R.collect();
      const md = R.toMarkdown(snap, null);
      return { snap, md };
    }""")
    snap = out["snap"]
    for key in ["daysUsed", "streak", "minTotal", "answers", "vocab", "bkt", "wrong", "at"]:
        assert key in snap, key
    for key in ["built", "seen", "mastered", "due"]:
        assert key in snap["vocab"], key
    assert snap["vocab"]["mastered"] == 1 and snap["vocab"]["seen"] == 2
    md = out["md"]
    assert HEADER in md
    assert "口径（report-v1）" in md
    assert "掌握（≥21 天）" in md
    assert "${" not in md and "undefined" not in md
    assert "首次报告：本次数值将作为下次的对比基线" in md


def test_report_second_run_shows_deltas(page):
    """两次生成之间注入作答 → 第二次出现「较上次报告」逐项对比"""
    _inject_activity(page)
    first = page.evaluate("() => LD.Report.buildAndStore()")
    assert "首次报告" in first["md"]
    page.evaluate("""() => {
      for (let i = 0; i < 20; i++) LD.Store.logAnswer({ type: 'vocab', ability: 'vocab', ok: true, ms: 2000, item: 'x' + i });
      LD.Store.s.fsrs['w3'] = { kind: 'word', stability: 25, difficulty: 5, reps: 5, lapses: 0, last: Date.now(), due: Date.now() + 86400000 };
      LD.Store.save();
    }""")
    second = page.evaluate("""() => {
      const r = LD.Report.buildAndStore();
      return { md: r.md, deltas: LD.Report.deltas(r.snap, r.prev) };
    }""")
    assert "较上次报告" in second["md"]
    assert "首次报告" not in second["md"]
    labels = [d["label"] for d in second["deltas"]]
    assert "掌握词" in labels and "累计答对" in labels
    m = [d for d in second["deltas"] if d["label"] == "掌握词"][0]
    assert m["old"] == 1 and m["cur"] == 2 and m["diff"] == 1


def test_report_export_click_no_errors(page, errors):
    """学情页点「导出 Markdown」不抛错、不产生控制台错误，且刷新后出现对比基线"""
    _inject_activity(page)
    goto(page, "analytics")
    page.wait_for_timeout(300)
    btn = page.locator("#reportExport")
    assert btn.count() == 1
    btn.click()
    page.wait_for_timeout(300)
    html = page.evaluate("() => document.getElementById('view').innerHTML")
    assert "较上次报告" in html or "首次报告" in html
    real = [e for e in errors if "favicon" not in e]
    assert real == [], real


def test_report_baseline_persisted(page):
    """生成的报告写进 profile.lastReport 并随导出/云同步走"""
    _inject_activity(page)
    page.evaluate("() => LD.Report.buildAndStore()")
    lr = page.evaluate("() => LD.Store.s.profile.lastReport")
    assert lr and lr["vocab"]["mastered"] == 1
    snap_json = page.evaluate("() => JSON.stringify(LD.Store.snapshot().profile.lastReport || null)")
    assert "vocab" in snap_json