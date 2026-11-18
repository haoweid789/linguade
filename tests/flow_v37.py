# -*- coding: utf-8 -*-
"""B4 德语特色三件套 e2e：三页签渲染 / 性别训练器答题 / 易混字符 / 速查页。"""
import pytest

from conftest import goto, view_html


def test_german_route_renders_tabs(page):
    """路由 /german 渲染三页签。"""
    goto(page, "german")
    html = view_html(page)
    assert "性别训练器" in html
    assert "易混字符" in html
    assert "阴阳中性速查" in html


def test_gender_trainer_answer_flow(page):
    """性别训练器：答一题（点正确选项）→ 反馈 + 统计更新。"""
    goto(page, "german")
    page.wait_for_timeout(300)
    # 从页面拿到当前题的正确 genus（data 驱动：读 Store 里当前题）
    answer = page.evaluate(
        """() => {
          const mod = window.LD.Modules['german'];
          // 通过 DOM：当前题词 + 词库查 genus
          const w = document.querySelector('#quiz .vocab-word');
          if (!w) return null;
          const de = w.textContent.trim();
          const lex = (window.LD_LEX || []).find(x => x[0] === de);
          return lex ? lex[1] : null;
        }"""
    )
    assert answer in ("der", "die", "das"), answer
    # 点正确选项
    page.locator(f"#quiz button:has-text('{answer}（')").first.click()
    page.wait_for_timeout(200)
    fb = view_html(page)
    assert "下一题" in fb or "查看结果" in fb
    # 统计板更新（正确率或连击出现）
    assert "本轮战绩" in fb or "Combo" in fb or "正确率" in fb


def test_gender_wrong_goes_to_wrongbook(page):
    """答错 → 错题本记录（module 德语特色）。"""
    goto(page, "german")
    page.wait_for_timeout(300)
    wrong_ans = page.evaluate(
        """() => {
          const w = document.querySelector('#quiz .vocab-word');
          if (!w) return null;
          const de = w.textContent.trim();
          const lex = (window.LD_LEX || []).find(x => x[0] === de);
          if (!lex) return null;
          return ['der','die','das'].find(g => g !== lex[1]);
        }"""
    )
    assert wrong_ans
    page.locator(f"#quiz button:has-text('{wrong_ans}（')").first.click()
    page.wait_for_timeout(200)
    n = page.evaluate(
        "() => window.LD.Store.s.wrong.filter(x => x.module === '德语特色' && x.type === 'gender').length"
    )
    assert n >= 1


def test_chars_tab_renders(page):
    """易混字符页：四组卡片 + 对立对。"""
    goto(page, "german")
    page.locator('[data-tab="chars"]').click()
    page.wait_for_timeout(200)
    html = view_html(page)
    assert "最小对立对" in html
    assert "ß" in html and "ss" in html
    # 对立对按钮可点
    btns = page.locator("#mp button")
    assert btns.count() >= 6
    btns.first.click()
    page.wait_for_timeout(100)


def test_table_tab_renders(page):
    """阴阳中性速查：规律卡片 + 例外表。"""
    goto(page, "german")
    page.locator('[data-tab="table"]').click()
    page.wait_for_timeout(200)
    html = view_html(page)
    assert "后缀规律" in html
    assert "-ung" in html
    assert "易错例外" in html
    assert "-chen" in html


def test_no_console_errors(page, errors):
    """三页签切换无控制台错误。"""
    goto(page, "german")
    page.locator('[data-tab="chars"]').click()
    page.wait_for_timeout(150)
    page.locator('[data-tab="table"]').click()
    page.wait_for_timeout(150)
    page.locator('[data-tab="gender"]').click()
    page.wait_for_timeout(150)
    real = [e for e in errors if "favicon" not in e]
    assert real == [], real