# -*- coding: utf-8 -*-
"""B2 SRS 升级测试：FSRS 调度器数学 / v3→v4 迁移 / 7 粒度 API / 全站口径。

浏览器端 store/engine 测试复用 conftest 的 page fixture（已加载 index.html，不重复 goto）。
"""
import json
import subprocess

import pytest


# ---------- Node 侧：FSRS 数学（不依赖浏览器） ----------

def _node_eval(body: str) -> str:
    """body 内可用 window.LD.Srs；返回值 JSON 打印。"""
    code = (
        "const fs=require('fs');globalThis.window={};"
        "eval(fs.readFileSync('src/core/srs.js','utf-8'));"
        f"console.log(JSON.stringify((function(){{ {body} }})()));"
    )
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def test_fsrs_rating_monotonic():
    """首评稳定性：again < hard < good < easy。"""
    out = _node_eval(
        "var w=window.LD.Srs.DEFAULT_W;"
        "return {a:window.LD.Srs.initFromRating(w,0).S,h:window.LD.Srs.initFromRating(w,1).S,"
        "g:window.LD.Srs.initFromRating(w,2).S,e:window.LD.Srs.initFromRating(w,3).S};"
    )
    v = json.loads(out)
    assert v["a"] < v["h"] < v["g"] < v["e"]


def test_fsrs_curve_self_consistent():
    """R(S, t=S) ≈ 0.9（稳定性定义自洽）。"""
    assert abs(float(_node_eval("return window.LD.Srs.recall(3.173, 3.173);")) - 0.9) < 0.02


def test_fsrs_no_interval_collapse():
    """1000 词 180 天模拟：无间隔塌陷（到期词存量 > 50，复习量 > 200）。"""
    out = _node_eval(
        "var s=42;function rnd(){s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff;}"
        "var cards=[];for(var i=0;i<1000;i++)cards.push(window.LD.Srs.initCard('word'));"
        "var t=Date.now(),reviews=0;"
        "for(var d=0;d<180;d++){"
        "var due=cards.filter(function(c){return c.last>0&&c.due<=t;});"
        "for(var j=0;j<due.length;j++){var c=due[j];"
        "var R=window.LD.Srs.cardRecall(c,t);var rating=R>0.85?3:R>0.6?2:R>0.35?1:0;"
        "var nc=window.LD.Srs.next(c,rating,t);c.stability=nc.stability;c.difficulty=nc.difficulty;"
        "c.reps=nc.reps;c.lapses=nc.lapses;c.last=nc.last;c.due=nc.due;reviews++;}"
        "var n=0;for(var k=0;k<cards.length;k++){var c2=cards[k];"
        "if(!c2.last&&n<20){var nc2=window.LD.Srs.next(c2,rnd()<0.7?2:1,t);"
        "c2.stability=nc2.stability;c2.difficulty=nc2.difficulty;c2.reps=nc2.reps;"
        "c2.last=nc2.last;c2.due=nc2.due;n++;}}"
        "t+=86400000;}"
        "var dueLeft=cards.filter(function(c){return c.last>0&&c.due>t;}).length;"
        "return {reviews:reviews,dueLeft:dueLeft};"
    )
    v = json.loads(out)
    assert v["dueLeft"] > 50, v
    assert v["reviews"] > 200, v


def test_fsrs_again_behavior():
    """again：lapses+1、当天重来（≤2 分钟）。"""
    v = json.loads(_node_eval(
        "var t=Date.now();"
        "var c1=window.LD.Srs.next(window.LD.Srs.initCard('word'),3,t);"
        "var c2=window.LD.Srs.next(c1,0,t);"
        "return {lapses:c2.lapses,delayMin:(c2.due-t)/60000};"
    ))
    assert v["lapses"] == 1
    assert 0 < v["delayMin"] <= 2


# ---------- 浏览器侧：迁移 / 调度 / API（复用 page fixture，页面已加载） ----------

def test_migration_v4_shape(page):
    """运行时档案：version=4，fsrs/notes 容器存在。"""
    r = page.evaluate(
        "() => ({ version: window.LD.Store.s.version, hasFsrs: !!window.LD.Store.s.fsrs, hasNotes: !!window.LD.Store.s.notes })"
    )
    assert r["version"] == 4
    assert r["hasFsrs"] is True
    assert r["hasNotes"] is True


def test_rate_writes_fsrs(page):
    """评分后 fsrs 档案更新、due 在未来、note 注册。"""
    r = page.evaluate(
        """() => {
          const E = window.LD.Engine, S = window.LD.Store;
          const before = Object.keys(S.s.fsrs || {}).length;
          E.rate('Haus', 3);
          const c = (S.s.fsrs || {})['Haus'];
          return { before, after: Object.keys(S.s.fsrs || {}).length,
                   dueFuture: !!(c && c.due > Date.now()), stability: c && c.stability,
                   note: !!(S.s.notes && S.s.notes['Haus']) };
        }"""
    )
    assert r["after"] == r["before"] + 1
    assert r["dueFuture"] is True
    assert r["stability"] > 0
    assert r["note"] is True


def test_fsrs_due_and_recall_api(page):
    """fsrsDue/fsrsRecall/registerNote 7 粒度 API 形状。"""
    r = page.evaluate(
        """() => {
          const E = window.LD.Engine;
          const kinds = ['word','sentence','character','grammar','item','group','quick'];
          const shapes = {};
          for (const k of kinds) {
            E.registerNote('t_' + k, k, 'ref_' + k);
            shapes[k] = { due: Array.isArray(E.fsrsDue(k)), card: !!E.fsrsCard('t_' + k, k) };
          }
          return { shapes, recallType: typeof E.fsrsRecall('t_word'),
                   srsKinds: window.LD.Srs.KINDS };
        }"""
    )
    assert set(r["srsKinds"]) == {"word", "sentence", "character", "grammar", "item", "group", "quick"}
    for k, v in r["shapes"].items():
        assert v["due"] is True, k
        assert v["card"] is True, k
    assert r["recallType"] == "number"


def test_merged_due_includes_fsrs(page):
    """mergedDue 包含 fsrs 到期词（评分后强制到期 → 进入待复习口径）。"""
    r = page.evaluate(
        """() => {
          const E = window.LD.Engine, S = window.LD.Store;
          E.rate('Haus', 0);                       /* again → due ≈ now+1min */
          const before = E.dueCount();
          S.s.fsrs['Haus'].due = Date.now() - 1000; /* 强制到期 */
          const due = E.mergedDue();
          return { before, includes: due.includes('Haus'), after: E.dueCount() };
        }"""
    )
    assert r["includes"] is True
    assert r["after"] >= r["before"]