# -*- coding: utf-8 -*-
"""B7 每日内容位 e2e：首页两卡渲染 / 确定性 / 收藏按钮。"""
import json
import subprocess

import pytest

from conftest import goto, view_html


def test_daily_cards_render(page):
    """首页渲染每日一句 + 每日听力。"""
    goto(page, "home")
    html = view_html(page)
    assert "每日一句" in html
    assert "每日听力" in html
    assert "播放" in html
    assert "收藏" in html


def test_daily_deterministic(page):
    """同一天两次渲染内容一致（Daily 纯函数）。"""
    goto(page, "home")
    a = page.evaluate("() => window.LD.Daily.sentence(window.LD.Daily.today()).de")
    b = page.evaluate("() => window.LD.Daily.sentence(window.LD.Daily.today()).de")
    assert a == b
    # 换一个日期应不同（除非池极小，池 5900+ 不会撞）
    c = page.evaluate("() => window.LD.Daily.sentence('2026-01-01').de")
    assert c != a


def test_daily_fav_adds_to_wordbank(page):
    """收藏按钮：加入生词本 +1（不判错）。"""
    goto(page, "home")
    before = page.evaluate("() => window.LD.Store.s.wordbank.length")
    page.locator("#dailyFav").click()
    page.wait_for_timeout(200)
    after = page.evaluate("() => window.LD.Store.s.wordbank.length")
    sent = page.evaluate("() => window.LD.Daily.sentence(window.LD.Daily.today()).de")
    banked = page.evaluate("(de) => window.LD.Store.s.wordbank.some(w => w.de === de)", sent)
    assert banked is True
    assert after == before + 1 or after == before  # 重复点击不重复加（幂等）


def test_daily_node_deterministic():
    """Node 侧确定性：seed 同日期同结果（先加载全部 lexicon，模拟浏览器加载序）。"""
    code = (
        "globalThis.window={};"
        "for(let i=1;i<=10;i++){eval(require('fs').readFileSync('src/data/lexicon-'+i+'.js','utf-8'));}"
        "eval(require('fs').readFileSync('src/core/daily.js','utf-8'));"
        "const a=window.LD.Daily.pick('sentence','2026-11-11');"
        "const b=window.LD.Daily.pick('sentence','2026-11-11');"
        "const c=window.LD.Daily.pick('sentence','2026-11-12');"
        "console.log(JSON.stringify({same:a[0]===b[0], diff:a[0]!==c[0]}));"
    )
    r = subprocess.run(["node", "-e", code], capture_output=True, text=True, encoding="utf-8", cwd=".")
    assert r.returncode == 0, r.stderr
    v = json.loads(r.stdout.strip())
    assert v["same"] is True
    assert v["diff"] is True


def test_no_console_errors(page, errors):
    goto(page, "home")
    page.wait_for_timeout(300)
    real = [e for e in errors if "favicon" not in e]
    assert real == [], real